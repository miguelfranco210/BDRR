const summaryBar = document.querySelector("#summaryBar");
const tabButtons = Array.from(document.querySelectorAll("[data-view]"));
const views = {
  review: document.querySelector("#reviewView"),
  needs: document.querySelector("#needsView"),
  schedule: document.querySelector("#scheduleView")
};
const reviewList = document.querySelector("#reviewList");
const requestDetail = document.querySelector("#requestDetail");
const reviewGapPanel = document.querySelector("#reviewGapPanel");
const reviewPanelTitle = document.querySelector("#requests-title");
const reviewPanelCopy = document.querySelector("#requests-copy");
const reviewAssignmentFilter = document.querySelector("#reviewAssignmentFilter");
const reviewAssignmentFilterLabel = reviewAssignmentFilter.closest("label");
const reviewTimeFilter = document.querySelector("#reviewTimeFilter");
const reviewTaskFilter = document.querySelector("#reviewTaskFilter");
const reviewSearch = document.querySelector("#reviewSearch");
const clearReviewFilters = document.querySelector("#clearReviewFilters");
const reviewResultCount = document.querySelector("#reviewResultCount");
const loadMoreReviews = document.querySelector("#loadMoreReviews");
const placementBulkActions = document.querySelector("#placementBulkActions");
const autoAssignRemaining = document.querySelector("#autoAssignRemaining");
const autoAssignStatus = document.querySelector("#autoAssignStatus");
const needBoard = document.querySelector("#needBoard");
const candidatePanel = document.querySelector("#candidatePanel");
const scheduleDayFilter = document.querySelector("#scheduleDayFilter");
const printScheduleDay = document.querySelector("#printScheduleDay");
const refreshSchedule = document.querySelector("#refreshSchedule");
const scheduleBoard = document.querySelector("#scheduleBoard");
const unscheduledList = document.querySelector("#unscheduledList");
const printScheduleSheet = document.querySelector("#printScheduleSheet");

const REVIEW_VIEWS = new Set(["review", "placement", "denied"]);

const codeFromUrl = new URLSearchParams(window.location.search).get("code") || "";

if (codeFromUrl) {
  sessionStorage.setItem("bdrrAdminCode", codeFromUrl);
  history.replaceState(null, "", window.location.pathname);
}

const state = {
  dashboard: null,
  adminCode: codeFromUrl || sessionStorage.getItem("bdrrAdminCode") || "",
  activeView: "review",
  reviewAssignmentFilter: "unassigned",
  reviewTimeFilter: "",
  reviewTaskFilter: "",
  reviewSearch: "",
  reviewLimit: 25,
  selectedSignupId: "",
  selectedNeed: null,
  selectedScheduleDay: "",
  autoAssignMessage: "",
  autoAssignMessageType: ""
};

function getAdminCodeSuffix() {
  return state.adminCode ? `?code=${encodeURIComponent(state.adminCode)}` : "";
}

function isReviewWorkspaceView(viewName = state.activeView) {
  return REVIEW_VIEWS.has(viewName);
}

function getReviewWorkspaceConfig() {
  if (state.activeView === "placement") {
    return {
      title: "Task Placement",
      copy: "Assign approved volunteers to exact time windows, skip windows they will not cover, and focus gaps by task need.",
      countLabel: "Approved placement",
      empty: "No approved volunteers match this placement filter."
    };
  }

  if (state.activeView === "denied") {
    return {
      title: "Denied Requests",
      copy: "Keep denied requests separate from active review and task placement. Move a request back to review if it needs another look.",
      countLabel: "Denied",
      empty: "No denied requests match this filter."
    };
  }

  return {
    title: "Review Queue",
    copy: "Approve or deny pending requests from a compact queue. Approved requests move to Task Placement.",
    countLabel: "Pending review",
    empty: "No pending requests match this filter."
  };
}

function showDashboardMessage(message, type = "") {
  [reviewGapPanel, reviewList, requestDetail, needBoard, candidatePanel, scheduleBoard, unscheduledList, printScheduleSheet].forEach((container) => {
    container.replaceChildren();
  });

  const empty = document.createElement("p");
  empty.className = `empty-state ${type === "error" ? "is-error" : ""}`;
  empty.textContent = message;
  reviewList.append(empty);
}

function showStatusMessage(message, type = "") {
  const messageNode = document.createElement("p");
  messageNode.className = `desk-message ${type === "error" ? "is-error" : ""}`;
  messageNode.textContent = message;
  summaryBar.replaceChildren(messageNode);
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const payload = await response.json();

  if (!response.ok) {
    const error = new Error(payload.error || (payload.errors && payload.errors.join(" ")) || "Request failed.");
    error.payload = payload;
    throw error;
  }

  return payload;
}

function formatDate(value) {
  if (!value) {
    return "Not recorded";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

function truncateText(value, maxLength = 90) {
  const text = (value || "").trim();

  if (text.length <= maxLength) {
    return text || "No input provided.";
  }

  return `${text.slice(0, maxLength - 3).trim()}...`;
}

function compactList(values, maxItems = 2) {
  if (!values || values.length === 0) {
    return "None listed";
  }

  if (values.length <= maxItems) {
    return values.join(", ");
  }

  return `${values.slice(0, maxItems).join(", ")} +${values.length - maxItems} more`;
}

function getRoleLabel(roleId) {
  const role = state.dashboard.roles.find((item) => item.id === roleId);
  return role ? role.label : roleId;
}

function getShiftLabel(shiftId) {
  const shift = state.dashboard.shifts.find((item) => item.id === shiftId);
  return shift ? getShiftDisplayLabel(shift) : shiftId;
}

function getShiftDisplayLabel(shift) {
  return shift.date ? `${shift.day} ${shift.date} ${shift.time}` : `${shift.day} ${shift.time}`;
}

function getScheduleDayLabel(day) {
  const shift = state.dashboard.shifts.find((item) => item.day === day);
  return shift?.date ? `${day} ${shift.date}` : day;
}

function getShortShiftLabel(shiftId) {
  const shift = state.dashboard.shifts.find((item) => item.id === shiftId);

  if (!shift) {
    return shiftId;
  }

  const date = shift.date ? ` ${shift.date.replace(/\/\d{4}$/, "")}` : "";
  return `${shift.day.slice(0, 3)}${date} ${shift.time.replace(/:00/g, "")}`;
}

function getShiftSchedule(shiftId) {
  return state.dashboard.schedule.shifts.find((shift) => shift.id === shiftId);
}

function getShiftById(shiftId) {
  return state.dashboard.shifts.find((shift) => shift.id === shiftId);
}

function parseShiftTimeRange(shift) {
  const match = shift.time.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)\s*-\s*(\d{1,2}):(\d{2})\s*(AM|PM)$/i);

  if (!match) {
    return { start: 0, end: 0 };
  }

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
    start: toMinutes(match[1], match[2], match[3]),
    end: toMinutes(match[4], match[5], match[6])
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

function getScheduleDays() {
  if (!state.dashboard) {
    return [];
  }

  return [...new Set(state.dashboard.schedule.shifts.map((shift) => shift.day))];
}

function getSelectedDayShifts() {
  if (!state.dashboard || !state.selectedScheduleDay) {
    return [];
  }

  return state.dashboard.schedule.shifts.filter((shift) => shift.day === state.selectedScheduleDay);
}

function getEligibleRoleIdsForShift(shiftId) {
  return Object.keys(state.dashboard.bucketLoads?.[shiftId] || {});
}

function getShiftRoleTarget(shiftId, roleId) {
  return state.dashboard.bucketLoads?.[shiftId]?.[roleId]?.target || 0;
}

function getAssignedCount(shiftId, roleId) {
  const shiftSchedule = getShiftSchedule(shiftId);

  if (!shiftSchedule) {
    return 0;
  }

  return shiftSchedule.assignments.filter((assignment) => assignment.roleId === roleId).length;
}

function getShiftRoleLoadSummary(shiftId, roleId) {
  const assigned = getAssignedCount(shiftId, roleId);
  const target = getShiftRoleTarget(shiftId, roleId);
  return target ? `${assigned}/${target} assigned` : `${assigned} assigned`;
}

function getShiftRoleLoadRatio(shiftId, roleId) {
  const assigned = getAssignedCount(shiftId, roleId);
  const target = getShiftRoleTarget(shiftId, roleId);
  return target ? `${assigned}/${target}` : String(assigned);
}

function getBucketLoadEntries(signup, roleId) {
  return signup.shiftIds.map((shiftId) => {
    const load = state.dashboard.bucketLoads?.[shiftId]?.[roleId];

    if (!load) {
      return null;
    }

    return {
      shiftId,
      shortLabel: getShortShiftLabel(shiftId),
      assigned: getAssignedCount(shiftId, roleId),
      target: load.target
    };
  }).filter(Boolean);
}

function isMultiShiftSignup(signup) {
  return signup.shiftIds.length > 1;
}

function getBucketLoadSummary(signup, roleId) {
  const entries = getBucketLoadEntries(signup, roleId);

  if (entries.length === 0) {
    return "No target set";
  }

  if (entries.length === 1) {
    return `${entries[0].assigned}/${entries[0].target} assigned`;
  }

  return entries.map((entry) => `${entry.shortLabel}: ${entry.assigned}/${entry.target}`).join(" | ");
}

function getAssignmentForSignupShift(signupId, shiftId) {
  const shiftSchedule = getShiftSchedule(shiftId);

  if (!shiftSchedule) {
    return null;
  }

  return shiftSchedule.assignments.find((assignment) => assignment.signupId === signupId) || null;
}

function getRemovedAssignmentForSignupShift(signupId, shiftId) {
  const shiftSchedule = getShiftSchedule(shiftId);

  if (!shiftSchedule || !shiftSchedule.removed) {
    return null;
  }

  return shiftSchedule.removed.find((assignment) => assignment.signupId === signupId) || null;
}

function getScheduleOverrideForSignupShift(signup, shiftId) {
  return signup.scheduleOverrides && signup.scheduleOverrides[shiftId]
    ? signup.scheduleOverrides[shiftId]
    : null;
}

function getAssignedOverlappingShiftId(signup, shiftId) {
  return signup.shiftIds.find((selectedShiftId) => (
    selectedShiftId !== shiftId
    && shiftsOverlap(selectedShiftId, shiftId)
    && getAssignmentForSignupShift(signup.id, selectedShiftId)
  )) || "";
}

function getSkippedDecisionForSignupShift(signup, shiftId) {
  const assignment = getAssignmentForSignupShift(signup.id, shiftId);

  if (assignment) {
    return null;
  }

  const override = getScheduleOverrideForSignupShift(signup, shiftId);
  const removed = getRemovedAssignmentForSignupShift(signup.id, shiftId);
  const assignedOverlappingShiftId = removed?.assignedOverlappingShiftId || getAssignedOverlappingShiftId(signup, shiftId);

  if ((override && override.excluded) || removed) {
    return {
      source: override && override.excluded ? "manual" : removed?.source || (assignedOverlappingShiftId ? "overlap" : "manual"),
      removed,
      assignedOverlappingShiftId
    };
  }

  return assignedOverlappingShiftId ? { source: "overlap", assignedOverlappingShiftId } : null;
}

function getWindowDecisionProgress(signup) {
  const total = signup.shiftIds.length;
  const assignedCount = signup.shiftIds.filter((shiftId) => getAssignmentForSignupShift(signup.id, shiftId)).length;
  const skippedCount = signup.shiftIds.filter((shiftId) => getSkippedDecisionForSignupShift(signup, shiftId)).length;
  const undecidedCount = Math.max(total - assignedCount - skippedCount, 0);

  return { total, assignedCount, skippedCount, undecidedCount };
}

function signupHasOpenWindowDecision(signup) {
  return getWindowDecisionProgress(signup).undecidedCount > 0;
}

function getWindowDecisionSummary(signup) {
  const progress = getWindowDecisionProgress(signup);
  const parts = [`${progress.assignedCount}/${progress.total} assigned`];

  if (progress.skippedCount > 0) {
    parts.push(`${progress.skippedCount} skipped`);
  }

  parts.push(progress.undecidedCount > 0 ? `${progress.undecidedCount} left unassigned` : "all windows decided");
  return parts.join(" | ");
}

function createStatusPill(status) {
  const pill = document.createElement("span");
  pill.className = `status-pill status-${status}`;
  pill.textContent = status;
  return pill;
}

function createChip(text, modifier = "") {
  const chip = document.createElement("span");
  chip.className = `data-chip ${modifier}`.trim();
  chip.textContent = text;
  return chip;
}

function renderChipGroup(label, values, modifier = "") {
  const group = document.createElement("section");
  group.className = "request-chip-group";

  const heading = document.createElement("h4");
  heading.textContent = label;

  const chips = document.createElement("div");
  chips.className = "data-chip-list";

  if (!values || values.length === 0) {
    chips.append(createChip("None listed", "is-muted"));
  } else {
    values.forEach((value) => chips.append(createChip(value, modifier)));
  }

  group.append(heading, chips);
  return group;
}

function getExperienceSignal(signup) {
  const input = (signup.dogExperience || "").trim();
  const lower = input.toLowerCase();

  if (!input) {
    return { label: "No experience input", kind: "review" };
  }

  if (/\b(no|none|n\/a|na)\b/.test(lower) && input.length < 40) {
    return { label: "Needs experience review", kind: "review" };
  }

  const experienceTerms = [
    "rescue",
    "shelter",
    "kennel",
    "veterinary",
    "vet",
    "foster",
    "handler",
    "handling",
    "volunteer",
    "dogs",
    "dog"
  ];

  if (experienceTerms.some((term) => lower.includes(term))) {
    return { label: "Experience noted", kind: "strong" };
  }

  return { label: "Read input", kind: "neutral" };
}

function renderExperienceFlag(signup) {
  const signal = getExperienceSignal(signup);
  const flag = document.createElement("span");
  flag.className = `experience-flag ${signal.kind}`;
  flag.textContent = signal.label;
  return flag;
}

function getCandidateFit(signup, roleId) {
  if (signup.rolePreferences.includes(roleId)) {
    return { label: "Preferred task", rank: 0 };
  }

  if (signup.willingAllTasks && signup.eligibleRoleIds.includes(roleId)) {
    return { label: "Willing any task", rank: 2 };
  }

  return null;
}

function matchesTaskNeed(signup, roleId) {
  if (!roleId) {
    return true;
  }

  return Boolean(getCandidateFit(signup, roleId));
}

function populateReviewFilters() {
  const selectedTime = state.reviewTimeFilter;
  const selectedTask = state.reviewTaskFilter;

  reviewTimeFilter.replaceChildren();
  reviewTaskFilter.replaceChildren();

  const allTimes = document.createElement("option");
  allTimes.value = "";
  allTimes.textContent = "All time windows";
  reviewTimeFilter.append(allTimes);

  state.dashboard.shifts.forEach((shift) => {
    const option = document.createElement("option");
    option.value = shift.id;
    option.textContent = getShiftDisplayLabel(shift);
    reviewTimeFilter.append(option);
  });

  const allTasks = document.createElement("option");
  allTasks.value = "";
  allTasks.textContent = "All preferred tasks";
  reviewTaskFilter.append(allTasks);

  state.dashboard.roles.forEach((role) => {
    const option = document.createElement("option");
    option.value = role.id;
    option.textContent = role.label;
    reviewTaskFilter.append(option);
  });

  reviewAssignmentFilter.value = state.reviewAssignmentFilter;
  reviewTimeFilter.value = selectedTime;
  reviewTaskFilter.value = selectedTask;
  reviewSearch.value = state.reviewSearch;
}

function getAssignmentFilterLabel(value = state.reviewAssignmentFilter) {
  const labels = {
    unassigned: "Unassigned",
    assigned: "Assigned",
    all: "All requests"
  };

  return labels[value] || labels.unassigned;
}

function matchesAssignmentFilter(signup) {
  const hasOpenDecision = signupHasOpenWindowDecision(signup);

  if (state.reviewAssignmentFilter === "all") {
    return true;
  }

  if (state.reviewAssignmentFilter === "assigned") {
    return signup.status !== "denied" && !hasOpenDecision;
  }

  return signup.status !== "denied" && hasOpenDecision;
}

function matchesActiveReviewStatus(signup) {
  if (state.activeView === "placement") {
    return signup.status === "approved";
  }

  if (state.activeView === "denied") {
    return signup.status === "denied";
  }

  return signup.status === "pending";
}

function matchesReviewFilters(signup) {
  const statusMatches = matchesActiveReviewStatus(signup);
  const assignmentMatches = state.activeView === "placement" ? matchesAssignmentFilter(signup) : true;
  const timeMatches = !state.reviewTimeFilter || signup.shiftIds.includes(state.reviewTimeFilter);
  const taskMatches = matchesTaskNeed(signup, state.reviewTaskFilter);
  const searchText = state.reviewSearch.toLowerCase();
  const searchableText = [
    signup.name,
    signup.phone,
    signup.email,
    signup.dogExperience,
    signup.shiftLabels.join(" "),
    signup.rolePreferenceLabels.join(" "),
    signup.assignedRoleLabel
  ].join(" ").toLowerCase();
  const searchMatches = !searchText || searchableText.includes(searchText);

  return statusMatches && assignmentMatches && timeMatches && taskMatches && searchMatches;
}

function getFilteredReviewSignups() {
  const statusOrder = { pending: 0, approved: 1, denied: 2 };
  return state.dashboard.signups
    .filter(matchesReviewFilters)
    .sort((first, second) => {
      const firstAssignmentOrder = state.activeView === "placement" && signupHasOpenWindowDecision(first) ? 0 : 1;
      const secondAssignmentOrder = state.activeView === "placement" && signupHasOpenWindowDecision(second) ? 0 : 1;
      return firstAssignmentOrder - secondAssignmentOrder
        || statusOrder[first.status] - statusOrder[second.status]
        || new Date(first.submittedAt) - new Date(second.submittedAt);
    });
}

function updateReviewResultCount(visibleCount, totalCount) {
  const config = getReviewWorkspaceConfig();
  const parts = [`${Math.min(visibleCount, totalCount)} of ${totalCount} shown`, state.activeView === "placement" ? getAssignmentFilterLabel() : config.countLabel];

  if (state.reviewTimeFilter) {
    parts.push(getShiftLabel(state.reviewTimeFilter));
  }

  if (state.reviewTaskFilter) {
    parts.push(getRoleLabel(state.reviewTaskFilter));
  }

  reviewResultCount.textContent = parts.join(" | ");
}

function getOpenNeeds() {
  const needs = [];

  state.dashboard.shifts.forEach((shift, shiftIndex) => {
    getEligibleRoleIdsForShift(shift.id).forEach((roleId, roleIndex) => {
      const assigned = getAssignedCount(shift.id, roleId);
      const target = getShiftRoleTarget(shift.id, roleId);

      if (assigned < target) {
        needs.push({
          shiftId: shift.id,
          roleId,
          assigned,
          target,
          shortfall: target - assigned,
          unassignedMatches: getUnassignedCandidateCount(shift.id, roleId),
          sortOrder: shiftIndex * 100 + roleIndex
        });
      }
    });
  });

  return needs.sort((first, second) => (
    second.unassignedMatches - first.unassignedMatches
    || second.shortfall - first.shortfall
    || first.sortOrder - second.sortOrder
  ));
}

function focusReviewOnNeed(shiftId, roleId) {
  state.activeView = "placement";
  state.reviewAssignmentFilter = "unassigned";
  state.reviewTimeFilter = shiftId;
  state.reviewTaskFilter = roleId;
  state.reviewSearch = "";
  state.reviewLimit = 25;
  state.selectedNeed = { shiftId, roleId };
  const firstMatch = getFilteredReviewSignups()[0];
  state.selectedSignupId = firstMatch ? firstMatch.id : "";
  populateReviewFilters();
  renderReviewGapPanel();
  renderReviewQueue();
  renderRequestDetail();
}

function renderReviewGapPanel() {
  reviewGapPanel.replaceChildren();
  reviewGapPanel.hidden = state.activeView !== "placement";

  if (!state.dashboard || state.activeView !== "placement") {
    return;
  }

  const heading = document.createElement("div");
  heading.className = "review-gap-heading";
  const title = document.createElement("h3");
  title.textContent = "Schedule gaps to review first";
  const copy = document.createElement("p");
  copy.textContent = "Click a shortage to focus unassigned requests that can help fill it.";
  heading.append(title, copy);

  const needs = getOpenNeeds();
  const actions = document.createElement("div");
  actions.className = "review-gap-list";

  if (needs.length === 0) {
    const filled = document.createElement("p");
    filled.className = "empty-state compact-empty-state";
    filled.textContent = "No open staffing gaps right now.";
    reviewGapPanel.append(heading, filled);
    return;
  }

  needs.slice(0, 8).forEach((need) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "review-gap-chip";
    button.classList.toggle("is-active", state.reviewTimeFilter === need.shiftId && state.reviewTaskFilter === need.roleId);
    button.classList.toggle("has-no-unassigned", need.unassignedMatches === 0);
    const role = document.createElement("span");
    role.textContent = getRoleLabel(need.roleId);
    const meta = document.createElement("small");
    meta.textContent = `${getShortShiftLabel(need.shiftId)} | ${need.assigned}/${need.target} filled | ${need.unassignedMatches} unassigned fit`;
    button.append(role, meta);
    button.addEventListener("click", () => focusReviewOnNeed(need.shiftId, need.roleId));
    actions.append(button);
  });

  const viewNeedsButton = document.createElement("button");
  viewNeedsButton.type = "button";
  viewNeedsButton.className = "text-button compact-text-button";
  viewNeedsButton.textContent = "View All Needs";
  viewNeedsButton.addEventListener("click", () => setActiveView("needs"));

  reviewGapPanel.append(heading, actions, viewNeedsButton);
}

function selectSignup(signupId) {
  state.selectedSignupId = state.selectedSignupId === signupId ? "" : signupId;
  renderReviewQueue();
  renderRequestDetail();
  document.querySelector(".inline-detail-row")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function renderReviewActionButton(label, className, handler) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  button.addEventListener("click", handler);
  return button;
}

function renderSkipWindowButton(signupId, shiftId) {
  return renderReviewActionButton("Skip Window", "text-button mini-button", () => updateScheduleAssignment(signupId, shiftId, "remove", ""));
}

function renderUndoSkipButton(signupId, shiftId) {
  return renderReviewActionButton("Undo Skip", "text-button mini-button", () => updateScheduleAssignment(signupId, shiftId, "restore", ""));
}

function renderReviewRow(signup) {
  const row = document.createElement("tr");
  row.className = signup.id === state.selectedSignupId ? "is-selected" : "";
  const progress = getWindowDecisionProgress(signup);
  const hasOpenDecision = progress.undecidedCount > 0;

  const volunteerCell = document.createElement("td");
  const nameButton = document.createElement("button");
  nameButton.type = "button";
  nameButton.className = "row-title-button";
  nameButton.textContent = signup.name;
  nameButton.addEventListener("click", () => selectSignup(signup.id));
  const submitted = document.createElement("small");
  submitted.textContent = `Submitted ${formatDate(signup.submittedAt)}`;
  const badgeRow = document.createElement("div");
  badgeRow.className = "volunteer-badge-row";

  if (state.activeView === "placement") {
    badgeRow.append(createChip(hasOpenDecision ? "Unassigned" : "Assigned", `assignment-chip ${hasOpenDecision ? "is-unassigned" : "is-assigned"}`));
  }

  badgeRow.append(createStatusPill(signup.status), renderExperienceFlag(signup));

  if (isMultiShiftSignup(signup)) {
    badgeRow.append(createChip("Multi-shift volunteer", "multi-shift-chip"));
  }

  volunteerCell.append(nameButton, badgeRow, submitted);

  const availabilityCell = document.createElement("td");
  const availabilitySummary = document.createElement("strong");
  availabilitySummary.textContent = isMultiShiftSignup(signup) ? `${signup.shiftIds.length} windows selected` : "1 window selected";
  const availabilityDetail = document.createElement("small");
  availabilityDetail.textContent = compactList(signup.shiftLabels, 2);
  availabilityCell.append(availabilitySummary, availabilityDetail);

  if (state.activeView === "placement") {
    const assignmentDetail = document.createElement("small");
    assignmentDetail.className = "assignment-progress-text";
    assignmentDetail.textContent = getWindowDecisionSummary(signup);
    availabilityCell.append(assignmentDetail);
  }

  const taskCell = document.createElement("td");
  const activeFit = state.reviewTaskFilter ? getCandidateFit(signup, state.reviewTaskFilter) : null;
  const taskSummary = document.createElement("strong");
  taskSummary.textContent = activeFit ? activeFit.label : signup.willingAllTasks ? "Any task" : compactList(signup.rolePreferenceLabels, 2);
  const taskDetail = document.createElement("small");
  taskDetail.textContent = state.reviewTaskFilter
    ? getRoleLabel(state.reviewTaskFilter)
    : state.activeView === "placement" ? "Use a gap chip to focus this column." : "Use task or search filters to narrow this list.";
  const experiencePreview = document.createElement("small");
  experiencePreview.className = "review-experience-preview";
  experiencePreview.textContent = `Experience: ${truncateText(signup.dogExperience || "No experience input provided.", 130)}`;
  experiencePreview.title = signup.dogExperience || "No experience input provided.";
  taskCell.append(taskSummary, taskDetail, experiencePreview);

  const actionsCell = document.createElement("td");
  const actions = document.createElement("div");
  actions.className = "row-action-group";

  if (state.activeView === "review") {
    actions.append(renderReviewActionButton("Approve", "primary-button mini-button", () => updateSignup(signup.id, "approve", "")));
    actions.append(renderReviewActionButton("Deny", "danger-button mini-button", () => updateSignup(signup.id, "deny", "")));
  } else if (state.activeView === "placement") {
    actions.append(renderReviewActionButton("Deny", "danger-button mini-button", () => updateSignup(signup.id, "deny", "")));
    actions.append(renderReviewActionButton("Back to Review", "text-button mini-button", () => updateSignup(signup.id, "pending", "")));
  } else if (state.activeView === "denied") {
    actions.append(renderReviewActionButton("Back to Review", "text-button mini-button", () => updateSignup(signup.id, "pending", "")));
  }

  actions.append(renderReviewActionButton("Delete", "danger-button mini-button", () => deleteSignup(signup.id, signup.name)));

  const detailsIsOpen = signup.id === state.selectedSignupId;
  actions.append(renderReviewActionButton(
    detailsIsOpen ? "Close" : "Details",
    detailsIsOpen ? "text-button mini-button" : "primary-button mini-button",
    () => selectSignup(signup.id)
  ));
  actionsCell.append(actions);

  row.append(volunteerCell, availabilityCell, taskCell, actionsCell);
  return row;
}

function renderReviewQueue() {
  reviewList.replaceChildren();

  if (!state.dashboard) {
    return;
  }

  const signups = getFilteredReviewSignups();
  const visibleSignups = signups.slice(0, state.reviewLimit);
  updateReviewResultCount(visibleSignups.length, signups.length);

  if (signups.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = getReviewWorkspaceConfig().empty;
    reviewList.append(empty);
    loadMoreReviews.hidden = true;
    return;
  }

  const tableShell = document.createElement("div");
  tableShell.className = "review-table-shell";
  const table = document.createElement("table");
  table.className = "review-table";
  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");
  ["Volunteer", "Availability", "Task Fit", "Actions"].forEach((label) => {
    const header = document.createElement("th");
    header.scope = "col";
    header.textContent = label;
    headerRow.append(header);
  });
  thead.append(headerRow);

  const tbody = document.createElement("tbody");
  visibleSignups.forEach((signup) => {
    tbody.append(renderReviewRow(signup));

    if (signup.id === state.selectedSignupId) {
      tbody.append(renderInlineRequestDetailRow(signup));
    }
  });
  table.append(thead, tbody);
  tableShell.append(table);
  reviewList.append(tableShell);

  loadMoreReviews.hidden = visibleSignups.length >= signups.length;
}

function renderReviewWorkspaceChrome() {
  if (!isReviewWorkspaceView()) {
    return;
  }

  const config = getReviewWorkspaceConfig();
  reviewPanelTitle.textContent = config.title;
  reviewPanelCopy.textContent = config.copy;
  reviewAssignmentFilterLabel.hidden = state.activeView !== "placement";
}

function renderPlacementBulkActions() {
  const isPlacement = state.activeView === "placement";
  placementBulkActions.hidden = !isPlacement;

  if (!isPlacement || !state.dashboard) {
    return;
  }

  const metrics = getSummaryMetrics();
  autoAssignRemaining.disabled = metrics.approvedUnassigned === 0;
  autoAssignStatus.classList.toggle("is-error", state.autoAssignMessageType === "error");
  autoAssignStatus.textContent = state.autoAssignMessage
    || (metrics.approvedUnassigned > 0
      ? `${metrics.approvedUnassigned} approved volunteer${metrics.approvedUnassigned === 1 ? "" : "s"} still need time-window decisions.`
      : "All approved volunteer time windows are assigned or skipped.");
}

function renderInlineRequestDetailRow(signup) {
  const row = document.createElement("tr");
  row.className = "inline-detail-row";
  const cell = document.createElement("td");
  cell.colSpan = 4;
  cell.append(buildRequestDetailCard(signup));
  row.append(cell);
  return row;
}

function renderDetailSection(title, node) {
  const section = document.createElement("section");
  section.className = "detail-section";
  const heading = document.createElement("h4");
  heading.textContent = title;
  section.append(heading, node);
  return section;
}

function renderWindowAssignmentControls(signup) {
  const wrapper = document.createElement("div");
  wrapper.className = "window-assignment-list";

  signup.shiftIds.forEach((shiftId) => {
    const row = document.createElement("article");
    row.className = "window-assignment-row";
    const assignment = getAssignmentForSignupShift(signup.id, shiftId);
    const skippedDecision = getSkippedDecisionForSignupShift(signup, shiftId);
    const isSkipped = Boolean(skippedDecision);
    const eligibleRoleIds = getEligibleRoleIdsForShift(shiftId);
    const overlappingAssignment = state.dashboard.schedule.shifts
      .flatMap((shift) => shift.assignments.map((item) => ({ ...item, shiftId: shift.id })))
      .find((item) => item.signupId === signup.id && item.shiftId !== shiftId && shiftsOverlap(item.shiftId, shiftId));
    const hasConflict = Boolean(overlappingAssignment && !assignment && !isSkipped);
    const overlappingSelectedShiftIds = signup.shiftIds.filter((selectedShiftId) => selectedShiftId !== shiftId && shiftsOverlap(selectedShiftId, shiftId));
    const overlappingAssignedShiftIds = overlappingSelectedShiftIds.filter((selectedShiftId) => getAssignmentForSignupShift(signup.id, selectedShiftId));
    const overlappingSkippedShiftIds = overlappingSelectedShiftIds.filter((selectedShiftId) => getSkippedDecisionForSignupShift(signup, selectedShiftId));
    const overlappingUndecidedShiftIds = overlappingSelectedShiftIds.filter((selectedShiftId) => (
      !getAssignmentForSignupShift(signup.id, selectedShiftId)
      && !getSkippedDecisionForSignupShift(signup, selectedShiftId)
    ));
    const activeOverlappingShiftIds = [...overlappingAssignedShiftIds, ...overlappingUndecidedShiftIds];
    const hasOverlapContext = overlappingSelectedShiftIds.length > 0;
    const hasReviewedOverlap = overlappingSkippedShiftIds.length > 0 && activeOverlappingShiftIds.length === 0;
    const hasOverlapChoice = activeOverlappingShiftIds.length > 0 && !assignment && !isSkipped && !hasConflict;

    row.classList.toggle("has-conflict", hasConflict);
    row.classList.toggle("has-overlap", activeOverlappingShiftIds.length > 0 && !hasConflict);
    row.classList.toggle("has-reviewed-overlap", hasReviewedOverlap);

    const heading = document.createElement("div");
    heading.className = "window-assignment-heading";
    const title = document.createElement("strong");
    title.textContent = getShiftLabel(shiftId);
    const status = document.createElement("small");

    if (assignment) {
      status.textContent = `Assigned: ${getRoleLabel(assignment.roleId)}`;
    } else if (isSkipped) {
      status.textContent = skippedDecision.source === "overlap"
        ? `Skipped by assigned ${getShiftLabel(skippedDecision.assignedOverlappingShiftId)}`
        : "Skipped window";
    } else if (signup.status === "denied") {
      status.textContent = "Denied request";
    } else if (hasConflict) {
      status.textContent = `Conflicts with ${getShiftLabel(overlappingAssignment.shiftId)}`;
    } else if (hasOverlapChoice) {
      status.textContent = "Overlapping window selected. Must choose one.";
    } else if (hasReviewedOverlap) {
      status.textContent = "Available; overlap already skipped";
    } else {
      status.textContent = signup.status === "approved" ? "Available, not assigned" : "Approve first";
    }

    heading.append(title, status);

    if (signup.status !== "approved") {
      const note = document.createElement("p");
      note.className = "window-assignment-note";
      note.textContent = signup.status === "denied"
        ? "Denied requests cannot be scheduled. Move this request back to pending or approve it first."
        : "Approve this volunteer before assigning this window.";
      row.append(heading, note);
      wrapper.append(row);
      return;
    }

    if (isSkipped) {
      if (hasOverlapContext) {
        const overlapNote = document.createElement("p");
        overlapNote.className = "window-overlap-note";

        if (skippedDecision.source === "overlap") {
          overlapNote.textContent = `This overlapping window is closed because ${getShiftLabel(skippedDecision.assignedOverlappingShiftId)} is assigned.`;
        } else if (overlappingAssignedShiftIds.length > 0) {
          overlapNote.textContent = `Overlap reviewed: this window was skipped and ${overlappingAssignedShiftIds.map(getShiftLabel).join(", ")} stayed assigned.`;
        } else if (overlappingUndecidedShiftIds.length > 0) {
          overlapNote.textContent = `Overlap reviewed: this window was skipped; ${overlappingUndecidedShiftIds.map(getShiftLabel).join(", ")} still needs a decision.`;
        } else {
          overlapNote.textContent = `Overlap reviewed: this window was skipped.`;
        }

        row.append(heading, overlapNote);
      } else {
        row.append(heading);
      }

      const skippedActions = document.createElement("div");
      skippedActions.className = "window-assignment-actions";
      if (skippedDecision.source === "manual") {
        skippedActions.append(renderUndoSkipButton(signup.id, shiftId));
        row.append(skippedActions);
      }
      wrapper.append(row);
      return;
    }

    if (hasConflict) {
      const conflict = document.createElement("p");
      conflict.className = "window-conflict-note";
      conflict.textContent = `This overlaps with assigned ${getShiftLabel(overlappingAssignment.shiftId)}. Skip this window or remove the overlapping assignment first.`;
      const conflictActions = document.createElement("div");
      conflictActions.className = "window-assignment-actions";
      conflictActions.append(renderSkipWindowButton(signup.id, shiftId));
      row.append(heading, conflict, conflictActions);
      wrapper.append(row);
      return;
    }

    if (hasOverlapContext) {
      const overlapNote = document.createElement("p");
      overlapNote.className = "window-overlap-note";
      if (assignment && overlappingUndecidedShiftIds.length > 0) {
        overlapNote.textContent = `Overlap: this assigned window blocks ${overlappingUndecidedShiftIds.map(getShiftLabel).join(", ")}. Skip those windows or move this assignment.`;
      } else if (assignment && overlappingSkippedShiftIds.length > 0) {
        overlapNote.textContent = `Overlap reviewed: ${overlappingSkippedShiftIds.map(getShiftLabel).join(", ")} skipped.`;
      } else if (overlappingAssignedShiftIds.length > 0) {
        overlapNote.textContent = `Must choose one: overlaps with assigned ${overlappingAssignedShiftIds.map(getShiftLabel).join(", ")}.`;
      } else if (overlappingSkippedShiftIds.length > 0 && overlappingUndecidedShiftIds.length === 0) {
        overlapNote.textContent = `Overlap reviewed: ${overlappingSkippedShiftIds.map(getShiftLabel).join(", ")} skipped. This window can be assigned or skipped.`;
      } else {
        overlapNote.textContent = `Must choose one: overlaps with ${activeOverlappingShiftIds.map(getShiftLabel).join(", ")}.`;
      }
      row.append(heading, overlapNote);
    } else {
      row.append(heading);
    }

    const controls = document.createElement("div");
    controls.className = "window-assignment-controls";
    const picker = document.createElement("label");
    picker.className = "window-task-picker";
    const pickerLabel = document.createElement("span");
    pickerLabel.textContent = "Task for this window";
    const select = document.createElement("select");
    select.setAttribute("aria-label", `Task for ${signup.name} on ${getShiftLabel(shiftId)}`);

    eligibleRoleIds.forEach((roleId) => {
      const option = document.createElement("option");
      option.value = roleId;
      option.textContent = `${getRoleLabel(roleId)} (${getShiftRoleLoadRatio(shiftId, roleId)})`;
      select.append(option);
    });

    select.value = assignment ? assignment.roleId : eligibleRoleIds[0] || "";
    select.disabled = eligibleRoleIds.length === 0;
    const loadSummary = document.createElement("small");
    loadSummary.className = "window-load-summary";
    const updateLoadSummary = () => {
      loadSummary.textContent = select.value
        ? `${getShiftRoleLoadSummary(shiftId, select.value)} in this time window`
        : "No task selected";
    };
    select.addEventListener("change", updateLoadSummary);
    updateLoadSummary();
    picker.append(pickerLabel, select, loadSummary);
    controls.append(picker);

    const actionRow = document.createElement("div");
    actionRow.className = "window-assignment-actions";

    const assignButton = document.createElement("button");
    assignButton.type = "button";
    assignButton.className = "primary-button mini-button";
    assignButton.textContent = assignment ? "Update" : "Assign";
    assignButton.disabled = !select.value;
    assignButton.addEventListener("click", () => updateScheduleAssignment(signup.id, shiftId, "setRole", select.value));
    actionRow.append(assignButton);

    if (assignment) {
      const removeButton = document.createElement("button");
      removeButton.type = "button";
      removeButton.className = "text-button mini-button";
      removeButton.textContent = "Skip Window";
      removeButton.addEventListener("click", () => updateScheduleAssignment(signup.id, shiftId, "remove", assignment.roleId));
      actionRow.append(removeButton);
    } else if (isSkipped) {
      actionRow.append(renderUndoSkipButton(signup.id, shiftId));
    } else {
      actionRow.append(renderSkipWindowButton(signup.id, shiftId));
    }

    controls.append(actionRow);
    row.append(controls);
    wrapper.append(row);
  });

  return wrapper;
}

function buildRequestDetailCard(signup) {
  const card = document.createElement("details");
  card.className = "request-detail-card";
  card.open = true;

  const summary = document.createElement("summary");
  summary.className = "request-detail-summary";
  const summaryText = document.createElement("div");
  summaryText.className = "request-detail-summary-text";
  const heading = document.createElement("div");
  heading.className = "detail-heading";
  const title = document.createElement("h3");
  title.textContent = signup.name;
  heading.append(title, createStatusPill(signup.status));

  const summaryMeta = document.createElement("p");
  summaryMeta.className = "detail-meta";
  summaryMeta.textContent = `Submitted ${formatDate(signup.submittedAt)} | ${signup.shiftIds.length} window${signup.shiftIds.length === 1 ? "" : "s"} selected${state.activeView === "placement" ? ` | ${getWindowDecisionSummary(signup)}` : ""}`;
  summaryText.append(heading, summaryMeta);

  const summaryAction = document.createElement("span");
  summaryAction.className = "request-detail-toggle-label";
  summaryAction.setAttribute("aria-hidden", "true");
  summary.append(summaryText, summaryAction);

  const contact = document.createElement("div");
  contact.className = "request-contact-row";
  contact.append(createChip(signup.phone), createChip(signup.email));

  const selectedTimeLabels = isMultiShiftSignup(signup)
    ? [state.activeView === "placement" ? `${signup.shiftIds.length} windows selected. ${getWindowDecisionSummary(signup)}.` : `${signup.shiftIds.length} windows selected.`]
    : signup.shiftLabels;
  const selectedTimes = renderChipGroup("Selected Times", selectedTimeLabels, "time-chip");
  const preferredTasks = renderChipGroup("Preferred Tasks", signup.willingAllTasks ? ["Any task"] : signup.rolePreferenceLabels, "task-chip");

  const multiShiftNotice = document.createElement("p");
  multiShiftNotice.className = "multi-shift-notice";
  multiShiftNotice.textContent = "Multi-shift volunteer: each selected window must be assigned or skipped before this request leaves Unassigned.";

  const experience = document.createElement("div");
  experience.className = "experience-detail";
  const exactInput = document.createElement("p");
  exactInput.textContent = signup.dogExperience || "No experience input provided.";
  experience.append(renderExperienceFlag(signup), exactInput);

  const actions = document.createElement("div");
  actions.className = "detail-action-row";

  if (state.activeView === "review") {
    actions.append(renderReviewActionButton("Approve", "primary-button compact-button", () => updateSignup(signup.id, "approve", "")));
    actions.append(renderReviewActionButton("Deny", "danger-button", () => updateSignup(signup.id, "deny", "")));
  } else if (state.activeView === "placement") {
    actions.append(renderReviewActionButton("Deny", "danger-button", () => updateSignup(signup.id, "deny", "")));
    actions.append(renderReviewActionButton("Back to Review Queue", "text-button", () => updateSignup(signup.id, "pending", "")));
  } else if (state.activeView === "denied") {
    actions.append(renderReviewActionButton("Back to Review Queue", "text-button", () => updateSignup(signup.id, "pending", "")));
  }

  actions.append(renderReviewActionButton("Delete permanently", "danger-button", () => deleteSignup(signup.id, signup.name)));

  const body = document.createElement("div");
  body.className = "request-detail-body";

  const overview = document.createElement("div");
  overview.className = "request-overview-grid";
  overview.append(
    renderDetailSection("Contact", contact),
    selectedTimes,
    preferredTasks,
    renderDetailSection("Experience Input", experience),
    renderDetailSection("Decision", actions)
  );

  body.append(overview);

  if (state.activeView === "placement") {
    body.append(
      ...(isMultiShiftSignup(signup) ? [multiShiftNotice] : []),
      renderDetailSection("Assign Time Windows", renderWindowAssignmentControls(signup))
    );
  }

  card.append(summary, body);
  return card;
}

function renderRequestDetail() {
  requestDetail.replaceChildren();
  requestDetail.hidden = true;
}

function getSummaryMetrics() {
  const pending = state.dashboard.summary.pending || 0;
  const approved = state.dashboard.summary.approved || 0;
  const denied = state.dashboard.summary.denied || 0;
  const approvedUnassigned = state.dashboard.signups.filter((signup) => signup.status === "approved" && signupHasOpenWindowDecision(signup)).length;
  let staffingGaps = 0;

  state.dashboard.shifts.forEach((shift) => {
    getEligibleRoleIdsForShift(shift.id).forEach((roleId) => {
      const target = getShiftRoleTarget(shift.id, roleId);
      const assigned = getAssignedCount(shift.id, roleId);

      if (assigned < target) {
        staffingGaps += 1;
      }
    });
  });

  return { pending, approved, denied, approvedUnassigned, staffingGaps };
}

function renderSummary() {
  const metrics = getSummaryMetrics();
  summaryBar.replaceChildren();

  [
    ["Pending", metrics.pending],
    ["Approved", metrics.approved],
    ["Approved Unassigned", metrics.approvedUnassigned],
    ["Staffing Gaps", metrics.staffingGaps, "Tasks below target"],
    ["Denied", metrics.denied]
  ].forEach(([label, value, helpText]) => {
    const item = document.createElement("div");
    item.className = "summary-item";
    const number = document.createElement("strong");
    number.textContent = value;
    const text = document.createElement("span");
    text.textContent = label;
    item.append(number, text);

    if (helpText) {
      const help = document.createElement("small");
      help.textContent = helpText;
      item.append(help);
    }

    summaryBar.append(item);
  });
}

function setActiveView(viewName) {
  state.activeView = viewName;
  tabButtons.forEach((button) => button.classList.toggle("is-active", button.dataset.view === viewName));

  views.review.classList.toggle("is-active", isReviewWorkspaceView(viewName));
  views.needs.classList.toggle("is-active", viewName === "needs");
  views.schedule.classList.toggle("is-active", viewName === "schedule");

  if (state.dashboard && isReviewWorkspaceView(viewName)) {
    state.reviewLimit = 25;
    renderReviewWorkspaceChrome();
    populateReviewFilters();
    ensureSelectedSignup();
    renderPlacementBulkActions();
    renderReviewGapPanel();
    renderReviewQueue();
    renderRequestDetail();
  }
}

function getNeedStatus(assigned, target) {
  if (target && assigned >= target) {
    return assigned > target ? "Overflow" : "Filled";
  }

  return `${Math.max(target - assigned, 0)} needed`;
}

function needsMatch(first, second) {
  return Boolean(first && second && first.shiftId === second.shiftId && first.roleId === second.roleId);
}

function getFirstNeed() {
  let fallback = null;

  for (const shift of state.dashboard.shifts) {
    for (const roleId of getEligibleRoleIdsForShift(shift.id)) {
      const need = { shiftId: shift.id, roleId };
      const assigned = getAssignedCount(shift.id, roleId);
      const target = getShiftRoleTarget(shift.id, roleId);
      fallback = fallback || need;

      if (assigned < target) {
        return need;
      }
    }
  }

  return fallback;
}

function ensureSelectedNeed() {
  const selected = state.selectedNeed;
  const selectedStillExists = selected && getEligibleRoleIdsForShift(selected.shiftId).includes(selected.roleId);

  if (!selectedStillExists) {
    state.selectedNeed = getFirstNeed();
  }
}

function selectNeed(shiftId, roleId) {
  state.selectedNeed = { shiftId, roleId };
  renderNeedsBoard();
  renderCandidatePanel();
}

function renderNeedsBoard() {
  needBoard.replaceChildren();

  state.dashboard.shifts.forEach((shift) => {
    const card = document.createElement("article");
    card.className = "need-card";
    const heading = document.createElement("div");
    heading.className = "need-card-heading";
    const title = document.createElement("h3");
    title.textContent = getShiftDisplayLabel(shift);
    const focus = document.createElement("p");
    focus.textContent = shift.focus;
    heading.append(title, focus);

    const rows = document.createElement("div");
    rows.className = "need-row-list";

    getEligibleRoleIdsForShift(shift.id).forEach((roleId) => {
      const assigned = getAssignedCount(shift.id, roleId);
      const target = getShiftRoleTarget(shift.id, roleId);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "need-row";
      button.classList.toggle("is-selected", needsMatch(state.selectedNeed, { shiftId: shift.id, roleId }));
      button.classList.toggle("is-filled", target > 0 && assigned >= target);
      const label = document.createElement("span");
      label.textContent = getRoleLabel(roleId);
      const count = document.createElement("strong");
      count.textContent = `${assigned}/${target}`;
      const status = document.createElement("small");
      status.textContent = getNeedStatus(assigned, target);
      button.append(label, count, status);
      button.addEventListener("click", () => selectNeed(shift.id, roleId));
      rows.append(button);
    });

    card.append(heading, rows);
    needBoard.append(card);
  });
}

function getCandidatesForNeed(shiftId, roleId) {
  return state.dashboard.signups
    .filter((signup) => signup.status === "approved")
    .map((signup) => ({ signup, fit: getCandidateFit(signup, roleId) }))
    .filter(({ signup, fit }) => signup.shiftIds.includes(shiftId) && signup.eligibleRoleIds.includes(roleId) && fit)
    .sort((first, second) => {
      const firstAssignment = getAssignmentForSignupShift(first.signup.id, shiftId);
      const secondAssignment = getAssignmentForSignupShift(second.signup.id, shiftId);
      const firstAssignedHere = firstAssignment && firstAssignment.roleId === roleId ? 0 : 1;
      const secondAssignedHere = secondAssignment && secondAssignment.roleId === roleId ? 0 : 1;
      return firstAssignedHere - secondAssignedHere || first.fit.rank - second.fit.rank || first.signup.name.localeCompare(second.signup.name);
    });
}

function getPendingCandidateCount(shiftId, roleId) {
  return state.dashboard.signups.filter((signup) => (
    signup.status === "pending"
    && signup.shiftIds.includes(shiftId)
    && signup.eligibleRoleIds.includes(roleId)
    && getCandidateFit(signup, roleId)
  )).length;
}

function getUnassignedCandidateCount(shiftId, roleId) {
  return state.dashboard.signups.filter((signup) => (
    signup.status !== "denied"
    && signup.shiftIds.includes(shiftId)
    && !getAssignmentForSignupShift(signup.id, shiftId)
    && !getSkippedDecisionForSignupShift(signup, shiftId)
    && signup.eligibleRoleIds.includes(roleId)
    && getCandidateFit(signup, roleId)
  )).length;
}

function renderCandidateCard(shiftId, roleId, signup, fit) {
  const card = document.createElement("article");
  card.className = "candidate-card";
  const assignment = getAssignmentForSignupShift(signup.id, shiftId);
  const skippedDecision = getSkippedDecisionForSignupShift(signup, shiftId);
  const blockedByOverlap = skippedDecision?.source === "overlap";

  const header = document.createElement("div");
  header.className = "candidate-heading";
  const title = document.createElement("h4");
  title.textContent = signup.name;
  const fitPill = document.createElement("span");
  fitPill.className = "candidate-fit";
  fitPill.textContent = isMultiShiftSignup(signup) ? `${fit.label} | multi-shift` : fit.label;
  header.append(title, fitPill);

  const contact = document.createElement("p");
  contact.className = "candidate-contact";
  contact.textContent = `${signup.phone} | ${signup.email}`;

  const status = document.createElement("p");
  status.className = "candidate-status";

  if (assignment && assignment.roleId === roleId) {
    status.textContent = "Already assigned here.";
  } else if (assignment) {
    status.textContent = `Currently in this window as ${getRoleLabel(assignment.roleId)}.`;
  } else if (blockedByOverlap) {
    status.textContent = `Closed because ${getShiftLabel(skippedDecision.assignedOverlappingShiftId)} is assigned.`;
  } else if (skippedDecision) {
    status.textContent = "Removed from this window.";
  } else {
    status.textContent = "Available for this need.";
  }

  const experience = document.createElement("p");
  experience.className = "candidate-experience";
  experience.append(renderExperienceFlag(signup), document.createTextNode(` ${truncateText(signup.dogExperience, 110)}`));

  const action = document.createElement("button");
  action.type = "button";
  action.className = assignment && assignment.roleId === roleId || blockedByOverlap ? "text-button compact-text-button" : "primary-button compact-button";
  action.textContent = assignment && assignment.roleId === roleId ? "Assigned" : assignment ? "Move Here" : blockedByOverlap ? "Blocked" : skippedDecision ? "Restore Here" : "Assign Here";
  action.disabled = Boolean((assignment && assignment.roleId === roleId) || blockedByOverlap);
  action.addEventListener("click", () => updateScheduleAssignment(signup.id, shiftId, "setRole", roleId));

  card.append(header, contact, status, experience, action);
  return card;
}

function renderCandidatePanel() {
  candidatePanel.replaceChildren();

  if (!state.selectedNeed) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "Select a staffing need to see matching approved volunteers.";
    candidatePanel.append(empty);
    return;
  }

  const { shiftId, roleId } = state.selectedNeed;
  const assigned = getAssignedCount(shiftId, roleId);
  const target = getShiftRoleTarget(shiftId, roleId);
  const candidates = getCandidatesForNeed(shiftId, roleId);
  const pendingMatches = getPendingCandidateCount(shiftId, roleId);

  const heading = document.createElement("div");
  heading.className = "candidate-panel-heading";
  const title = document.createElement("h3");
  title.textContent = getRoleLabel(roleId);
  const meta = document.createElement("p");
  meta.textContent = `${getShiftLabel(shiftId)} | ${assigned}/${target} assigned`;
  heading.append(title, meta);

  const list = document.createElement("div");
  list.className = "candidate-list";

  if (candidates.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No approved candidates match this need yet.";
    list.append(empty);
  } else {
    candidates.slice(0, 40).forEach(({ signup, fit }) => list.append(renderCandidateCard(shiftId, roleId, signup, fit)));
  }

  const pendingNote = document.createElement("p");
  pendingNote.className = "candidate-note";
  pendingNote.textContent = pendingMatches > 0
    ? `${pendingMatches} pending request${pendingMatches === 1 ? "" : "s"} also match this need. Approve them from the Review Queue first.`
    : "No pending requests match this exact need.";

  candidatePanel.append(heading, pendingNote, list);
}

function renderScheduleRoleSelect(shift, assignment) {
  const select = document.createElement("select");
  select.className = "schedule-role-select";
  select.setAttribute("aria-label", `Scheduled task for ${assignment.name} on ${getShiftDisplayLabel(shift)}`);

  assignment.eligibleRoleIds.forEach((roleId) => {
    const option = document.createElement("option");
    option.value = roleId;
    option.textContent = `${getRoleLabel(roleId)} - ${getShiftRoleLoadSummary(shift.id, roleId)}`;
    select.append(option);
  });

  select.value = assignment.roleId;
  select.addEventListener("change", () => updateScheduleAssignment(assignment.signupId, shift.id, "setRole", select.value));
  return select;
}

function renderScheduleAssignment(shift, assignment) {
  const item = document.createElement("li");
  item.className = assignment.source === "manual edit" ? "is-manual" : "";

  const name = document.createElement("b");
  name.textContent = assignment.name;
  const role = document.createElement("span");
  role.textContent = assignment.roleLabel;
  const contact = document.createElement("small");
  contact.textContent = `${assignment.phone} | ${assignment.email}`;
  const source = document.createElement("small");
  source.className = "schedule-source";
  source.textContent = assignment.source === "manual edit" ? "Manual schedule edit" : `Source: ${assignment.source}`;

  const controls = document.createElement("div");
  controls.className = "schedule-edit-controls";
  const select = renderScheduleRoleSelect(shift, assignment);
  const removeButton = document.createElement("button");
  removeButton.type = "button";
  removeButton.className = "text-button compact-text-button";
  removeButton.textContent = "Remove From Window";
  removeButton.addEventListener("click", () => updateScheduleAssignment(assignment.signupId, shift.id, "remove", assignment.roleId));
  controls.append(select, removeButton);

  item.append(name, role, contact, source, controls);
  return item;
}

function renderRemovedScheduleAssignment(shift, assignment) {
  const item = document.createElement("li");
  item.className = "is-removed";
  const name = document.createElement("b");
  name.textContent = assignment.name;
  const contact = document.createElement("small");
  contact.textContent = `${assignment.phone} | ${assignment.email}`;
  const restoreButton = document.createElement("button");
  restoreButton.type = "button";
  restoreButton.className = "text-button compact-text-button";
  restoreButton.textContent = "Restore to Auto Schedule";
  restoreButton.addEventListener("click", () => updateScheduleAssignment(assignment.signupId, shift.id, "restore", ""));
  item.append(name, contact, restoreButton);
  return item;
}

function renderSchedule(schedule) {
  scheduleBoard.replaceChildren();
  unscheduledList.replaceChildren();

  schedule.shifts.forEach((shift) => {
    const card = document.createElement("article");
    card.className = "schedule-shift-card";

    const heading = document.createElement("h3");
    heading.textContent = getShiftDisplayLabel(shift);

    const focus = document.createElement("p");
    focus.textContent = shift.focus;

    const count = document.createElement("strong");
    count.textContent = `${shift.assignments.length} scheduled / target ${shift.target}`;

    const list = document.createElement("ul");
    list.className = "schedule-assignment-list";

    if (shift.assignments.length === 0) {
      const item = document.createElement("li");
      item.textContent = "No approved volunteers scheduled yet.";
      list.append(item);
    } else {
      shift.assignments.forEach((assignment) => {
        list.append(renderScheduleAssignment(shift, assignment));
      });
    }

    card.append(heading, focus, count, list);

    if (shift.removed && shift.removed.length > 0) {
      const removedHeading = document.createElement("h4");
      removedHeading.className = "removed-heading";
      removedHeading.textContent = "Removed from this window";
      const removedList = document.createElement("ul");
      removedList.className = "schedule-assignment-list removed-assignment-list";
      shift.removed.forEach((assignment) => removedList.append(renderRemovedScheduleAssignment(shift, assignment)));
      card.append(removedHeading, removedList);
    }

    scheduleBoard.append(card);
  });

  if (schedule.unscheduled.length > 0) {
    const title = document.createElement("h3");
    title.textContent = "Approved but not scheduled";
    const list = document.createElement("ul");

    schedule.unscheduled.forEach((item) => {
      const row = document.createElement("li");
      row.textContent = `${item.name}: ${item.reason}`;
      list.append(row);
    });

    unscheduledList.append(title, list);
  }
}

function populateScheduleDayFilter() {
  const days = getScheduleDays();
  const currentDayIsAvailable = days.includes(state.selectedScheduleDay);
  state.selectedScheduleDay = currentDayIsAvailable ? state.selectedScheduleDay : days[0] || "";

  scheduleDayFilter.replaceChildren();

  days.forEach((day) => {
    const option = document.createElement("option");
    option.value = day;
    option.textContent = getScheduleDayLabel(day);
    scheduleDayFilter.append(option);
  });

  scheduleDayFilter.value = state.selectedScheduleDay;
  printScheduleDay.disabled = days.length === 0;
}

function renderPrintScheduleSheet() {
  printScheduleSheet.replaceChildren();

  if (!state.dashboard || !state.selectedScheduleDay) {
    return;
  }

  const header = document.createElement("header");
  header.className = "print-schedule-header";
  const eyebrow = document.createElement("p");
  eyebrow.textContent = "Big Dog Ranch Rescue";
  const title = document.createElement("h1");
  title.textContent = `${getScheduleDayLabel(state.selectedScheduleDay)} Beagle Intake Schedule`;
  const generated = document.createElement("p");
  generated.textContent = `Generated ${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date())}`;
  header.append(eyebrow, title, generated);

  const shiftsContainer = document.createElement("div");
  shiftsContainer.className = "print-shift-list";
  const selectedShifts = getSelectedDayShifts();

  selectedShifts.forEach((shift) => {
    const section = document.createElement("section");
    section.className = "print-shift-section";
    const heading = document.createElement("div");
    heading.className = "print-shift-heading";
    const shiftTitle = document.createElement("h2");
    shiftTitle.textContent = `${shift.date ? `${shift.date} ` : ""}${shift.time}`;
    const count = document.createElement("p");
    count.textContent = `${shift.assignments.length} scheduled / target ${shift.target}`;
    heading.append(shiftTitle, count);

    const table = document.createElement("table");
    table.className = "print-schedule-table";
    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");
    ["Volunteer", "Task", "Phone", "Email"].forEach((label) => {
      const cell = document.createElement("th");
      cell.scope = "col";
      cell.textContent = label;
      headerRow.append(cell);
    });
    thead.append(headerRow);

    const tbody = document.createElement("tbody");

    if (shift.assignments.length === 0) {
      const row = document.createElement("tr");
      const cell = document.createElement("td");
      cell.colSpan = 4;
      cell.textContent = "No volunteers scheduled for this window.";
      row.append(cell);
      tbody.append(row);
    } else {
      shift.assignments
        .slice()
        .sort((first, second) => first.roleLabel.localeCompare(second.roleLabel) || first.name.localeCompare(second.name))
        .forEach((assignment) => {
          const row = document.createElement("tr");
          [assignment.name, assignment.roleLabel, assignment.phone, assignment.email].forEach((value) => {
            const cell = document.createElement("td");
            cell.textContent = value;
            row.append(cell);
          });
          tbody.append(row);
        });
    }

    table.append(thead, tbody);
    section.append(heading, table);
    shiftsContainer.append(section);
  });

  const footer = document.createElement("footer");
  footer.className = "print-schedule-footer";
  footer.textContent = "Coordinator schedule for internal intake operations.";
  printScheduleSheet.append(header, shiftsContainer, footer);
}

function printSelectedDaySchedule() {
  renderPrintScheduleSheet();
  window.print();
}

function ensureSelectedSignup() {
  if (!state.dashboard) {
    return;
  }

  if (isReviewWorkspaceView()) {
    const filteredSignups = getFilteredReviewSignups();
    state.selectedSignupId = filteredSignups.some((signup) => signup.id === state.selectedSignupId) ? state.selectedSignupId : "";
    return;
  }

  if (!state.dashboard.signups.some((signup) => signup.id === state.selectedSignupId)) {
    state.selectedSignupId = state.dashboard.signups[0]?.id || "";
  }
}

function renderDashboard(dashboard) {
  state.dashboard = dashboard;
  renderReviewWorkspaceChrome();
  populateReviewFilters();
  ensureSelectedSignup();
  ensureSelectedNeed();
  renderSummary();
  renderPlacementBulkActions();
  renderReviewGapPanel();
  renderReviewQueue();
  renderRequestDetail();
  renderNeedsBoard();
  renderCandidatePanel();
  renderSchedule(dashboard.schedule);
  populateScheduleDayFilter();
  renderPrintScheduleSheet();
}

async function loadDashboard() {
  showDashboardMessage("Loading dashboard...");

  try {
    const dashboard = await fetchJson(`/api/admin/dashboard${getAdminCodeSuffix()}`, { cache: "no-store" });
    renderDashboard(dashboard);
  } catch (error) {
    showDashboardMessage(error.message || "Dashboard could not be loaded.", "error");
  }
}

async function updateSignup(signupId, action, assignedRoleId) {
  try {
    const dashboard = await fetchJson("/api/admin/signup-action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        adminCode: state.adminCode,
        signupId,
        action,
        assignedRoleId
      })
    });
    state.selectedSignupId = signupId;
    renderDashboard(dashboard);
  } catch (error) {
    showStatusMessage(error.message || "Request could not be updated.", "error");
  }
}

async function deleteSignup(signupId, signupName) {
  const label = signupName ? `"${signupName}"` : "this signup";
  const confirmed = window.confirm(`Permanently delete ${label}? This removes the record from the database and cannot be undone. The volunteer can resubmit if needed.`);
  if (!confirmed) {
    return;
  }

  try {
    const dashboard = await fetchJson("/api/admin/signup-delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        adminCode: state.adminCode,
        signupId
      })
    });
    if (state.selectedSignupId === signupId) {
      state.selectedSignupId = "";
    }
    renderDashboard(dashboard);
    showStatusMessage(`Deleted ${label}.`, "success");
  } catch (error) {
    showStatusMessage(error.message || "Signup could not be deleted.", "error");
  }
}

async function updateScheduleAssignment(signupId, shiftId, action, roleId) {
  try {
    const dashboard = await fetchJson("/api/admin/schedule-action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        adminCode: state.adminCode,
        signupId,
        shiftId,
        action,
        roleId
      })
    });
    state.selectedNeed = { shiftId, roleId };
    renderDashboard(dashboard);
  } catch (error) {
    showStatusMessage(error.message || "Schedule edit could not be saved.", "error");
  }
}

async function autoAssignRemainingApprovedVolunteers() {
  autoAssignRemaining.disabled = true;
  autoAssignStatus.classList.remove("is-error");
  autoAssignStatus.textContent = "Assigning remaining approved volunteers to matching open tasks...";

  try {
    const dashboard = await fetchJson("/api/admin/auto-assign-remaining", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ adminCode: state.adminCode })
    });
    const result = dashboard.autoAssignResult || { assignedWindows: 0, updatedVolunteers: 0 };
    state.autoAssignMessageType = "";
    state.autoAssignMessage = result.assignedWindows > 0
      ? `Auto assigned ${result.assignedWindows} time window${result.assignedWindows === 1 ? "" : "s"} for ${result.updatedVolunteers} volunteer${result.updatedVolunteers === 1 ? "" : "s"}.`
      : "No matching open preferred-task slots were available for the remaining approved volunteers.";
    state.reviewAssignmentFilter = "unassigned";
    populateReviewFilters();
    renderDashboard(dashboard);
  } catch (error) {
    state.autoAssignMessageType = "error";
    state.autoAssignMessage = error.message || "Auto assignment could not be completed.";
    renderPlacementBulkActions();
  }
}

tabButtons.forEach((button) => {
  button.addEventListener("click", () => setActiveView(button.dataset.view));
});

reviewAssignmentFilter.addEventListener("change", () => {
  state.reviewAssignmentFilter = reviewAssignmentFilter.value;
  state.reviewLimit = 25;
  ensureSelectedSignup();
  renderReviewQueue();
  renderRequestDetail();
});

reviewTimeFilter.addEventListener("change", () => {
  state.reviewTimeFilter = reviewTimeFilter.value;
  state.reviewLimit = 25;
  ensureSelectedSignup();
  renderReviewQueue();
  renderRequestDetail();
});

reviewTaskFilter.addEventListener("change", () => {
  state.reviewTaskFilter = reviewTaskFilter.value;
  renderReviewGapPanel();
  state.reviewLimit = 25;
  ensureSelectedSignup();
  renderReviewQueue();
  renderRequestDetail();
});

reviewSearch.addEventListener("input", () => {
  state.reviewSearch = reviewSearch.value.trim();
  state.reviewLimit = 25;
  renderReviewGapPanel();
  ensureSelectedSignup();
  renderReviewQueue();
  renderRequestDetail();
});

clearReviewFilters.addEventListener("click", () => {
  state.reviewAssignmentFilter = "unassigned";
  state.reviewTimeFilter = "";
  state.reviewTaskFilter = "";
  state.reviewSearch = "";
  state.reviewLimit = 25;
  populateReviewFilters();
  renderReviewGapPanel();
  ensureSelectedSignup();
  renderReviewQueue();
  renderRequestDetail();
});

loadMoreReviews.addEventListener("click", () => {
  state.reviewLimit += 25;
  renderReviewQueue();
});

autoAssignRemaining.addEventListener("click", autoAssignRemainingApprovedVolunteers);

refreshSchedule.addEventListener("click", loadDashboard);

scheduleDayFilter.addEventListener("change", () => {
  state.selectedScheduleDay = scheduleDayFilter.value;
  renderPrintScheduleSheet();
});

printScheduleDay.addEventListener("click", printSelectedDaySchedule);

loadDashboard();