const form = document.querySelector("#signupForm");
const shiftList = document.querySelector("#shiftList");
const roleList = document.querySelector("#roleList");
const submitButton = document.querySelector("#submitButton");
const formMessage = document.querySelector("#formMessage");
const healthNotice = document.querySelector("#healthNotice");
const legalTerms = document.querySelector("#legalTerms");
const legalReviewStatus = document.querySelector("#legalReviewStatus");
const legalConfirmation = document.querySelector("#legalConfirmation");
const roleWindowNotice = document.querySelector("#roleWindowNotice");

const EVENING_CLEAN_PREP_ROLE_ID = "evening-clean-prep";

const state = {
  roles: [],
  shifts: [],
  requiredAcknowledgements: []
};

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const payload = await response.json();

  if (!response.ok) {
    const error = new Error("Request failed");
    error.payload = payload;
    throw error;
  }

  return payload;
}

function renderShifts() {
  shiftList.replaceChildren();

  state.shifts.forEach((shift) => {
    const label = document.createElement("label");
    label.className = "shift-option";

    const input = document.createElement("input");
    input.type = "checkbox";
    input.name = "shiftIds";
    input.value = shift.id;

    const content = document.createElement("span");

    const day = document.createElement("span");
    day.className = "shift-day";
    day.textContent = shift.day;

    const date = document.createElement("span");
    date.className = "shift-date";
    date.textContent = shift.date;

    const time = document.createElement("span");
    time.className = "shift-time";
    time.textContent = shift.time;

    const focus = document.createElement("span");
    focus.className = "shift-focus";
    focus.textContent = shift.focus;

    const capacity = document.createElement("span");
    capacity.className = "shift-capacity";
    capacity.textContent = `Target crew ${shift.target || shift.max}`;

    content.append(day, date, time, focus, capacity);
    label.append(input, content);
    shiftList.append(label);
  });
}

function renderRoles() {
  roleList.replaceChildren();

  state.roles.forEach((role) => {
    const label = document.createElement("label");
    label.className = "role-option";

    const input = document.createElement("input");
    input.type = "checkbox";
    input.name = "rolePreferences";
    input.value = role.id;

    const content = document.createElement("span");

    const title = document.createElement("strong");
    title.className = "role-title";
    title.textContent = role.label;

    const need = document.createElement("span");
    need.className = "role-need";
    need.textContent = role.need;

    const description = document.createElement("small");
    description.textContent = role.description;

    content.append(title, need, description);
    label.append(input, content);
    roleList.append(label);
  });

  updateRoleAvailabilityLock();
}

function getSelectedShiftIds() {
  return Array.from(form.querySelectorAll("input[name='shiftIds']:checked")).map((input) => input.value);
}

function isEveningCleanPrepShiftId(shiftId) {
  return shiftId.endsWith("-clean-prep");
}

function hasOnlyEveningCleanPrepAvailability() {
  return false;
}

function getRolePreferenceInputs() {
  return Array.from(form.querySelectorAll("input[name='rolePreferences']"));
}

function getSelectableRolePreferenceInputs() {
  return getRolePreferenceInputs().filter((input) => !input.disabled);
}

function syncWillingAllTasksFromRoles() {
  const willingAllTasks = form.querySelector("input[name='willingAllTasks']");
  const rolePreferenceInputs = getSelectableRolePreferenceInputs();
  const allRolesSelected = rolePreferenceInputs.length > 0 && rolePreferenceInputs.every((input) => input.checked);
  willingAllTasks.checked = allRolesSelected;
}

function setAllSelectableRolePreferences(checked) {
  getSelectableRolePreferenceInputs().forEach((input) => {
    input.checked = checked;
  });

  syncWillingAllTasksFromRoles();
}

function updateRoleAvailabilityLock() {
  if (roleWindowNotice) {
    roleWindowNotice.hidden = true;
  }
  syncWillingAllTasksFromRoles();
}

function setMessage(message, type) {
  formMessage.textContent = message;
  formMessage.classList.toggle("is-error", type === "error");
  formMessage.classList.toggle("is-success", type === "success");
}

function getAcknowledgements() {
  return Array.from(form.querySelectorAll("input[name='acknowledgement']")).reduce((result, input) => {
    result[input.value] = input.checked;
    return result;
  }, {});
}

function hasReviewedLegalTerms() {
  return legalTerms && legalTerms.dataset.reviewed === "true";
}

function updateAcknowledgementGate() {
  const reviewed = hasReviewedLegalTerms();

  form.querySelectorAll("input[name='acknowledgement']").forEach((input) => {
    input.disabled = !reviewed;
    input.closest(".ack-line")?.classList.toggle("is-locked", !reviewed);
  });

  if (legalReviewStatus) {
    legalReviewStatus.textContent = reviewed
      ? "Required terms opened. Complete each acknowledgement and type I UNDERSTAND before submitting."
      : "Open the required terms above to unlock the acknowledgement checklist.";
    legalReviewStatus.classList.toggle("is-complete", reviewed);
  }
}

function updateHealthGate() {
  const selected = form.querySelector("input[name='currentlyFosteringSickDogs']:checked");
  const isFosteringSickDogs = selected && selected.value === "yes";

  healthNotice.hidden = !isFosteringSickDogs;
  submitButton.disabled = Boolean(isFosteringSickDogs);
}

async function refreshAvailability() {
  const availability = await fetchJson("/api/availability");
  state.shifts = availability.shifts;
  renderShifts();
  updateRoleAvailabilityLock();
}

function buildPayload() {
  const formData = new FormData(form);

  return {
    name: formData.get("name"),
    phone: formData.get("phone"),
    email: formData.get("email"),
    shiftIds: formData.getAll("shiftIds"),
    rolePreferences: formData.getAll("rolePreferences"),
    willingAllTasks: formData.get("willingAllTasks") === "on",
    dogExperience: formData.get("dogExperience"),
    legalConfirmation: formData.get("legalConfirmation"),
    currentlyFosteringSickDogs: formData.get("currentlyFosteringSickDogs") === "yes",
    acknowledgements: getAcknowledgements()
  };
}

async function handleSubmit(event) {
  event.preventDefault();
  setMessage("", "");

  if (!hasReviewedLegalTerms()) {
    setMessage("Please open and review the required acknowledgement terms before submitting.", "error");
    legalTerms.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }

  if (!form.reportValidity()) {
    return;
  }

  if (legalConfirmation.value.trim().toUpperCase() !== "I UNDERSTAND") {
    setMessage("Please type I UNDERSTAND to confirm you understand the confidentiality, media, and non-disparagement requirements.", "error");
    legalConfirmation.focus();
    return;
  }

  if (form.querySelectorAll("input[name='shiftIds']:checked").length === 0) {
    setMessage("Please select every shift when you may be available.", "error");
    return;
  }

  if (!form.querySelector("input[name='willingAllTasks']").checked && form.querySelectorAll("input[name='rolePreferences']:checked").length === 0) {
    setMessage("Please choose at least one task preference or select that you are willing to help wherever needed.", "error");
    return;
  }

  const healthChoice = form.querySelector("input[name='currentlyFosteringSickDogs']:checked");
  if (healthChoice && healthChoice.value === "yes") {
    setMessage("Volunteers currently fostering sick dogs should not apply for this intake at this time.", "error");
    return;
  }

  submitButton.disabled = true;
  submitButton.textContent = "Submitting...";

  try {
    const response = await fetchJson("/api/signup", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(buildPayload())
    });

    state.shifts = response.availability;
    renderShifts();
    form.reset();
    document.querySelector("#willingAllTasks").checked = false;
    updateRoleAvailabilityLock();
    legalTerms.open = false;
    legalTerms.dataset.reviewed = "";
    updateAcknowledgementGate();
    setMessage(`${response.signup.name}, your availability has been received. Big Dog Ranch Rescue outreach will contact you to confirm role and shift placement.`, "success");
  } catch (error) {
    const errors = error.payload && Array.isArray(error.payload.errors)
      ? error.payload.errors
      : ["We could not submit the signup. Please try again."];
    setMessage(errors.join(" "), "error");
    await refreshAvailability();
  } finally {
    updateHealthGate();
    submitButton.disabled = !healthNotice.hidden;
    submitButton.textContent = "Send Availability to Big Dog Ranch Rescue Outreach";
  }
}

async function init() {
  try {
    const [config, availability] = await Promise.all([
      fetchJson("/api/config"),
      fetchJson("/api/availability")
    ]);

    state.roles = config.roles;
    state.requiredAcknowledgements = config.requiredAcknowledgements;
    state.shifts = availability.shifts;

    renderRoles();
    renderShifts();
    updateRoleAvailabilityLock();
  } catch (error) {
    setMessage("The signup site could not load shift information. Please refresh the page.", "error");
  }
}

form.addEventListener("submit", handleSubmit);
form.addEventListener("change", (event) => {
  if (event.target.name === "currentlyFosteringSickDogs") {
    updateHealthGate();
  }

  if (event.target.name === "shiftIds") {
    updateRoleAvailabilityLock();
  }

  if (event.target.name === "rolePreferences") {
    syncWillingAllTasksFromRoles();
  }

  if (event.target.name === "willingAllTasks") {
    setAllSelectableRolePreferences(event.target.checked);
  }
});

legalTerms.addEventListener("toggle", () => {
  if (legalTerms.open) {
    legalTerms.dataset.reviewed = "true";
    updateAcknowledgementGate();
  }
});

updateAcknowledgementGate();

init();