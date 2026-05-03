/*
 * One-time importer for the Google Sheet of pre-existing volunteers.
 *
 * Usage (PowerShell):
 *   $env:SUPABASE_URL = "https://YOURPROJECT.supabase.co"
 *   $env:SUPABASE_SERVICE_ROLE_KEY = "eyJ..."
 *   node scripts/import-from-sheet.js
 *
 * Optional flags:
 *   --csv <path>          Read from a local CSV instead of fetching from Google
 *   --dry-run             Print what would be inserted, do not call Supabase
 *
 * Maps each sheet column to a shift id, dedupes volunteers by name, infers phone
 * from any cell that contains digits, and POSTs one record per volunteer with
 * status="approved" and synthetic email/phone placeholders if missing.
 */

const fs = require("fs");
const crypto = require("crypto");
const path = require("path");

const SHEET_CSV_URL = "https://docs.google.com/spreadsheets/d/1KyiH-FFwNn7pgyFruNMVW2oSFYZ5T-0W2DuNuEPSNYo/export?format=csv&gid=0";

const SHEET_COLUMN_TO_SHIFT_ID = {
  "Mon 5/4 9am-1pm": "mon-am-1",
  "Mon 5/4 1pm-5pm": "mon-pm-1",
  "Mon 5/4 5pm-9pm": "mon-pm-2",
  "Mon-Tues 11pm-3a": "mon-tue-overnight",
  "Tues 3am-7am": "tue-predawn",
  "Tues 5/5 9am-1pm": "tue-am-1",
  "Tues 5/5 1pm-5pm": "tue-pm-1",
  "Tues 5/5 5pm-9pm": "tue-pm-2",
  "Tues-Wed 11pm-3a": "tue-wed-overnight",
  "Wed 3am-7am": "wed-predawn",
  "Wed 5/6 9am-1pm": "wed-am-1",
  "Wed 5/6 1pm-5pm": "wed-pm-1",
  "Wed 5/6 5pm-9pm": "wed-pm-2",
  "Wed-Thurs 11pm-3a": "wed-thu-overnight",
  "Thurs 3am-7am": "thu-predawn",
  "Thurs 5/7 9am-1pm": "thu-am-1",
  "Thurs 5/7 1pm-5pm": "thu-pm-1",
  "Thurs 5/7 5pm-9pm": "thu-pm-2"
};

const PLACEHOLDER_EMAIL = "no-email-on-file@operationbeagle.us";
const PLACEHOLDER_PHONE = "Not provided";

const REQUIRED_ACK_KEYS = [
  "termsReviewed",
  "nonDisparagement",
  "noMedicalBarnMedia",
  "shoeDisinfection",
  "healthScreening",
  "staffDirection"
];

function parseArgs(argv) {
  const args = { csv: null, dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (value === "--csv") {
      args.csv = argv[i + 1];
      i += 1;
    } else if (value === "--dry-run") {
      args.dryRun = true;
    }
  }
  return args;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += ch;
    }
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  return rows;
}

function extractName(cell) {
  if (!cell) return "";
  // Strip phone patterns and bracketed/at-suffix notes
  let text = cell
    .replace(/\b\d{3}[\s\-.]?\d{3}[\s\-.]?\d{4}\b/g, " ")
    .replace(/\b\d{3}[\s\-.]?\d{4}\b/g, " ")
    .replace(/@[^\s]+/g, " ")
    .replace(/\barriving[^,]*/gi, " ")
    .replace(/\buntil\s+\d[^,]*/gi, " ")
    .replace(/\b(can stay|will have|hotel|airbnb)[^,]*/gi, " ")
    .replace(/[\[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // If "Name and Name" we keep the full pair as the canonical record.
  return text;
}

function extractPhone(cell) {
  if (!cell) return "";
  const match = cell.match(/\b(\d{3})[\s\-.]?(\d{3})[\s\-.]?(\d{4})\b/);
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  return "";
}

function slugifyEmail(name) {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return base ? `${base}@import.local` : PLACEHOLDER_EMAIL;
}

function buildSignupRecords(rows) {
  const headerRow = rows[0] || [];
  const shiftIdsByColumn = headerRow.map((header) => SHEET_COLUMN_TO_SHIFT_ID[header.trim()] || null);

  const volunteersByKey = new Map();

  // Body rows start at index 2 (row 0 = header, row 1 = capacity counts)
  for (let r = 2; r < rows.length; r += 1) {
    const row = rows[r];
    for (let c = 0; c < row.length; c += 1) {
      const shiftId = shiftIdsByColumn[c];
      if (!shiftId) continue;

      const cell = (row[c] || "").trim();
      if (!cell) continue;

      const name = extractName(cell);
      if (!name || name.length < 2) continue;

      const key = name.toLowerCase();
      let entry = volunteersByKey.get(key);
      if (!entry) {
        entry = { name, phone: "", shiftIds: new Set(), notes: [] };
        volunteersByKey.set(key, entry);
      }
      entry.shiftIds.add(shiftId);
      if (!entry.phone) {
        const phone = extractPhone(cell);
        if (phone) entry.phone = phone;
      }
      // Capture trailing time-of-arrival or context notes if present
      const noteMatch = cell.match(/(arriving[^,]*|until\s+\d[^,]*)/i);
      if (noteMatch && !entry.notes.includes(noteMatch[0])) {
        entry.notes.push(noteMatch[0].trim());
      }
    }
  }

  const acknowledgements = REQUIRED_ACK_KEYS.reduce((acc, key) => {
    acc[key] = true;
    return acc;
  }, {});

  const now = new Date().toISOString();
  const records = [];
  for (const entry of volunteersByKey.values()) {
    const shiftIds = [...entry.shiftIds];
    const dogExperience = entry.notes.length > 0
      ? `Imported from outreach sheet. Notes: ${entry.notes.join("; ")}`
      : "Imported from outreach sheet.";

    records.push({
      id: crypto.randomUUID(),
      submittedAt: now,
      name: entry.name,
      phone: entry.phone || PLACEHOLDER_PHONE,
      phoneDigits: (entry.phone || "").replace(/\D/g, ""),
      email: entry.phone ? slugifyEmail(entry.name) : PLACEHOLDER_EMAIL,
      shiftIds,
      rolePreferences: [],
      willingAllTasks: true,
      anyRole: true,
      status: "approved",
      reviewedAt: now,
      assignedRoleId: "",
      dogExperience,
      currentlyFosteringSickDogs: false,
      understandingConfirmed: true,
      acknowledgements,
      importedFromSheet: true
    });
  }

  return records;
}

async function fetchCsv(csvPath) {
  if (csvPath) {
    return fs.readFileSync(csvPath, "utf8");
  }
  const response = await fetch(SHEET_CSV_URL);
  if (!response.ok) {
    throw new Error(`Failed to download sheet: HTTP ${response.status}`);
  }
  return response.text();
}

async function uploadRecords(records) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const table = process.env.SUPABASE_SIGNUPS_TABLE || "signups";
  if (!url || !key) {
    throw new Error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars first.");
  }

  const endpoint = `${url.replace(/\/+$/, "")}/rest/v1/${encodeURIComponent(table)}?on_conflict=id`;
  const rows = records.map((record) => ({
    id: record.id,
    submitted_at: record.submittedAt,
    record
  }));

  // Insert in batches of 50 to stay friendly to Supabase request limits.
  const batchSize = 50;
  let uploaded = 0;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal"
      },
      body: JSON.stringify(batch)
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Supabase ${response.status}: ${text}`);
    }
    uploaded += batch.length;
    process.stdout.write(`Uploaded ${uploaded}/${rows.length}\r`);
  }
  process.stdout.write("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const csv = await fetchCsv(args.csv);
  const rows = parseCsv(csv);
  const records = buildSignupRecords(rows);

  console.log(`Parsed ${records.length} unique volunteer records from sheet.`);
  const totalShiftSlots = records.reduce((sum, record) => sum + record.shiftIds.length, 0);
  console.log(`Total shift assignments to import: ${totalShiftSlots}`);
  console.log("Sample record:");
  console.log(JSON.stringify(records[0], null, 2));

  if (args.dryRun) {
    const outPath = path.join(__dirname, "..", "data", "import-preview.json");
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(records, null, 2));
    console.log(`Dry run: wrote preview to ${outPath}`);
    return;
  }

  console.log("Uploading to Supabase...");
  await uploadRecords(records);
  console.log("Done.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
