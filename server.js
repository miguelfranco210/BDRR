const http = require("http");
const path = require("path");
const crypto = require("crypto");
const { mkdir, readFile, writeFile, rename } = require("fs/promises");
const coordinatorPageHtml = require("./private/coordinator-page");

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_DIR = path.join(__dirname, "data");
const SIGNUPS_FILE = process.env.SIGNUPS_FILE || path.join(DATA_DIR, "signups.json");
const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const SUPABASE_SIGNUPS_TABLE = process.env.SUPABASE_SIGNUPS_TABLE || "signups";
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const EVENING_CLEAN_PREP_ROLE_ID = "evening-clean-prep";
const COORDINATOR_PAGE_PATH = "/ridglan-beagle-intake-coordinator-desk";
const COORDINATOR_HTML_PATH = "/ridglan-beagle-intake-coordinator-desk.html";
const THURSDAY_LOADER_CLEANUP_ROLE_ID = "thu-loader-cleanup";
const ADMIN_STATUSES = new Set(["pending", "approved", "denied"]);
const GENERAL_ROLE_IDS = ["yard-sitter", "loader", "crate-cleaner", "stall-monitor", "clerical-intake"];
const ROLE_CAPACITY = {
  "yard-sitter": 6,
  loader: 8,
  "crate-cleaner": 4,
  "stall-monitor": 6,
  "clerical-intake": 2,
  "evening-clean-prep": 10,
  "thu-loader-cleanup": 20
};

const shifts = [
  {
    id: "mon-am",
    day: "Monday",
    date: "5/4/2026",
    time: "9:00 AM - 2:00 PM",
    max: 15,
    focus: "Morning availability window"
  },
  {
    id: "mon-pm",
    day: "Monday",
    date: "5/4/2026",
    time: "2:00 PM - 9:00 PM",
    max: 20,
    focus: "Afternoon availability window"
  },
  {
    id: "mon-clean-prep",
    day: "Monday",
    date: "5/4/2026",
    time: "5:00 PM - 9:00 PM",
    max: 10,
    focus: "Evening clean/prep availability window"
  },
  {
    id: "tue-am",
    day: "Tuesday",
    date: "5/5/2026",
    time: "9:00 AM - 2:00 PM",
    max: 15,
    focus: "Morning availability window"
  },
  {
    id: "tue-pm",
    day: "Tuesday",
    date: "5/5/2026",
    time: "2:00 PM - 9:00 PM",
    max: 20,
    focus: "Afternoon availability window"
  },
  {
    id: "tue-clean-prep",
    day: "Tuesday",
    date: "5/5/2026",
    time: "5:00 PM - 9:00 PM",
    max: 10,
    focus: "Evening clean/prep availability window"
  },
  {
    id: "wed-am",
    day: "Wednesday",
    date: "5/6/2026",
    time: "9:00 AM - 2:00 PM",
    max: 15,
    focus: "Morning availability window"
  },
  {
    id: "wed-pm",
    day: "Wednesday",
    date: "5/6/2026",
    time: "2:00 PM - 9:00 PM",
    max: 20,
    focus: "Afternoon availability window"
  },
  {
    id: "wed-clean-prep",
    day: "Wednesday",
    date: "5/6/2026",
    time: "5:00 PM - 9:00 PM",
    max: 10,
    focus: "Evening clean/prep availability window"
  },
  {
    id: "thu-am",
    day: "Thursday",
    date: "5/7/2026",
    time: "9:00 AM - 2:00 PM",
    max: 20,
    focus: "Thursday loader and clean-up availability window"
  }
];

const roles = [
  {
    id: "yard-sitter",
    label: "Upper barn yard sitter",
    need: "5-6 needed",
    description: "Sit with dogs in the upper barn yard areas, help keep spaces clean, and provide calm socialization. Dog handling comfort is helpful."
  },
  {
    id: "loader",
    label: "Lower barn unloader/loader",
    need: "8 needed",
    description: "Assist staff with unloading, loading, crate movement, and controlled traffic flow. Best for volunteers comfortable lifting, moving supplies, and following fast staff direction."
  },
  {
    id: "crate-cleaner",
    label: "Crate cleaner and waterer",
    need: "4 needed",
    description: "Clean and reset crates, refresh water, replace soiled materials, and keep staging areas sanitary. No advanced dog handling experience required."
  },
  {
    id: "stall-monitor",
    label: "Stall monitor",
    need: "6 needed",
    description: "Watch stalls, monitor dog comfort, report concerns to staff, and help keep movement calm. Careful observation and patience matter most."
  },
  {
    id: "clerical-intake",
    label: "Clerical dog intake assistant",
    need: "2 needed",
    description: "Support intake paperwork, check-in notes, labels, and basic record coordination. Best for detail-oriented volunteers comfortable with forms."
  },
  {
    id: "evening-clean-prep",
    label: "Evening cleaning and prep crew",
    need: "10 needed",
    description: "Clean work areas, reset supplies, prepare crates/stalls, and help the next day start smoothly. This is hands-on cleaning and setup work."
  },
  {
    id: "thu-loader-cleanup",
    label: "Thursday loader and clean-up crew",
    need: "20 needed",
    description: "Support Thursday morning loading, cleanup, breakdown, and staff-directed wrap-up tasks. Good for flexible volunteers comfortable staying active."
  }
];

const requiredAcknowledgements = [
  "termsReviewed",
  "nonDisparagement",
  "noMedicalBarnMedia",
  "shoeDisinfection",
  "healthScreening",
  "staffDirection"
];

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml"
};

let signupQueue = Promise.resolve();

function useSupabaseStorage() {
  return Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
}

function getSupabaseTableUrl(search = "") {
  return `${SUPABASE_URL}/rest/v1/${encodeURIComponent(SUPABASE_SIGNUPS_TABLE)}${search}`;
}

async function requestSupabase(search, options = {}) {
  const response = await fetch(getSupabaseTableUrl(search), {
    ...options,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {})
    }
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Supabase request failed (${response.status}): ${message}`);
  }

  if (response.status === 204) {
    return null;
  }

  const responseText = await response.text();
  return responseText ? JSON.parse(responseText) : null;
}

function queueSignupWrite(task) {
  const nextTask = signupQueue.then(task, task);
  signupQueue = nextTask.catch(() => undefined);
  return nextTask;
}

async function readSignups() {
  if (useSupabaseStorage()) {
    const rows = await requestSupabase("?select=record&order=submitted_at.asc", {
      method: "GET"
    });

    return Array.isArray(rows) ? rows.map((row) => row.record).filter(Boolean) : [];
  }

  try {
    const content = await readFile(SIGNUPS_FILE, "utf8");
    const signups = JSON.parse(content);
    return Array.isArray(signups) ? signups : [];
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

async function writeSignups(signups) {
  if (useSupabaseStorage()) {
    const rows = signups.map((signup) => ({
      id: signup.id,
      submitted_at: signup.submittedAt || new Date().toISOString(),
      record: signup
    }));

    if (rows.length > 0) {
      await requestSupabase("?on_conflict=id", {
        method: "POST",
        headers: {
          Prefer: "resolution=merge-duplicates,return=minimal"
        },
        body: JSON.stringify(rows)
      });
    }
    return;
  }

  await mkdir(path.dirname(SIGNUPS_FILE), { recursive: true });
  const temporaryFile = `${SIGNUPS_FILE}.${process.pid}.tmp`;
  await writeFile(temporaryFile, JSON.stringify(signups, null, 2), "utf8");
  await rename(temporaryFile, SIGNUPS_FILE);
}

function getRoleById(roleId) {
  return roles.find((role) => role.id === roleId);
}

function getShiftById(shiftId) {
  return shifts.find((shift) => shift.id === shiftId);
}

function getShiftIds(signup) {
  return Array.isArray(signup.shiftIds) ? signup.shiftIds : [signup.shiftId].filter(Boolean);
}

function getRolePreferenceIds(signup) {
  return Array.isArray(signup.rolePreferences) ? signup.rolePreferences : [];
}

function getEligibleRoleIdsForShift(shiftId) {
  if (isEveningCleanPrepShiftId(shiftId)) {
    return [EVENING_CLEAN_PREP_ROLE_ID];
  }

  if (shiftId === "thu-am") {
    return [THURSDAY_LOADER_CLEANUP_ROLE_ID];
  }

  return GENERAL_ROLE_IDS;
}

function getEligibleRoleIdsForSignup(signup) {
  const eligibleRoleIds = new Set();
  getShiftIds(signup).forEach((shiftId) => {
    getEligibleRoleIdsForShift(shiftId).forEach((roleId) => eligibleRoleIds.add(roleId));
  });

  return [...eligibleRoleIds];
}

function normalizeSignup(signup) {
  const shiftIds = getShiftIds(signup).filter((shiftId) => Boolean(getShiftById(shiftId)));
  const rolePreferences = getRolePreferenceIds(signup).filter((roleId) => Boolean(getRoleById(roleId)));
  const status = ADMIN_STATUSES.has(signup.status) ? signup.status : "pending";
  const assignedRoleId = getRoleById(signup.assignedRoleId) ? signup.assignedRoleId : "";
  const scheduleOverrides = Object.entries(signup.scheduleOverrides || {}).reduce((result, [shiftId, override]) => {
    const selectedShift = shiftIds.includes(shiftId);
    const eligibleRoleIds = getEligibleRoleIdsForShift(shiftId);
    const roleId = getRoleById(override.roleId) && eligibleRoleIds.includes(override.roleId) ? override.roleId : "";
    const excluded = override.excluded === true;

    if (selectedShift && (roleId || excluded)) {
      result[shiftId] = {
        roleId,
        excluded,
        updatedAt: override.updatedAt || ""
      };
    }

    return result;
  }, {});

  return {
    ...signup,
    shiftIds,
    rolePreferences,
    status,
    assignedRoleId,
    scheduleOverrides,
    assignedRoleUpdatedAt: signup.assignedRoleUpdatedAt || "",
    reviewedAt: signup.reviewedAt || "",
    updatedAt: signup.updatedAt || "",
    acknowledgements: signup.acknowledgements || {}
  };
}

function getBucketLoads(rawSignups) {
  const bucketLoads = shifts.reduce((result, shift) => {
    result[shift.id] = getEligibleRoleIdsForShift(shift.id).reduce((roleResult, roleId) => {
      roleResult[roleId] = {
        assigned: 0,
        target: ROLE_CAPACITY[roleId] || shift.max
      };
      return roleResult;
    }, {});
    return result;
  }, {});

  rawSignups.map(normalizeSignup).forEach((signup) => {
    if (signup.status === "denied" || !signup.assignedRoleId) {
      return;
    }

    signup.shiftIds.forEach((shiftId) => {
      const override = signup.scheduleOverrides[shiftId];

      if (override && override.excluded) {
        return;
      }

      const roleId = override && override.roleId ? override.roleId : signup.assignedRoleId;

      if (bucketLoads[shiftId] && bucketLoads[shiftId][roleId]) {
        bucketLoads[shiftId][roleId].assigned += 1;
      }
    });
  });

  return bucketLoads;
}

function getAvailability(signups) {
  const counts = signups.reduce((totals, signup) => {
    const shiftIds = Array.isArray(signup.shiftIds) ? signup.shiftIds : [signup.shiftId].filter(Boolean);

    shiftIds.forEach((shiftId) => {
      totals[shiftId] = (totals[shiftId] || 0) + 1;
    });

    return totals;
  }, {});

  return shifts.map((shift) => {
    const count = counts[shift.id] || 0;

    return {
      ...shift,
      count,
      target: shift.max,
      full: false
    };
  });
}

function cleanText(value, maxLength = 300) {
  if (typeof value !== "string") {
    return "";
  }

  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function cleanLongText(value, maxLength = 2000) {
  if (typeof value !== "string") {
    return "";
  }

  return value.replace(/\r\n/g, "\n").trim().slice(0, maxLength);
}

function isEveningCleanPrepShiftId(shiftId) {
  return typeof shiftId === "string" && shiftId.endsWith("-clean-prep");
}

function validateSignup(body, existingSignups) {
  const errors = [];
  const shiftIds = new Set(shifts.map((shift) => shift.id));
  const submittedShiftIds = Array.isArray(body.shiftIds) ? body.shiftIds : [body.shiftId].filter(Boolean);
  const selectedShiftIds = [...new Set(submittedShiftIds.filter((shiftId) => shiftIds.has(shiftId)))];
  const roleIds = new Set(roles.map((role) => role.id));
  let rolePreferences = Array.isArray(body.rolePreferences)
    ? body.rolePreferences.filter((roleId) => roleIds.has(roleId))
    : [];
  const onlyEveningCleanPrepAvailability = selectedShiftIds.length > 0 && selectedShiftIds.every(isEveningCleanPrepShiftId);

  const name = cleanText(body.name, 120);
  const phone = cleanText(body.phone, 40);
  const email = cleanText(body.email, 180).toLowerCase();
  const dogExperience = cleanLongText(body.dogExperience, 2000);
  const legalConfirmation = cleanText(body.legalConfirmation, 40).toUpperCase();
  let willingAllTasks = body.willingAllTasks === true || body.anyRole === true;
  const currentlyFosteringSickDogs = body.currentlyFosteringSickDogs === true;
  const phoneDigits = phone.replace(/\D/g, "");

  if (onlyEveningCleanPrepAvailability) {
    rolePreferences = [EVENING_CLEAN_PREP_ROLE_ID];
    willingAllTasks = false;
  }

  if (!name) {
    errors.push("Name is required.");
  }

  if (phoneDigits.length < 7) {
    errors.push("A valid phone number is required.");
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.push("A valid email address is required.");
  }

  if (selectedShiftIds.length === 0) {
    errors.push("Please choose at least one shift when you may be available.");
  }

  if (!dogExperience) {
    errors.push("Please describe your dog handling experience, even if you have none.");
  }

  if (!willingAllTasks && rolePreferences.length === 0) {
    errors.push("Please choose at least one task preference or select that you are willing to help wherever needed.");
  }

  if (currentlyFosteringSickDogs) {
    errors.push("Volunteers currently fostering sick dogs should not sign up for this intake.");
  }

  const acknowledgements = requiredAcknowledgements.reduce((result, key) => {
    result[key] = Boolean(body.acknowledgements && body.acknowledgements[key] === true);
    return result;
  }, {});

  if (Object.values(acknowledgements).some((accepted) => !accepted)) {
    errors.push("All required acknowledgements must be checked before signing up.");
  }

  if (legalConfirmation !== "I UNDERSTAND") {
    errors.push("Please type I UNDERSTAND to confirm the confidentiality, media, and non-disparagement requirements.");
  }

  const duplicate = existingSignups.find((signup) => signup.email === email);

  if (duplicate) {
    errors.push("This email has already submitted availability. Please contact Big Dog Ranch Rescue outreach if it needs to be updated.");
  }

  return {
    valid: errors.length === 0,
    errors,
    record: {
      id: crypto.randomUUID(),
      submittedAt: new Date().toISOString(),
      name,
      phone,
      phoneDigits,
      email,
      shiftIds: selectedShiftIds,
      rolePreferences,
      willingAllTasks,
      anyRole: willingAllTasks,
      status: "pending",
      assignedRoleId: "",
      dogExperience,
      currentlyFosteringSickDogs,
      understandingConfirmed: legalConfirmation === "I UNDERSTAND",
      acknowledgements
    }
  };
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(payload));
}

function sendText(response, statusCode, payload, contentType = "text/plain; charset=utf-8") {
  response.writeHead(statusCode, {
    "Content-Type": contentType,
    "Cache-Control": "no-store"
  });
  response.end(payload);
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";

    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new Error("Request body is too large."));
        request.destroy();
      }
    });

    request.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}"));
      } catch (error) {
        reject(new Error("Request body must be valid JSON."));
      }
    });

    request.on("error", reject);
  });
}

function csvEscape(value) {
  const normalized = Array.isArray(value) ? value.join("; ") : String(value ?? "");
  return `"${normalized.replace(/"/g, '""').replace(/\r?\n/g, " ")}"`;
}

function signupsToCsv(signups) {
  const roleLabels = new Map(roles.map((role) => [role.id, role.label]));
  const shiftLabels = new Map(shifts.map((shift) => [shift.id, getShiftLabel(shift.id)]));
  const columns = [
    "submittedAt",
    "status",
    "name",
    "phone",
    "email",
    "availableShifts",
    "taskPreferences",
    "assignedTaskBucket",
    "willingAllTasks",
    "dogExperience",
    "termsReviewed",
    "understandingConfirmed",
    "nonDisparagement",
    "noMedicalBarnMedia",
    "shoeDisinfection",
    "healthScreening",
    "staffDirection"
  ];

  const rows = signups.map((rawSignup) => {
    const signup = normalizeSignup(rawSignup);
    const roleList = signup.rolePreferences.map((roleId) => roleLabels.get(roleId) || roleId);
    const selectedShiftIds = getShiftIds(signup);
    const shiftList = selectedShiftIds.map((shiftId) => shiftLabels.get(shiftId) || shiftId);

    return [
      signup.submittedAt,
      signup.status,
      signup.name,
      signup.phone,
      signup.email,
      shiftList,
      roleList,
      roleLabels.get(signup.assignedRoleId) || "",
      signup.willingAllTasks || signup.anyRole ? "Yes" : "No",
      signup.dogExperience,
      signup.acknowledgements.termsReviewed ? "Yes" : "No",
      signup.understandingConfirmed ? "Yes" : "No",
      signup.acknowledgements.nonDisparagement ? "Yes" : "No",
      signup.acknowledgements.noMedicalBarnMedia ? "Yes" : "No",
      signup.acknowledgements.shoeDisinfection ? "Yes" : "No",
      signup.acknowledgements.healthScreening ? "Yes" : "No",
      signup.acknowledgements.staffDirection ? "Yes" : "No"
    ].map(csvEscape).join(",");
  });

  return [columns.join(","), ...rows].join("\n");
}

function safeCompareText(first, second) {
  const firstBuffer = Buffer.from(String(first));
  const secondBuffer = Buffer.from(String(second));
  return firstBuffer.length === secondBuffer.length && crypto.timingSafeEqual(firstBuffer, secondBuffer);
}

function getBasicAuthCredentials(request) {
  const header = request.headers.authorization || "";
  const match = header.match(/^Basic\s+(.+)$/i);

  if (!match) {
    return null;
  }

  const decoded = Buffer.from(match[1], "base64").toString("utf8");
  const separatorIndex = decoded.indexOf(":");

  if (separatorIndex === -1) {
    return null;
  }

  return {
    username: decoded.slice(0, separatorIndex),
    password: decoded.slice(separatorIndex + 1)
  };
}

function hasValidAdminCredentials(request) {
  if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
    return false;
  }

  const credentials = getBasicAuthCredentials(request);
  return Boolean(credentials)
    && safeCompareText(credentials.username, ADMIN_USERNAME)
    && safeCompareText(credentials.password, ADMIN_PASSWORD);
}

function isAdminAuthorized(requestUrl, body = {}, request = null) {
  return request ? hasValidAdminCredentials(request) : false;
}

function sendAdminUnauthorized(response) {
  response.writeHead(401, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "WWW-Authenticate": 'Basic realm="Big Dog Ranch Rescue Coordinator", charset="UTF-8"'
  });
  response.end(JSON.stringify({ error: "Coordinator username and password are required." }));
}

function getShiftLabel(shiftId) {
  const shift = getShiftById(shiftId);
  return shift ? `${shift.day} ${shift.date} ${shift.time}` : shiftId;
}

function getRoleLabel(roleId) {
  const role = getRoleById(roleId);
  return role ? role.label : roleId;
}

function getSuggestedRoleId(signup) {
  if (getShiftIds(signup).length > 1) {
    return "";
  }

  const eligibleRoleIds = getEligibleRoleIdsForSignup(signup);

  if (eligibleRoleIds.length === 1) {
    return eligibleRoleIds[0];
  }

  const preferredRoleId = signup.rolePreferences.find((roleId) => eligibleRoleIds.includes(roleId));

  if (preferredRoleId) {
    return preferredRoleId;
  }

  return signup.willingAllTasks || signup.anyRole ? eligibleRoleIds[0] || "" : "";
}

function serializeAdminSignup(rawSignup) {
  const signup = normalizeSignup(rawSignup);
  const eligibleRoleIds = getEligibleRoleIdsForSignup(signup);

  return {
    id: signup.id,
    submittedAt: signup.submittedAt,
    name: signup.name,
    phone: signup.phone,
    email: signup.email,
    shiftIds: signup.shiftIds,
    shiftLabels: signup.shiftIds.map(getShiftLabel),
    rolePreferences: signup.rolePreferences,
    rolePreferenceLabels: signup.rolePreferences.map(getRoleLabel),
    eligibleRoleIds,
    suggestedRoleId: signup.assignedRoleId || getSuggestedRoleId(signup),
    assignedRoleId: signup.assignedRoleId,
    assignedRoleLabel: signup.assignedRoleId ? getRoleLabel(signup.assignedRoleId) : "",
    willingAllTasks: Boolean(signup.willingAllTasks || signup.anyRole),
    dogExperience: signup.dogExperience,
    status: signup.status,
    scheduleOverrides: signup.scheduleOverrides,
    reviewedAt: signup.reviewedAt,
    updatedAt: signup.updatedAt,
    assignedRoleUpdatedAt: signup.assignedRoleUpdatedAt
  };
}

function parseShiftTimeRange(shift) {
  const [, startHourRaw, startMinuteRaw, startPeriod, endHourRaw, endMinuteRaw, endPeriod] =
    shift.time.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)\s*-\s*(\d{1,2}):(\d{2})\s*(AM|PM)$/i) || [];

  function toMinutes(hourRaw, minuteRaw, periodRaw) {
    let hour = Number(hourRaw);
    const minute = Number(minuteRaw);
    const period = String(periodRaw).toUpperCase();

    if (period === "PM" && hour !== 12) {
      hour += 12;
    }

    if (period === "AM" && hour === 12) {
      hour = 0;
    }

    return hour * 60 + minute;
  }

  return {
    start: toMinutes(startHourRaw, startMinuteRaw, startPeriod),
    end: toMinutes(endHourRaw, endMinuteRaw, endPeriod)
  };
}

function shiftsOverlap(firstShiftId, secondShiftId) {
  const firstShift = getShiftById(firstShiftId);
  const secondShift = getShiftById(secondShiftId);

  if (!firstShift || !secondShift || firstShift.day !== secondShift.day) {
    return false;
  }

  const firstRange = parseShiftTimeRange(firstShift);
  const secondRange = parseShiftTimeRange(secondShift);
  return firstRange.start < secondRange.end && secondRange.start < firstRange.end;
}

function getCandidateRoleIdsForShift(signup, shiftId) {
  const eligibleRoleIds = getEligibleRoleIdsForShift(shiftId);
  const override = signup.scheduleOverrides[shiftId];

  if (override && override.excluded) {
    return [];
  }

  if (override && override.roleId) {
    return eligibleRoleIds.includes(override.roleId) ? [override.roleId] : [];
  }

  if (signup.assignedRoleId) {
    return eligibleRoleIds.includes(signup.assignedRoleId) ? [signup.assignedRoleId] : [];
  }

  const preferredRoleIds = signup.rolePreferences.filter((roleId) => eligibleRoleIds.includes(roleId));

  if (preferredRoleIds.length > 0) {
    return preferredRoleIds;
  }

  return signup.willingAllTasks || signup.anyRole ? eligibleRoleIds : [];
}

function generateAutoSchedule(rawSignups) {
  const scheduleByShift = new Map(shifts.map((shift) => [shift.id, {
    id: shift.id,
    day: shift.day,
    date: shift.date,
    time: shift.time,
    focus: shift.focus,
    target: shift.max,
    assignments: [],
    removed: []
  }]));
  const roleCountsByShift = new Map(shifts.map((shift) => [shift.id, {}]));
  const scheduledShiftIdsBySignup = new Map();
  const unscheduled = [];
  const approvedSignups = rawSignups.map(normalizeSignup).filter((signup) => signup.status === "approved");

  approvedSignups.forEach((signup) => {
    let assignedAnyShift = false;
    scheduledShiftIdsBySignup.set(signup.id, []);

    signup.shiftIds.forEach((shiftId) => {
      const shiftSchedule = scheduleByShift.get(shiftId);

      if (!shiftSchedule) {
        return;
      }

      const override = signup.scheduleOverrides[shiftId];

      if (override && override.excluded) {
        shiftSchedule.removed.push({
          signupId: signup.id,
          name: signup.name,
          phone: signup.phone,
          email: signup.email,
          eligibleRoleIds: getEligibleRoleIdsForShift(shiftId),
          source: "manual"
        });
        return;
      }

      if (signup.shiftIds.length > 1 && !(override && override.roleId)) {
        return;
      }

      const existingShiftIds = scheduledShiftIdsBySignup.get(signup.id);

      if (existingShiftIds.some((existingShiftId) => shiftsOverlap(existingShiftId, shiftId))) {
        return;
      }

      const roleCounts = roleCountsByShift.get(shiftId);
      const roleId = getCandidateRoleIdsForShift(signup, shiftId)[0];

      if (!roleId) {
        return;
      }

      roleCounts[roleId] = (roleCounts[roleId] || 0) + 1;
      existingShiftIds.push(shiftId);
      assignedAnyShift = true;
      shiftSchedule.assignments.push({
        signupId: signup.id,
        name: signup.name,
        phone: signup.phone,
        email: signup.email,
        roleId,
        roleLabel: getRoleLabel(roleId),
        eligibleRoleIds: getEligibleRoleIdsForShift(shiftId),
        source: override && override.roleId ? "manual edit" : signup.assignedRoleId ? "task bucket" : "auto"
      });
    });

    signup.shiftIds.forEach((shiftId) => {
      const shiftSchedule = scheduleByShift.get(shiftId);
      const override = signup.scheduleOverrides[shiftId];
      const scheduledShiftIds = scheduledShiftIdsBySignup.get(signup.id);
      const assignedOverlappingShiftId = scheduledShiftIds.find((scheduledShiftId) => scheduledShiftId !== shiftId && shiftsOverlap(scheduledShiftId, shiftId));
      const alreadyAssigned = scheduledShiftIds.includes(shiftId);
      const alreadyRemoved = shiftSchedule && shiftSchedule.removed.some((assignment) => assignment.signupId === signup.id);

      if (!shiftSchedule || alreadyAssigned || alreadyRemoved || (override && (override.roleId || override.excluded)) || !assignedOverlappingShiftId) {
        return;
      }

      shiftSchedule.removed.push({
        signupId: signup.id,
        name: signup.name,
        phone: signup.phone,
        email: signup.email,
        eligibleRoleIds: getEligibleRoleIdsForShift(shiftId),
        source: "overlap",
        assignedOverlappingShiftId
      });
    });

    if (!assignedAnyShift) {
      unscheduled.push({
        signupId: signup.id,
        name: signup.name,
        reason: signup.shiftIds.length > 1
          ? "Multi-shift volunteer. Assign exact time windows from Fill Needs."
          : "No compatible open slot from selected availability and default task."
      });
    }
  });

  return {
    shifts: [...scheduleByShift.values()].map((shiftSchedule) => ({
      ...shiftSchedule,
      openSlots: Math.max(shiftSchedule.target - shiftSchedule.assignments.length, 0)
    })),
    unscheduled
  };
}

function buildScheduleIndex(schedule) {
  const roleCountsByShift = {};
  const assignedShiftIdsBySignup = new Map();
  const removedShiftIdsBySignup = new Map();

  schedule.shifts.forEach((shiftSchedule) => {
    roleCountsByShift[shiftSchedule.id] = {};

    shiftSchedule.assignments.forEach((assignment) => {
      roleCountsByShift[shiftSchedule.id][assignment.roleId] = (roleCountsByShift[shiftSchedule.id][assignment.roleId] || 0) + 1;

      if (!assignedShiftIdsBySignup.has(assignment.signupId)) {
        assignedShiftIdsBySignup.set(assignment.signupId, []);
      }

      assignedShiftIdsBySignup.get(assignment.signupId).push(shiftSchedule.id);
    });

    shiftSchedule.removed.forEach((assignment) => {
      if (!removedShiftIdsBySignup.has(assignment.signupId)) {
        removedShiftIdsBySignup.set(assignment.signupId, []);
      }

      removedShiftIdsBySignup.get(assignment.signupId).push(shiftSchedule.id);
    });
  });

  return { roleCountsByShift, assignedShiftIdsBySignup, removedShiftIdsBySignup };
}

function getAutoAssignableRoleIds(signup, shiftId) {
  const eligibleRoleIds = getEligibleRoleIdsForShift(shiftId);
  const preferredRoleIds = signup.rolePreferences.filter((roleId) => eligibleRoleIds.includes(roleId));

  if (preferredRoleIds.length > 0) {
    return preferredRoleIds;
  }

  return signup.willingAllTasks || signup.anyRole ? eligibleRoleIds : [];
}

function roleHasOpening(scheduleIndex, shiftId, roleId) {
  const assigned = scheduleIndex.roleCountsByShift[shiftId]?.[roleId] || 0;
  const target = ROLE_CAPACITY[roleId] || getShiftById(shiftId)?.max || 0;
  return target > 0 && assigned < target;
}

function applyAutoScheduleOverride(signup, shiftId, roleId, updatedAt) {
  const scheduleOverrides = { ...signup.scheduleOverrides };

  scheduleOverrides[shiftId] = {
    roleId,
    excluded: false,
    updatedAt
  };

  signup.shiftIds.forEach((selectedShiftId) => {
    const override = scheduleOverrides[selectedShiftId];

    if (
      selectedShiftId === shiftId
      || !shiftsOverlap(selectedShiftId, shiftId)
      || (override && (override.roleId || override.excluded))
    ) {
      return;
    }

    scheduleOverrides[selectedShiftId] = {
      roleId: "",
      excluded: true,
      updatedAt
    };
  });

  return {
    ...signup,
    scheduleOverrides,
    updatedAt
  };
}

function autoAssignRemainingApprovedSignups(rawSignups) {
  const signups = rawSignups.map(normalizeSignup);
  const updatedAt = new Date().toISOString();
  const updatedSignupIds = new Set();
  let assignedWindows = 0;
  let schedule = generateAutoSchedule(signups);
  let scheduleIndex = buildScheduleIndex(schedule);

  signups.forEach((signup, signupIndex) => {
    if (signup.status !== "approved") {
      return;
    }

    let currentSignup = signup;

    currentSignup.shiftIds.forEach((shiftId) => {
      const assignedShiftIds = scheduleIndex.assignedShiftIdsBySignup.get(currentSignup.id) || [];
      const removedShiftIds = scheduleIndex.removedShiftIdsBySignup.get(currentSignup.id) || [];

      if (
        assignedShiftIds.includes(shiftId)
        || removedShiftIds.includes(shiftId)
        || assignedShiftIds.some((assignedShiftId) => shiftsOverlap(assignedShiftId, shiftId))
      ) {
        return;
      }

      const roleId = getAutoAssignableRoleIds(currentSignup, shiftId)
        .find((candidateRoleId) => roleHasOpening(scheduleIndex, shiftId, candidateRoleId));

      if (!roleId) {
        return;
      }

      currentSignup = applyAutoScheduleOverride(currentSignup, shiftId, roleId, updatedAt);
      signups[signupIndex] = currentSignup;
      assignedWindows += 1;
      updatedSignupIds.add(currentSignup.id);
      schedule = generateAutoSchedule(signups);
      scheduleIndex = buildScheduleIndex(schedule);
    });
  });

  return {
    signups,
    result: {
      assignedWindows,
      updatedVolunteers: updatedSignupIds.size
    }
  };
}

function getAdminDashboard(rawSignups) {
  const signups = rawSignups.map(normalizeSignup);
  const summary = signups.reduce((totals, signup) => {
    totals[signup.status] = (totals[signup.status] || 0) + 1;
    return totals;
  }, { pending: 0, approved: 0, denied: 0 });

  return {
    shifts,
    roles,
    summary,
    signups: signups.map(serializeAdminSignup),
    schedule: generateAutoSchedule(signups),
    bucketLoads: getBucketLoads(signups),
    availability: getAvailability(signups)
  };
}

function updateSignupWorkflow(signup, body) {
  const nextSignup = normalizeSignup(signup);
  const action = cleanText(body.action, 40);
  const requestedRoleId = cleanText(body.assignedRoleId, 80);
  const eligibleRoleIds = getEligibleRoleIdsForSignup(nextSignup);

  if (requestedRoleId) {
    if (!getRoleById(requestedRoleId)) {
      return { errors: ["Please choose a valid task bucket."] };
    }

    if (!eligibleRoleIds.includes(requestedRoleId)) {
      return { errors: ["That task bucket is not available for this volunteer's selected time windows."] };
    }

    nextSignup.assignedRoleId = requestedRoleId;
    nextSignup.assignedRoleUpdatedAt = new Date().toISOString();
  }

  if (action === "approve") {
    if (nextSignup.shiftIds.length > 1 && !requestedRoleId) {
      nextSignup.assignedRoleId = "";
      nextSignup.assignedRoleUpdatedAt = "";
    }

    nextSignup.status = "approved";
    nextSignup.reviewedAt = new Date().toISOString();
  } else if (action === "deny") {
    nextSignup.status = "denied";
    nextSignup.reviewedAt = new Date().toISOString();
  } else if (action === "pending") {
    nextSignup.status = "pending";
    nextSignup.reviewedAt = "";
  } else if (action === "applyBucket" && !requestedRoleId) {
    return { errors: ["Choose a task bucket to apply."] };
  } else if (action !== "applyBucket") {
    return { errors: ["Please choose approve, deny, pending, or applyBucket."] };
  }

  nextSignup.updatedAt = new Date().toISOString();
  return { signup: nextSignup };
}

function updateScheduleOverride(signup, body) {
  const nextSignup = normalizeSignup(signup);
  const action = cleanText(body.action, 40);
  const shiftId = cleanText(body.shiftId, 80);
  const roleId = cleanText(body.roleId, 80);

  if (nextSignup.status !== "approved") {
    return { errors: ["Only approved requests can be edited in the scheduler."] };
  }

  if (!nextSignup.shiftIds.includes(shiftId)) {
    return { errors: ["That volunteer did not select this time window."] };
  }

  const eligibleRoleIds = getEligibleRoleIdsForShift(shiftId);
  const scheduleOverrides = { ...nextSignup.scheduleOverrides };

  if (action === "setRole") {
    if (!eligibleRoleIds.includes(roleId)) {
      return { errors: ["Choose a task available for this time window."] };
    }

    const overlappingAssignedShift = nextSignup.shiftIds.find((selectedShiftId) => {
      const override = scheduleOverrides[selectedShiftId];
      return selectedShiftId !== shiftId
        && override
        && override.roleId
        && !override.excluded
        && shiftsOverlap(selectedShiftId, shiftId);
    });

    if (overlappingAssignedShift) {
      return { errors: [`This volunteer is already assigned to an overlapping window: ${getShiftLabel(overlappingAssignedShift)}.`] };
    }

    const updatedAt = new Date().toISOString();
    scheduleOverrides[shiftId] = {
      roleId,
      excluded: false,
      updatedAt
    };

    nextSignup.shiftIds.forEach((selectedShiftId) => {
      const override = scheduleOverrides[selectedShiftId];

      if (
        selectedShiftId === shiftId
        || !shiftsOverlap(selectedShiftId, shiftId)
        || (override && (override.roleId || override.excluded))
      ) {
        return;
      }

      scheduleOverrides[selectedShiftId] = {
        roleId: "",
        excluded: true,
        updatedAt
      };
    });
  } else if (action === "remove") {
    scheduleOverrides[shiftId] = {
      roleId: "",
      excluded: true,
      updatedAt: new Date().toISOString()
    };
  } else if (action === "restore") {
    delete scheduleOverrides[shiftId];
  } else {
    return { errors: ["Choose setRole, remove, or restore."] };
  }

  nextSignup.scheduleOverrides = scheduleOverrides;
  nextSignup.updatedAt = new Date().toISOString();

  return { signup: nextSignup };
}

async function serveStatic(request, response, pathname) {
  let requestedPath = pathname === "/" ? "/index.html" : pathname;

  if ([COORDINATOR_PAGE_PATH, COORDINATOR_HTML_PATH].includes(requestedPath)) {
    response.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8"
    });
    response.end(coordinatorPageHtml);
    return;
  }

  let decodedPath = "";

  try {
    decodedPath = decodeURIComponent(requestedPath);
  } catch (error) {
    sendText(response, 400, "Bad request");
    return;
  }

  const relativePath = decodedPath.replace(/^\/+/, "");
  const filePath = path.normalize(path.join(PUBLIC_DIR, relativePath));

  if (!filePath.startsWith(PUBLIC_DIR + path.sep) && filePath !== PUBLIC_DIR) {
    sendText(response, 403, "Forbidden");
    return;
  }

  try {
    const content = await readFile(filePath);
    const extension = path.extname(filePath).toLowerCase();
    response.writeHead(200, {
      "Content-Type": mimeTypes[extension] || "application/octet-stream"
    });
    response.end(content);
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "EISDIR") {
      sendText(response, 404, "Not found");
      return;
    }

    throw error;
  }
}

async function handleRequest(request, response) {
  const requestUrl = new URL(request.url, `http://${request.headers.host}`);

  if (request.method === "OPTIONS") {
    response.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    });
    response.end();
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/config") {
    sendJson(response, 200, { shifts, roles, requiredAcknowledgements });
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/availability") {
    const signups = await readSignups();
    sendJson(response, 200, { shifts: getAvailability(signups) });
    return;
  }

  if (request.method === "GET" && [COORDINATOR_PAGE_PATH, COORDINATOR_HTML_PATH].includes(requestUrl.pathname)) {
    if (!isAdminAuthorized(requestUrl, {}, request)) {
      sendAdminUnauthorized(response);
      return;
    }
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/admin/dashboard") {
    if (!isAdminAuthorized(requestUrl, {}, request)) {
      sendAdminUnauthorized(response);
      return;
    }

    const signups = await readSignups();
    sendJson(response, 200, getAdminDashboard(signups));
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/admin/storage-health") {
    if (!isAdminAuthorized(requestUrl, {}, request)) {
      sendAdminUnauthorized(response);
      return;
    }

    if (!useSupabaseStorage()) {
      sendJson(response, 200, {
        ok: true,
        storage: "local-json",
        supabaseConfigured: false
      });
      return;
    }

    try {
      await requestSupabase("?select=id&limit=1", { method: "GET" });
      sendJson(response, 200, {
        ok: true,
        storage: "supabase",
        supabaseConfigured: true,
        table: SUPABASE_SIGNUPS_TABLE
      });
    } catch (error) {
      sendJson(response, 500, {
        ok: false,
        storage: "supabase",
        supabaseConfigured: true,
        table: SUPABASE_SIGNUPS_TABLE,
        error: "Supabase storage check failed. Confirm SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and the signups table schema.",
        detail: error.message
      });
    }
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/admin/signup-action") {
    let body;

    try {
      body = await readJsonBody(request);
    } catch (error) {
      sendJson(response, 400, { errors: [error.message] });
      return;
    }

    if (!isAdminAuthorized(requestUrl, body, request)) {
      sendAdminUnauthorized(response);
      return;
    }

    await queueSignupWrite(async () => {
      const signups = (await readSignups()).map(normalizeSignup);
      const signupIndex = signups.findIndex((signup) => signup.id === body.signupId);

      if (signupIndex === -1) {
        sendJson(response, 404, { errors: ["Signup request was not found."] });
        return;
      }

      const result = updateSignupWorkflow(signups[signupIndex], body);

      if (result.errors) {
        sendJson(response, 400, { errors: result.errors });
        return;
      }

      signups[signupIndex] = result.signup;
      await writeSignups(signups);
      sendJson(response, 200, getAdminDashboard(signups));
    });
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/admin/schedule-action") {
    let body;

    try {
      body = await readJsonBody(request);
    } catch (error) {
      sendJson(response, 400, { errors: [error.message] });
      return;
    }

    if (!isAdminAuthorized(requestUrl, body, request)) {
      sendAdminUnauthorized(response);
      return;
    }

    await queueSignupWrite(async () => {
      const signups = (await readSignups()).map(normalizeSignup);
      const signupIndex = signups.findIndex((signup) => signup.id === body.signupId);

      if (signupIndex === -1) {
        sendJson(response, 404, { errors: ["Signup request was not found."] });
        return;
      }

      const result = updateScheduleOverride(signups[signupIndex], body);

      if (result.errors) {
        sendJson(response, 400, { errors: result.errors });
        return;
      }

      signups[signupIndex] = result.signup;
      await writeSignups(signups);
      sendJson(response, 200, getAdminDashboard(signups));
    });
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/admin/auto-assign-remaining") {
    let body;

    try {
      body = await readJsonBody(request);
    } catch (error) {
      sendJson(response, 400, { errors: [error.message] });
      return;
    }

    if (!isAdminAuthorized(requestUrl, body, request)) {
      sendAdminUnauthorized(response);
      return;
    }

    await queueSignupWrite(async () => {
      const signups = (await readSignups()).map(normalizeSignup);
      const autoAssign = autoAssignRemainingApprovedSignups(signups);

      if (autoAssign.result.assignedWindows > 0) {
        await writeSignups(autoAssign.signups);
      }

      sendJson(response, 200, {
        ...getAdminDashboard(autoAssign.signups),
        autoAssignResult: autoAssign.result
      });
    });
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/signups.csv") {
    if (!isAdminAuthorized(requestUrl, {}, request)) {
      sendAdminUnauthorized(response);
      return;
    }

    const signups = await readSignups();
    sendText(response, 200, signupsToCsv(signups), "text/csv; charset=utf-8");
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/health") {
    sendJson(response, 200, { ok: true });
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/signup") {
    let body;

    try {
      body = await readJsonBody(request);
    } catch (error) {
      sendJson(response, 400, { errors: [error.message] });
      return;
    }

    await queueSignupWrite(async () => {
      const signups = await readSignups();
      const validation = validateSignup(body, signups);

      if (!validation.valid) {
        sendJson(response, 400, { errors: validation.errors });
        return;
      }

      signups.push(validation.record);
      await writeSignups(signups);
      const shiftLabels = new Map(shifts.map((shift) => [shift.id, getShiftLabel(shift.id)]));
      sendJson(response, 201, {
        message: "Availability received.",
        signup: {
          id: validation.record.id,
          name: validation.record.name,
          shifts: validation.record.shiftIds.map((shiftId) => shiftLabels.get(shiftId) || shiftId)
        },
        availability: getAvailability(signups)
      });
    });
    return;
  }

  if (request.method === "GET") {
    await serveStatic(request, response, requestUrl.pathname);
    return;
  }

  sendText(response, 405, "Method not allowed");
}

function handleUnexpectedError(error, response) {
  console.error(error);
  sendJson(response, 500, { errors: ["Unexpected server error."] });
}

const server = http.createServer((request, response) => {
  handleRequest(request, response).catch((error) => {
    handleUnexpectedError(error, response);
  });
});

function vercelHandler(request, response) {
  handleRequest(request, response).catch((error) => {
    handleUnexpectedError(error, response);
  });
}

if (require.main === module) {
  let activePort = PORT;

  server.on("error", (error) => {
    if (error.code === "EADDRINUSE" && activePort < PORT + 50) {
      activePort += 1;
      console.log(`Port ${activePort - 1} is in use. Trying ${activePort}...`);
      server.listen(activePort);
      return;
    }

    throw error;
  });

  server.listen(activePort, () => {
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : activePort;
    console.log(`Big Dog Ranch Rescue volunteer signup site running at http://localhost:${port}`);
  });
}

module.exports = vercelHandler;
module.exports.handleRequest = handleRequest;
module.exports.handleUnexpectedError = handleUnexpectedError;