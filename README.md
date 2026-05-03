# Big Dog Ranch Rescue Beagle Intake Volunteer Signup

A small volunteer availability website for Big Dog Ranch Rescue beagle intake support. Volunteers submit one contact card, select every shift when they may be available, note task preferences and relevant experience, and wait for Big Dog Ranch Rescue outreach to confirm final role and shift placement.

The server collects contact information, records multi-shift availability, blocks volunteers currently fostering sick dogs, and requires confidentiality/media/biosecurity acknowledgements before submission.

## Run locally

```powershell
npm start
```

Open `http://localhost:3000`.

If that port is busy, the server automatically tries the next available port and prints the local URL in the terminal.

## Data

Submitted contact cards are saved to `data/signups.json`. That file is ignored by git because it contains volunteer contact information.

Coordinators can export a roster at `http://localhost:3000/api/signups.csv`. Before public deployment, set an admin code so exports require a code:

```powershell
$env:ADMIN_USERNAME = "choose-a-private-username"
$env:ADMIN_PASSWORD = "choose-a-private-password"
npm start
```

The coordinator review desk is available at `http://localhost:3000/ridglan-beagle-intake-coordinator-desk`. Keep this URL off the public signup page. Coordinators work through Review Queue for compact request triage, Task Placement for approved volunteer assignments, Denied for declined requests, Fill Needs for task/time-window gaps, and Schedule for final schedule review and persistent per-window edits or removals. Multi-shift volunteers are not automatically assigned to every selected window; coordinators assign or skip each exact window. The unique page name is convenience only; set `ADMIN_USERNAME` and `ADMIN_PASSWORD` before deployment to protect dashboard data, coordinator actions, and CSV exports.

From the Schedule tab, choose a day from Print day and use Save Day to PDF to open the browser print dialog with a letter-size schedule sheet. Choose Save as PDF or print from that dialog.

## Public deployment notes

- Use HTTPS because the form collects names, phone numbers, and email addresses.
- Protect exports and any roster views with authentication.
- Review the legal language with counsel before publishing.
- For high-volume public use, replace the local JSON file with a database or hosted form backend.