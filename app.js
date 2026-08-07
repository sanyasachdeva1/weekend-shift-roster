const TEAM = window.PUBLIC_TEAM || [];
const RETIRED_EMPLOYEE_CODES = new Set(["EMP014"]);
const PEOPLE = TEAM.map(([code]) => code).filter((code) => !RETIRED_EMPLOYEE_CODES.has(code));
const TEAM_ROLE = Object.fromEntries(TEAM.map(([code, , role = "basic"]) => [code, role]));
const DISPLAY_NAME_OVERRIDES = { SIG001: "Aneesh Krishnan U" };
const EXTERNAL_SIGNATURE_PREFIXES = ["KRK team"];
const SIGNATURE_PEOPLE = PEOPLE.filter((code) => TEAM_ROLE[code] === "signature");
const sameRosterGroup = (a, b) => TEAM_ROLE[a] === TEAM_ROLE[b];
// No hard-coded PTO: anyone who does not submit NA dates is available by default.
const INACTIVE = new Set();
const query = new URLSearchParams(location.search);
const ADMIN_ACCOUNTS = [
  { name: "Sanya Sachdeva", salt: "31b74546aab47d75", hash: "5e0ccc05" },
  { name: "Naveen Kumar M", salt: "ae2d3b7015a295d3", hash: "6fbf8792" },
  { name: "Simran Vyas", salt: "46a76ff7d30d761b", hash: "60d9627d" },
  { name: "ISHANT VARSHNEY", salt: "5e0e946905cafff1", hash: "e71a6024" },
  { name: "Saravanan Natarajan", salt: "09289d69546f6c5d", hash: "c64fed11" }
];
const STORAGE_KEY = query.get("storage") ? `weekend-roster-data-v4-${query.get("storage")}` : query.get("preview") ? `weekend-roster-data-v4-${query.get("preview")}` : "weekend-roster-data-v4";
const ADMIN_SESSION_KEY = "weekend-roster-admin-session";
const HISTORICAL_ROSTERS = globalThis.HISTORICAL_ROSTERS || {};
const SUBMISSION_OPEN_MINUTE = ((15 - 1) * 24 * 60) + (11 * 60);
const SUBMISSION_CUTOFF_MINUTE = ((28 - 1) * 24 * 60) + (19 * 60);
const SPECIAL_WEEKEND_EVENT = {
  key: "aug-2026-case-demand",
  title: "8 / 9 Aug Volunteers",
  cutoff: new Date("2026-08-07T19:00:00+05:30"),
  dates: [
    { key: "2026-08-08", label: "Sat, 8 Aug" },
    { key: "2026-08-09", label: "Sun, 9 Aug" }
  ]
};
const $ = (id) => document.getElementById(id);
const realNow = query.get("mockDate") ? new Date(`${query.get("mockDate")}T12:00:00+05:30`) : new Date();
const appNow = () => query.get("mockDate") ? realNow : new Date();
const demoMode = query.get("demo") === "1";
const previewMode = query.get("preview") || "";
const sharedConfigured = Boolean(window.RosterBackend?.configured);
const sharedRequired = location.hostname.endsWith("github.io") && !demoMode && !previewMode;
const sharedMissing = sharedRequired && !sharedConfigured;
const sharedMode = Boolean(sharedConfigured && !demoMode && !previewMode);
let shownMonth = new Date(realNow.getFullYear(), realNow.getMonth() + 1, 1);
let state = loadState();
let pendingNA = new Set();
let dirty = false;
let currentProfile = null;
let identityRequests = [];
let displayNames = Object.fromEntries(TEAM);
let cutoffGenerationInProgress = false;
let activeAdmin = sessionStorage.getItem(ADMIN_SESSION_KEY) || "";
let activeAdminAccessCode = "";
let activeEmployee = "";
let activeEmployeeAccessCode = "";
let pendingEmployeeUnlock = "";
let swapRequesterSelected = false;
let swapRequestPage = 1;
const SWAP_REQUESTS_PER_PAGE = 5;

const dateKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const monthKey = (date) => dateKey(date).slice(0, 7);
const parseDate = (key) => new Date(`${key}T12:00:00`);
const initials = (name) => name.split(" ").slice(0, 2).map((part) => part[0]).join("");
const safe = (value) => String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
const displayName = (code) => DISPLAY_NAME_OVERRIDES[code] || displayNames[code] || code;
const isSignatureAssignment = (code) => TEAM_ROLE[code] === "signature" || EXTERNAL_SIGNATURE_PREFIXES.some((prefix) => String(code).startsWith(prefix));
const sortByDisplayName = (codes) => codes.slice().sort((a, b) => displayName(a).localeCompare(displayName(b), "en-IN", { sensitivity: "base" }));
const teamOptions = (codes) => codes.map((value) => ({ value, label: displayName(value) }));
const selectedPerson = () => $("personSelect")?.value || "";
const selectedCurrentPerson = () => $("currentPersonSelect")?.value || "";
const cleanCode = (value) => value.trim().toUpperCase();
const isPersonUnlocked = () => !sharedMode || (selectedPerson() && selectedPerson() === activeEmployee && Boolean(activeEmployeeAccessCode));
function istNowParts(date = new Date()) {
  return Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
  }).formatToParts(date).filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
}
function nextRosterMonthKey() {
  const parts = istNowParts(appNow());
  return monthKey(new Date(parts.year, parts.month, 1));
}
const monthMinute = (parts) => ((parts.day - 1) * 24 * 60) + (parts.hour * 60) + parts.minute;
const isCutoffPassed = () => monthMinute(istNowParts(appNow())) >= SUBMISSION_CUTOFF_MINUTE;
const isShownMonthAfterCutoff = () => monthKey(shownMonth) === nextRosterMonthKey() && isCutoffPassed() && previewMode !== "before";
const isSubmissionOpen = () => {
  if (sharedMissing) return false;
  const parts = istNowParts(appNow());
  const minute = monthMinute(parts);
  return demoMode || (minute >= SUBMISSION_OPEN_MINUTE && minute < SUBMISSION_CUTOFF_MINUTE && monthKey(shownMonth) === nextRosterMonthKey());
};

function emptyState() { return { version: 2, availability: {}, submissions: {}, rosters: {}, swapRequests: [], specialVolunteers: {}, audit: [] }; }
function loadState() {
  if (sharedMode || sharedMissing) return emptyState();
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return normalizeState({ ...emptyState(), ...saved, swapRequests: saved?.swapRequests || [], audit: saved?.audit || [] });
  } catch { return emptyState(); }
}
function normalizeState(data) {
  data.rosters ||= {};
  data.specialVolunteers ||= {};
  for (const [month, roster] of Object.entries(HISTORICAL_ROSTERS)) {
    data.rosters[month] ||= roster;
  }
  data.swapRequests = (data.swapRequests || []).map((request) => ({
    type: "swap",
    ...request,
    status: request.status === "pending" ? "awaiting-colleague" : request.status
  }));
  return data;
}
function persist() { if (!sharedMode && !sharedMissing) localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
function audit(action, actor, details, before = null, after = null) {
  if (sharedMode || sharedMissing) return;
  state.audit.push({ id: crypto.randomUUID(), at: new Date().toISOString(), action, actor, details, before, after });
  persist();
}
async function refreshSharedState(render = true) {
  if (!sharedMode) return false;
  const remote = await window.RosterBackend.loadState();
  state = normalizeState({ ...emptyState(), ...remote });
  try {
    const volunteers = await window.RosterBackend.loadSpecialVolunteers(SPECIAL_WEEKEND_EVENT.key);
    state.specialVolunteers[SPECIAL_WEEKEND_EVENT.key] = volunteers || [];
    state.specialVolunteerError = "";
  } catch (error) {
    state.specialVolunteerError = "Special volunteer database setup is pending.";
    console.error("Special volunteer load failed", error);
  }
  if (remote?.team) displayNames = { ...displayNames, ...Object.fromEntries(remote.team.map((member) => [member.employee_code, member.full_name])) };
  if (render) { loadPersonDraft(); renderAll(); }
  return true;
}
function adminActor() {
  if (!activeAdmin) {
    alert("Unlock admin controls with your admin name and code first.");
    return null;
  }
  if (sharedMode && !activeAdminAccessCode) {
    alert("Re-enter your admin code to run protected admin actions.");
    lockAdmin();
    return null;
  }
  return activeAdmin;
}
function adminAccount(name) { return ADMIN_ACCOUNTS.find((admin) => admin.name === name); }
function adminCodeHash(code, salt) {
  let hash = 2166136261;
  for (const char of `${salt}|${code}`) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}
function unlockAdmin() {
  const name = $("adminName").value;
  const code = cleanCode($("adminCode").value);
  const account = adminAccount(name);
  const hash = account && code ? adminCodeHash(code, account.salt) : "";
  if (!account || hash !== account.hash) {
    $("adminAccessMessage").textContent = "Admin name or code is incorrect.";
    $("adminAccessMessage").className = "inline-message error";
    audit("ADMIN_UNLOCK_FAILED", name || "Unknown", "Invalid admin code attempt");
    renderAdmin();
    return;
  }
  activeAdmin = account.name;
  activeAdminAccessCode = cleanCode(code);
  sessionStorage.setItem(ADMIN_SESSION_KEY, activeAdmin);
  $("adminCode").value = "";
  $("adminAccessMessage").textContent = "";
  audit("ADMIN_UNLOCKED", activeAdmin, "Admin controls unlocked");
  renderAdmin();
}
function lockAdmin() {
  if (activeAdmin) audit("ADMIN_LOCKED", activeAdmin, "Admin controls locked");
  activeAdmin = "";
  activeAdminAccessCode = "";
  sessionStorage.removeItem(ADMIN_SESSION_KEY);
  renderAdmin();
}

function updateClock() {
  const time = new Date();
  $("liveTime").textContent = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(time);
  $("liveDate").textContent = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(time);
}
function renderWindow() {
  if (sharedMissing) {
    $("windowNotice").classList.add("closed");
    $("windowTitle").textContent = "Shared Database Setup Required";
    $("windowMessage").textContent = "Do not collect Not Available dates yet. This production page needs Supabase configured so submissions from all laptops save into one shared roster database.";
    $("windowBadge").textContent = "Setup Required";
    $("saveButton").disabled = true;
    return;
  }
  const open = isSubmissionOpen();
  const afterCutoff = isShownMonthAfterCutoff();
  const roster = shownRoster();
  const generatedMode = Boolean(afterCutoff && roster);
  $("windowNotice").classList.toggle("closed", !open);
  $("windowNotice").classList.toggle("compact", generatedMode);
  $("windowTitle").textContent = open ? "Not Available Date Collection Is Open" : afterCutoff ? (roster ? "Weekend Roster Is Generated" : "Roster Generation Is Pending") : "Not Available Date Collection Is Closed";
  const openText = "15th 11:00 AM IST every month";
  $("windowMessage").textContent = open
    ? `Select and save only the dates you are Not Available to work for ${shownMonth.toLocaleDateString("en-IN", { month: "long", year: "numeric" })}. The window closes at 28th 7:00 PM IST.`
    : afterCutoff && roster
      ? `Changes Locked · ${shownMonth.toLocaleDateString("en-IN", { month: "long", year: "numeric" })} Roster Is Ready.`
    : afterCutoff
      ? `Not Available Date Changes Are Locked. Roster Generation Will Appear Here After The Cutoff Job Saves The Roster.`
    : `The next-month form opens at ${openText} and closes at 28th 7:00 PM IST. After that, calendar changes are locked. ${demoMode ? "Demo override is active." : ""}`;
  $("windowBadge").textContent = demoMode ? "Demo Open" : open ? "Open · Closes 28th 7 PM" : afterCutoff && roster ? "Generated" : afterCutoff ? "Roster Pending" : "Closed";
  $("saveButton").disabled = !open || !dirty || !selectedPerson() || !isPersonUnlocked();
  const controls = document.querySelector("#availabilityPanel .controls");
  if (controls) controls.hidden = false;
  const generatedHeader = $("generatedCalendarHeader");
  if (generatedHeader) generatedHeader.hidden = true;
  const generatedTitle = $("generatedCalendarTitle");
  if (generatedTitle) generatedTitle.textContent = shownMonth.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
  const status = $("personUnlockStatus");
  if (status) {
    const person = selectedPerson();
    status.textContent = afterCutoff
      ? "Not Available Date Changes Are Locked After Cutoff."
      : !person
      ? "Select Your Name To Unlock Editing."
      : isPersonUnlocked()
        ? `Unlocked for ${displayName(person)}`
        : "Locked Until Your Personal Code Is Verified.";
    status.className = `unlock-status ${isPersonUnlocked() ? "ready" : "locked"}`;
  }
}
function updateSaveState() {
  $("saveState").textContent = dirty ? "Unsaved Changes" : "No Unsaved Changes";
  renderWindow();
}

function setOptions(select, values, placeholder) {
  select.innerHTML = `${placeholder ? `<option value="">${safe(placeholder)}</option>` : ""}${values.map((value) => `<option value="${safe(value.value ?? value)}">${safe(value.label ?? value)}</option>`).join("")}`;
}
function loadPersonDraft() {
  const person = selectedPerson();
  if (!person || !isPersonUnlocked()) {
    pendingNA = new Set();
    dirty = false;
    updateSaveState();
    return;
  }
  pendingNA = new Set(Object.keys(state.availability[person]?.[monthKey(shownMonth)] || {}));
  dirty = false;
  updateSaveState();
}
function renderPeople() {
  // Not Available context is integrated into each weekend calendar cell.
}
function openEmployeeCodeDialog(employeeCode) {
  if (!employeeCode || !sharedMode) return;
  pendingEmployeeUnlock = employeeCode;
  $("employeeCodeTitle").textContent = `Unlock ${displayName(employeeCode)}`;
  $("employeeCodeInput").value = "";
  $("employeeCodeMessage").textContent = "";
  $("employeeCodeMessage").className = "inline-message";
  $("employeeCodeDialog").showModal();
  setTimeout(() => $("employeeCodeInput").focus(), 50);
}
function closeEmployeeCodeDialog(resetSelection = true) {
  $("employeeCodeDialog").close();
  $("employeeCodeInput").value = "";
  $("employeeCodeMessage").textContent = "";
  pendingEmployeeUnlock = "";
  if (resetSelection && !isPersonUnlocked()) {
    $("personSelect").value = "";
    loadPersonDraft();
    renderCalendar();
  }
}
async function unlockSelectedEmployee(event) {
  event?.preventDefault();
  const employeeCode = pendingEmployeeUnlock || selectedPerson();
  const accessCode = cleanCode($("employeeCodeInput").value);
  if (!employeeCode) { closeEmployeeCodeDialog(); return; }
  if (!accessCode) {
    $("employeeCodeMessage").textContent = "Enter your personal code.";
    $("employeeCodeMessage").className = "inline-message error";
    return;
  }
  try {
    if (sharedMode) await window.RosterBackend.verifyEmployee(employeeCode, accessCode);
    activeEmployee = employeeCode;
    activeEmployeeAccessCode = accessCode;
    pendingEmployeeUnlock = "";
    $("employeeCodeDialog").close();
    $("employeeCodeInput").value = "";
    loadPersonDraft();
    renderCalendar();
  } catch (error) {
    activeEmployee = "";
    activeEmployeeAccessCode = "";
    closeEmployeeCodeDialog(true);
    alert(error.message || "Invalid personal code.");
  }
}
function naNamesForDate(key) { return PEOPLE.filter((code) => state.availability[code]?.[key.slice(0, 7)]?.[key]).map(displayName); }
function hideNATooltip() {
  document.querySelector(".na-tooltip")?.classList.remove("visible");
}
function bindNATooltips() {
  let tooltip = document.querySelector(".na-tooltip");
  if (!tooltip) {
    tooltip = document.createElement("div");
    tooltip.className = "na-tooltip";
    document.body.appendChild(tooltip);
  }
  const move = (event) => {
    if (!event.currentTarget.dataset.na) { hideNATooltip(); return; }
    tooltip.textContent = event.currentTarget.dataset.na;
    tooltip.classList.add("visible");
    const margin = 12;
    const rect = tooltip.getBoundingClientRect();
    const anchor = event.currentTarget.getBoundingClientRect();
    const pointerX = event.clientX || anchor.left + anchor.width / 2;
    const pointerY = event.clientY || anchor.top;
    const left = Math.min(window.innerWidth - rect.width - margin, Math.max(margin, pointerX - rect.width / 2));
    const above = pointerY - rect.height - 14;
    const top = above > margin ? above : Math.min(window.innerHeight - rect.height - margin, pointerY + 16);
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  };
  document.querySelectorAll("[data-na]").forEach((button) => {
    button.addEventListener("mouseenter", move);
    button.addEventListener("mousemove", move);
    button.addEventListener("mouseleave", hideNATooltip);
    button.addEventListener("blur", hideNATooltip);
    button.addEventListener("focus", move);
  });
}
function shownRoster() {
  if (previewMode === "before") return null;
  return state.rosters[monthKey(shownMonth)] || null;
}
function nextSubmissionMonthDate() {
  const parts = istNowParts(appNow());
  const target = new Date(parts.year, parts.month, 1);
  return isCutoffPassed() && state.rosters[monthKey(target)]
    ? new Date(target.getFullYear(), target.getMonth() + 1, 1)
    : target;
}
function resetShownMonthToSubmissionTarget() {
  if (!demoMode && !previewMode) shownMonth = nextSubmissionMonthDate();
}
function currentMonthKey() {
  const parts = istNowParts(appNow());
  return monthKey(new Date(parts.year, parts.month - 1, 1));
}
function activeRosterMonthKey() {
  const next = nextRosterMonthKey();
  const current = currentMonthKey();
  if (isCutoffPassed() && state.rosters[next]) return next;
  if (state.rosters[current]) return current;
  const available = Object.entries(state.rosters)
    .filter(([, roster]) => roster?.assignments?.length && ["published", "finalized", "needs-review"].includes(roster.status))
    .map(([month]) => month)
    .sort();
  return available.at(-1) || "";
}
function activeRoster() {
  const month = activeRosterMonthKey();
  return month ? state.rosters[month] : null;
}
function formatRosterDate(key) {
  return parseDate(key).toLocaleDateString("en-IN", { weekday: "short", day: "2-digit", month: "short" });
}
function specialVolunteersVisible() {
  return appNow() >= SPECIAL_WEEKEND_EVENT.cutoff;
}
function specialVolunteerCodesForDate(key) {
  if (!specialVolunteersVisible()) return [];
  return specialVolunteerRows()
    .filter((row) => row.volunteer_date === key)
    .map((row) => row.employee_code)
    .filter((code, index, codes) => code && codes.indexOf(code) === index);
}
function renderCurrentRoster() {
  const roster = activeRoster();
  const month = activeRosterMonthKey();
  const selected = selectedCurrentPerson();
  $("currentRosterTitle").textContent = roster ? `${parseDate(`${month}-01`).toLocaleDateString("en-IN", { month: "long", year: "numeric" })} Roster` : "No Current Roster Yet";
  $("currentRosterSubtitle").textContent = roster ? "Select your name to highlight your shifts." : "The current roster will appear here once it is generated.";
  $("currentRosterBadge").textContent = roster ? (roster.status === "finalized" ? "Finalized" : "Generated") : "Pending";
  $("currentRosterBadge").className = `status ${roster ? "ready" : "pending"}`;
  if (!roster) {
    $("currentMyShiftCard").className = "my-shifts-card card empty";
    $("currentMyShiftCard").innerHTML = "No Roster Has Been Generated Yet.";
    $("currentRosterGrid").innerHTML = `<div class="roster-empty-note">Roster Pending.</div>`;
    return;
  }
  const myRows = selected ? roster.assignments.filter((row) => row.assigned.includes(selected) || specialVolunteerCodesForDate(row.date).includes(selected)) : [];
  $("currentMyShiftCard").className = `my-shifts-card card ${selected ? "" : "empty"}`;
  $("currentMyShiftCard").innerHTML = selected
    ? `<div class="my-shifts-header"><strong>${safe(displayName(selected))}</strong><span class="summary-pill">${myRows.length} Shift${myRows.length === 1 ? "" : "s"}</span></div><div class="shift-pill-list">${myRows.length ? myRows.map((row) => `<span class="shift-pill">${safe(formatRosterDate(row.date))}</span>`).join("") : `<span class="shift-pill">No Shifts In This Roster</span>`}</div>`
    : "Select your name above to see your shifts instantly.";
  $("currentRosterGrid").innerHTML = roster.assignments.map((row) => {
    const basic = row.assigned.filter((code) => !isSignatureAssignment(code));
    const signature = row.assigned.filter((code) => isSignatureAssignment(code));
    const specialVolunteers = specialVolunteerCodesForDate(row.date);
    const highlighted = selected && (row.assigned.includes(selected) || specialVolunteers.includes(selected));
    const chips = (codes, sig = false) => codes.map((code) => `<span class="roster-name-chip ${sig ? "signature" : ""} ${code === selected ? "mine" : ""}">${safe(displayName(code))}</span>`).join("");
    const specialHtml = specialVolunteers.length ? `<div class="roster-group special-roster-group"><div class="roster-group-label">Special Volunteers</div><div class="roster-name-list">${chips(specialVolunteers, true)}</div></div>` : "";
    const date = parseDate(row.date);
    const shortDay = date.getDay() === 6 ? "Sat" : "Sun";
    const shortDate = date.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
    return `<article class="roster-day-card ${highlighted ? "highlighted" : ""}"><div class="roster-day-head"><strong>${safe(shortDate)}</strong><span>${shortDay}</span></div><div class="roster-group"><div class="roster-group-label">Basic Engineers</div><div class="roster-name-list">${chips(basic)}</div></div><div class="roster-group"><div class="roster-group-label">Signature</div><div class="roster-name-list">${chips(signature, true)}</div></div>${specialHtml}</article>`;
  }).join("");
}
function renderCalendar() {
  const year = shownMonth.getFullYear(), month = shownMonth.getMonth();
  const roster = shownRoster();
  const afterCutoff = isShownMonthAfterCutoff();
  $("monthTitle").textContent = shownMonth.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
  const offset = (new Date(year, month, 1).getDay() + 6) % 7;
  let html = `<button class="day blank" tabindex="-1"></button>`.repeat(offset);
  for (let day = 1; day <= new Date(year, month + 1, 0).getDate(); day += 1) {
    const date = new Date(year, month, day), weekend = [0, 6].includes(date.getDay()), key = dateKey(date), person = selectedPerson(), na = Boolean(person) && pendingNA.has(key), teamNA = weekend ? naNamesForDate(key) : [];
    const row = weekend ? roster?.assignments?.find((item) => item.date === key) : null;
    const assignedHtml = row ? `<div class="assignment-list">${row.assigned.map((name) => `<span class="assignment-chip">${safe(displayName(name))}</span>`).join("")}</div>` : "";
    const weekendHeader = row
      ? `<div class="day-top roster-day-top"><span class="day-number">${day}</span></div>`
      : afterCutoff
        ? `<div class="day-top"><span class="day-number">${day}</span><span class="day-label">Roster Pending</span></div>`
      : `<div class="day-top"><span class="day-number">${day}</span><span class="day-label">${person ? (na ? "Your NA" : "Available") : "Select name"} <span class="label-separator">•</span> ${teamNA.length} NA</span></div>`;
    const canSelectDate = isSubmissionOpen() && Boolean(person) && isPersonUnlocked();
    const naAttribute = teamNA.length ? ` data-na="${safe(`NA: ${teamNA.join(", ")}`)}"` : "";
    html += `<button class="day ${weekend ? "weekend" : ""} ${na ? "na" : ""} ${weekend && !canSelectDate ? "locked" : ""}" ${weekend ? `data-date="${key}"${naAttribute} data-selectable="${canSelectDate}" aria-pressed="${na}" aria-disabled="${!canSelectDate}"` : "disabled"}>${weekend ? `${weekendHeader}${assignedHtml}` : `<span class="day-number weekday-number">${day}</span>`}</button>`;
  }
  $("calendar").innerHTML = html;
  bindNATooltips();
  document.querySelectorAll("[data-date]").forEach((button) => button.addEventListener("click", () => {
    if (!selectedPerson()) {
      alert("Select your name before marking NA dates.");
      return;
    }
    if (!isPersonUnlocked()) {
      openEmployeeCodeDialog(selectedPerson());
      return;
    }
    if (!isSubmissionOpen() || button.dataset.selectable !== "true") return;
    pendingNA.has(button.dataset.date) ? pendingNA.delete(button.dataset.date) : pendingNA.add(button.dataset.date);
    dirty = true; renderCalendar(); updateSaveState();
  }));
  renderPeople(); renderWindow();
}
async function saveAvailability() {
  if (sharedMissing) { alert("Shared database is not configured yet. Do not collect Not Available dates until Supabase is connected."); return; }
  if (!isSubmissionOpen()) return;
  const person = $("personSelect").value, month = monthKey(shownMonth);
  if (!person) { alert("Select your name before submitting Not Available dates."); return; }
  if (!isPersonUnlocked()) { openEmployeeCodeDialog(person); return; }
  const accessCode = activeEmployeeAccessCode;
  if (sharedMode) {
    try {
      await window.RosterBackend.saveAvailability(person, accessCode, month, [...pendingNA]);
      dirty = false;
      await refreshSharedState();
    } catch (error) { alert(`Shared save failed: ${error.message}`); }
    return;
  }
  const before = state.availability[person]?.[month] || {};
  state.availability[person] ||= {};
  state.availability[person][month] = Object.fromEntries([...pendingNA].map((key) => [key, true]));
  state.submissions[person] ||= {};
  state.submissions[person][month] = { savedAt: new Date().toISOString() };
  audit("AVAILABILITY_SAVED", displayName(person), `${pendingNA.size} NA date(s) saved for ${month}`, before, state.availability[person][month]);
  dirty = false; updateSaveState(); renderPeople(); renderCalendar();
}

function weekendDates(monthDate) {
  const dates = [], year = monthDate.getFullYear(), month = monthDate.getMonth();
  for (let day = 1; day <= new Date(year, month + 1, 0).getDate(); day += 1) {
    const date = new Date(year, month, day); if ([0, 6].includes(date.getDay())) dates.push(date);
  }
  return dates;
}
async function generateRoster(actor = "System scheduler") {
  if (sharedMissing) { alert("Shared database is not configured yet. Roster generation is locked to avoid using incomplete local laptop data."); return; }
  if (sharedMode) await refreshSharedState(false);
  const month = monthKey(shownMonth), eligible = PEOPLE.filter((name) => !INACTIVE.has(name));
  const generated = RosterEngine.generate({ people: eligible, signaturePeople: SIGNATURE_PEOPLE.filter((name) => !INACTIVE.has(name)), monthDate: shownMonth, availability: state.availability, submissions: state.submissions, rosters: state.rosters });
  const assignments = generated.assignments;
  const warnings = generated.warnings.map((warning) => PEOPLE.reduce((text, code) => text.replaceAll(code, displayName(code)), warning));
  const before = state.rosters[month] || null;
  state.rosters[month] = { month, status: warnings.length ? "needs-review" : "published", generatedAt: new Date().toISOString(), generatedBy: actor, assignments, warnings };
  audit(before ? "ROSTER_REGENERATED" : "ROSTER_GENERATED", actor, `${month} roster generated with ${warnings.length} warning(s)`, before, state.rosters[month]);
  if (sharedMode) {
    try {
      await window.RosterBackend.saveRoster(month, state.rosters[month], activeAdminAccessCode);
      await refreshSharedState();
    } catch (error) { alert(`Shared roster save failed: ${error.message}`); }
    return;
  }
  renderCalendar(); renderRoster(); renderSwap(); renderAdmin();
}
async function ensureCutoffRoster() {
  const month = monthKey(shownMonth);
  if (previewMode === "before" || demoMode || cutoffGenerationInProgress || month !== nextRosterMonthKey() || !isCutoffPassed() || state.rosters[month]) return;
  cutoffGenerationInProgress = true;
  try {
    if (sharedMode) {
      await refreshSharedState(false);
      if (state.rosters[month]) { renderAll(); return; }
    }
    await generateRoster("Automatic cutoff scheduler");
  } finally {
    cutoffGenerationInProgress = false;
  }
}
function renderRoster() {
  const roster = shownRoster();
  const generatedMode = Boolean(isShownMonthAfterCutoff() && roster);
  const summary = $("rosterSummary");
  const warnings = $("warnings");
  if (generatedMode) {
    summary.innerHTML = "";
    summary.hidden = true;
    warnings.hidden = true;
    warnings.textContent = "";
    return;
  }
  summary.hidden = false;
  if (!roster) {
    summary.innerHTML = `<span class="summary-pill">Roster Pending Cutoff</span><span class="summary-pill">Saturday Needs 4 + 1 Signature</span><span class="summary-pill">Sunday Needs 3 + 1 Signature</span>`;
    warnings.hidden = true;
    return;
  }
  const ready = ["published", "finalized"].includes(roster.status);
  const assignedCount = roster.assignments.reduce((sum, row) => sum + row.assigned.length, 0);
  const peopleCovered = new Set(roster.assignments.flatMap((row) => row.assigned)).size;
  summary.innerHTML = `<span class="summary-pill ${ready ? "ready" : "warning"}">${safe(roster.status === "finalized" ? "Finalized Roster" : ready ? "Generated Roster" : "Needs Review")}</span><span class="summary-pill">${assignedCount} Shifts Planned</span><span class="summary-pill">${peopleCovered}/${PEOPLE.length} People Scheduled</span>`;
  warnings.hidden = !roster.warnings.length; warnings.textContent = roster.warnings.join(" · ");
}
function rosterIsValid(roster) {
  if (!roster?.assignments?.length) return false;
  const covered = new Set();
  for (const row of roster.assignments) {
    if (new Set(row.assigned).size !== row.assigned.length) return false;
    for (const person of row.assigned) {
      if (!PEOPLE.includes(person) || RosterEngine.hasScheduleConflict(roster.assignments, person, row.date, row.date)) return false;
      covered.add(person);
    }
  }
  return PEOPLE.every((person) => covered.has(person));
}

function currentSwapRoster() {
  const shown = monthKey(shownMonth);
  if (state.rosters[shown]) return state.rosters[shown];
  const nextRosterMonth = nextRosterMonthKey();
  if (state.rosters[nextRosterMonth]) return state.rosters[nextRosterMonth];
  const currentMonth = monthKey(new Date(realNow.getFullYear(), realNow.getMonth(), 1));
  if (state.rosters[currentMonth]) return state.rosters[currentMonth];
  return demoMode ? state.rosters[shown] : null;
}
function employeeDates(roster, person) { return (roster?.assignments || []).filter((row) => row.assigned.includes(person)).map((row) => ({ value: row.date, label: parseDate(row.date).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" }) })); }
function isNAOn(person, date) { return Boolean(state.availability[person]?.[date.slice(0, 7)]?.[date]); }
const requestType = () => document.querySelector('input[name="swapType"]:checked')?.value || "swap";
function eligibleSwapColleagues(roster, requester, fromDate) {
  const sourceRow = roster?.assignments.find((row) => row.date === fromDate);
  if (!sourceRow) return [];
  return PEOPLE.filter((person) => sameRosterGroup(requester, person) && person !== requester && !sourceRow.assigned.includes(person) && eligibleSwapDates(roster, requester, person, fromDate).length);
}
function eligibleSwapDates(roster, requester, colleague, fromDate) {
  return (roster?.assignments || []).filter((row) => row.date !== fromDate
    && row.assigned.includes(colleague)
    && !row.assigned.includes(requester)
  ).map((row) => ({ value: row.date, label: parseDate(row.date).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" }) }));
}
function eligibleCoverColleagues(roster, requester, fromDate) {
  const sourceRow = roster?.assignments.find((row) => row.date === fromDate);
  if (!sourceRow) return [];
  return PEOPLE.filter((person) => person !== requester
    && sameRosterGroup(requester, person)
    && !sourceRow.assigned.includes(person)
  );
}
function updateSwapButton() {
  const eligible = Boolean(currentSwapRoster()) && (demoMode || realNow.getDate() >= 1);
  $("submitSwap").disabled = !eligible || !$("swapRequester").value || !$("swapFromDate").value || !$("swapColleague").value || (requestType() === "swap" && !$("swapToDate").value);
}
function renderSwap() {
  hideNATooltip();
  const requester = swapRequesterSelected ? $("swapRequester").value : "", previousFrom = $("swapFromDate").value, previousColleague = $("swapColleague").value, previousTo = $("swapToDate").value, roster = currentSwapRoster();
  const mode = requestType();
  $("swapColleagueLabel").firstChild.textContent = mode === "cover" ? "Cover By" : "Swap With";
  $("swapToDateLabel").hidden = mode === "cover";
  $("submitSwap").textContent = mode === "cover" ? "Send Cover Request To Colleague" : "Send Request To Colleague";
  setOptions($("swapRequester"), teamOptions(sortByDisplayName(PEOPLE.filter((name) => !INACTIVE.has(name)))), "Select your name"); $("swapRequester").value = requester;
  const assignedDates = employeeDates(roster, requester);
  setOptions($("swapFromDate"), assignedDates, assignedDates.length ? "Select Your Assigned Shift" : "No Assigned Dates");
  if ([...$("swapFromDate").options].some((option) => option.value === previousFrom)) $("swapFromDate").value = previousFrom;
  const fromDate = $("swapFromDate").value;
  const colleagues = mode === "cover" ? eligibleCoverColleagues(roster, requester, fromDate) : eligibleSwapColleagues(roster, requester, fromDate);
  setOptions($("swapColleague"), teamOptions(sortByDisplayName(colleagues)), colleagues.length ? (mode === "cover" ? "Select Someone To Cover" : "Select An Available Colleague") : "No Eligible Colleagues");
  if (colleagues.includes(previousColleague)) $("swapColleague").value = previousColleague;
  const colleague = $("swapColleague").value;
  const dates = mode === "cover" ? [] : eligibleSwapDates(roster, requester, colleague, fromDate);
  setOptions($("swapToDate"), dates, dates.length ? "Select Their Shift" : "No Eligible Shift Dates");
  $("swapToDate").disabled = mode === "cover";
  if (dates.some((option) => option.value === previousTo)) $("swapToDate").value = previousTo;
  const eligible = Boolean(roster) && (demoMode || realNow.getDate() >= 1);
  updateSwapButton();
  $("swapEligibility").textContent = eligible ? (demoMode ? "Demo Eligible" : "Requests Open") : "No Current Roster";
  renderSwapRequestList();
  document.querySelectorAll(".revoke-swap").forEach((button) => button.addEventListener("click", () => revokeSwap(button.dataset.id)));
  document.querySelectorAll(".colleague-approve").forEach((button) => button.addEventListener("click", () => decideColleagueSwap(button.dataset.id, true)));
  document.querySelectorAll(".colleague-reject").forEach((button) => button.addEventListener("click", () => decideColleagueSwap(button.dataset.id, false)));
}
function renderSwapRequestList() {
  const total = state.swapRequests.length;
  if (!total) {
    $("swapRequestList").innerHTML = `<div class="empty-state">No Swap Requests.</div>`;
    return;
  }
  const pages = Math.max(1, Math.ceil(total / SWAP_REQUESTS_PER_PAGE));
  swapRequestPage = Math.min(Math.max(1, swapRequestPage), pages);
  const newestFirst = state.swapRequests.slice().reverse();
  const start = (swapRequestPage - 1) * SWAP_REQUESTS_PER_PAGE;
  const visibleRequests = newestFirst.slice(start, start + SWAP_REQUESTS_PER_PAGE);
  const pageLabel = total <= SWAP_REQUESTS_PER_PAGE ? `${total} Request${total === 1 ? "" : "s"}` : `Page ${swapRequestPage} Of ${pages} · ${total} Requests`;
  $("swapRequestList").innerHTML = `
    <div class="request-page-summary">
      <span>${pageLabel}</span>
      ${pages > 1 ? `<div class="request-pager"><button class="secondary request-page-prev" type="button" ${swapRequestPage === 1 ? "disabled" : ""}>Previous</button><button class="secondary request-page-next" type="button" ${swapRequestPage === pages ? "disabled" : ""}>Next</button></div>` : ""}
    </div>
    ${requestCards(visibleRequests, false, false)}
  `;
  $("swapRequestList").querySelector(".request-page-prev")?.addEventListener("click", () => { swapRequestPage -= 1; renderSwap(); });
  $("swapRequestList").querySelector(".request-page-next")?.addEventListener("click", () => { swapRequestPage += 1; renderSwap(); });
}
function requestCards(requests, admin = false, reverse = true) {
  if (!requests.length) return `<div class="empty-state">No Swap Requests.</div>`;
  const viewer = $("swapRequester")?.value;
  return (reverse ? requests.slice().reverse() : requests).map((request) => {
    const isCover = request.type === "cover";
    const requestTypeLabel = isCover ? "Cover" : "Swap";
    const requestStatusClass = request.status.replace(/[^a-z-]/g, "-");
    const colleagueAction = !admin && request.status === "awaiting-colleague" && request.colleague === viewer ? `<div class="request-actions"><button class="primary colleague-approve" data-id="${request.id}">${isCover ? "Approve Cover With My Code" : "Approve Swap With My Code"}</button><button class="danger colleague-reject" data-id="${request.id}">Decline With My Code</button></div>` : "";
    const revokeAction = !admin && ["awaiting-colleague", "colleague-approved", "approved"].includes(request.status) && request.requester === viewer ? `<button class="danger revoke-swap" data-id="${request.id}">${request.status === "approved" ? "Revoke Approved Swap" : "Revoke Request"}</button>` : "";
    const statusText = request.status === "awaiting-colleague" ? `Waiting For ${displayName(request.colleague)} Approval` : request.status === "colleague-approved" ? "Colleague Approved" : request.status;
    const helper = !admin && request.status === "awaiting-colleague" && request.colleague !== viewer ? `<em class="request-hint">For approval, ${safe(displayName(request.colleague))} should select their own name, enter their personal code, then approve or decline.</em>` : "";
    const title = isCover ? `${safe(displayName(request.colleague))} covers for ${safe(displayName(request.requester))}` : `${safe(displayName(request.requester))} ↔ ${safe(displayName(request.colleague))}`;
    const detail = isCover ? `${safe(request.fromDate)} covered on behalf of ${safe(displayName(request.requester))}` : `${safe(request.fromDate)} exchanged with ${safe(request.toDate)}`;
    const reasonText = request.reason ? `${safe(request.reason)} · ` : "";
    return `<div class="request-card ${isCover ? "cover" : "swap"}"><div class="request-card-copy"><div class="request-badges"><span class="request-type-badge ${isCover ? "cover" : "swap"}">${requestTypeLabel}</span><span class="request-status-badge ${requestStatusClass}">${safe(statusText)}</span></div><strong>${title}</strong><p>${detail}</p><small>${reasonText}${new Date(request.createdAt).toLocaleString("en-IN")}</small>${helper}</div><div class="request-card-actions">${colleagueAction || revokeAction}</div></div>`;
  }).join("");
}
function applyApprovedRequest(request, actor) {
  if (!sameRosterGroup(request.requester, request.colleague)) return "Swap and cover requests must stay within the same group.";
  const rosterEntry = Object.entries(state.rosters).find(([, roster]) => roster.assignments.some((row) => row.date === request.fromDate) && (request.type === "cover" || roster.assignments.some((row) => row.date === request.toDate)));
  if (!rosterEntry) return "The roster for this request no longer exists.";
  const [month, roster] = rosterEntry, oldRoster = structuredClone(roster);
  const rowA = roster.assignments.find((row) => row.date === request.fromDate), rowB = roster.assignments.find((row) => row.date === request.toDate);
  if (request.type === "cover") {
    if (!rowA.assigned.includes(request.requester)) return "Assignments changed; this cover request must be reviewed again.";
    if (rowA.assigned.includes(request.colleague)) return "Cover rejected: this employee is already assigned on that date.";
    rowA.assigned[rowA.assigned.indexOf(request.requester)] = request.colleague;
  } else {
    if (!rowA.assigned.includes(request.requester) || !rowB.assigned.includes(request.colleague)) return "Assignments changed; this request must be reviewed again.";
    if (rowA.assigned.includes(request.colleague) || rowB.assigned.includes(request.requester)) return "Swap rejected: one employee is already assigned on the destination date.";
    rowA.assigned[rowA.assigned.indexOf(request.requester)] = request.colleague;
    rowB.assigned[rowB.assigned.indexOf(request.colleague)] = request.requester;
  }
  request.status = "approved";
  request.decidedAt = new Date().toISOString();
  request.approvedBy = actor;
  audit(request.type === "cover" ? "COVER_APPROVED" : "SWAP_APPROVED", actor, request.type === "cover" ? `${request.colleague} covered ${request.requester} on ${request.fromDate} in ${month}` : `${request.requester} (${request.fromDate}) swapped with ${request.colleague} (${request.toDate}) in ${month}`, { request, roster: oldRoster }, { request, roster });
  renderCalendar(); renderRoster();
  return "";
}
function decideColleagueSwap(id, approved) {
  const request = state.swapRequests.find((item) => item.id === id);
  if (!request || request.status !== "awaiting-colleague" || request.colleague !== $("swapRequester").value) return;
  const accessCode = cleanCode($("swapAccessCode").value);
  if (sharedMode && !accessCode) { alert("Enter your personal code before approving or declining."); return; }
  if (sharedMode) {
    window.RosterBackend.decideColleagueSwap(id, approved, $("swapRequester").value, accessCode)
      .then(() => refreshSharedState())
      .catch((error) => alert(`Shared colleague approval failed: ${error.message}`));
    return;
  }
  const before = structuredClone(request);
  request.colleagueDecidedAt = new Date().toISOString();
  const label = request.type === "cover" ? "cover" : "swap";
  if (!approved) {
    request.status = "rejected";
    audit(request.type === "cover" ? "COVER_COLLEAGUE_REJECTED" : "SWAP_COLLEAGUE_REJECTED", displayName(request.colleague), `Colleague declined ${label} ${id}`, before, request);
  } else {
    const error = applyApprovedRequest(request, displayName(request.colleague));
    if (error) { alert(error); return; }
    audit(request.type === "cover" ? "COVER_COLLEAGUE_APPROVED" : "SWAP_COLLEAGUE_APPROVED", displayName(request.colleague), `Colleague approved ${label} ${id}; roster updated`, before, request);
  }
  persist(); renderSwap(); renderAdmin();
}
async function revokeSwap(id) {
  const request = state.swapRequests.find((item) => item.id === id);
  if (!request || !["awaiting-colleague", "colleague-approved", "approved"].includes(request.status) || request.requester !== $("swapRequester").value) return;
  const accessCode = cleanCode($("swapAccessCode").value);
  if (sharedMode && !accessCode) { alert("Enter your personal code before revoking."); return; }
  if (sharedMode) {
    try {
      await window.RosterBackend.revokeSwap(id, $("swapRequester").value, accessCode);
      await refreshSharedState();
    } catch (error) { alert(`Shared revocation failed: ${error.message}`); }
    return;
  }
  const before = structuredClone(request), previousStatus = request.status;
  if (previousStatus === "approved") {
    const roster = Object.values(state.rosters).find((item) => item.assignments.some((row) => row.date === request.fromDate) && (request.type === "cover" || item.assignments.some((row) => row.date === request.toDate)));
    const source = roster?.assignments.find((row) => row.date === request.fromDate), destination = roster?.assignments.find((row) => row.date === request.toDate);
    if (request.type === "cover") {
      if (!source?.assigned.includes(request.colleague) || source.assigned.includes(request.requester)) {
        alert("This approved cover request can no longer be safely reversed because the roster changed. Ask the admin to review it."); return;
      }
      source.assigned[source.assigned.indexOf(request.colleague)] = request.requester;
    } else {
      if (!source?.assigned.includes(request.colleague) || !destination?.assigned.includes(request.requester) || source.assigned.includes(request.requester) || destination.assigned.includes(request.colleague)) {
        alert("This approved swap can no longer be safely reversed because the roster changed. Ask the admin to review it."); return;
      }
      source.assigned[source.assigned.indexOf(request.colleague)] = request.requester;
      destination.assigned[destination.assigned.indexOf(request.requester)] = request.colleague;
    }
  }
  request.status = "revoked"; request.revokedAt = new Date().toISOString();
  audit(request.type === "cover" ? "COVER_REVOKED" : "SWAP_REVOKED", displayName(request.requester), `${previousStatus === "approved" ? "Reversed approved" : "Revoked pending"} ${request.type === "cover" ? "cover" : "swap"} ${id}`, before, request);
  persist(); renderCalendar(); renderRoster(); renderSwap(); renderAdmin();
}
async function submitSwap() {
  if (sharedMissing) { alert("Shared database is not configured yet. Swap and cover requests need shared storage."); return; }
  const type = requestType();
  const request = { id: crypto.randomUUID(), type, requester: $("swapRequester").value, fromDate: $("swapFromDate").value, colleague: $("swapColleague").value, toDate: type === "cover" ? null : $("swapToDate").value, reason: $("swapReason").value.trim(), status: "awaiting-colleague", createdAt: new Date().toISOString() };
  const accessCode = cleanCode($("swapAccessCode").value);
  if (!request.requester) { alert("Select your name before sending the request."); return; }
  if (sharedMode && !accessCode) { alert("Enter your personal code before sending the request."); return; }
  if (!sameRosterGroup(request.requester, request.colleague)) { alert("Swap and cover requests must stay within the same group."); return; }
  if (sharedMode) {
    try {
      await window.RosterBackend.requestSwap(request, accessCode);
      $("swapMessage").textContent = `${type === "cover" ? "Cover request" : "Swap request"} sent to ${displayName(request.colleague)} for approval first.`;
      $("swapReason").value = "";
      swapRequestPage = 1;
      await refreshSharedState();
    } catch (error) { alert(`Shared request failed: ${error.message}`); }
    return;
  }
  state.swapRequests.push(request); audit(type === "cover" ? "COVER_REQUESTED" : "SWAP_REQUESTED", displayName(request.requester), type === "cover" ? `${displayName(request.colleague)} covering ${request.fromDate}` : `${request.fromDate} with ${displayName(request.colleague)} on ${request.toDate}`, null, request);
  $("swapMessage").textContent = `${type === "cover" ? "Cover request" : "Swap request"} sent to ${displayName(request.colleague)} for approval first.`; $("swapReason").value = ""; swapRequestPage = 1; renderSwap(); renderAdmin();
}
function specialVolunteerRows() {
  return state.specialVolunteers?.[SPECIAL_WEEKEND_EVENT.key] || [];
}
function specialCollectionOpen() {
  return demoMode || appNow() < SPECIAL_WEEKEND_EVENT.cutoff;
}
function selectedSpecialDates() {
  return SPECIAL_WEEKEND_EVENT.dates
    .filter((date) => $(`specialVolunteer${date.key.endsWith("-08") ? "Sat" : "Sun"}`)?.checked)
    .map((date) => date.key);
}
function setSpecialDatesForPerson(person) {
  const volunteered = new Set(specialVolunteerRows().filter((row) => row.employee_code === person).map((row) => row.volunteer_date));
  $("specialVolunteerSat").checked = volunteered.has("2026-08-08");
  $("specialVolunteerSun").checked = volunteered.has("2026-08-09");
}
function hasSpecialNomination(person) {
  return Boolean(person) && specialVolunteerRows().some((row) => row.employee_code === person);
}
function renderSpecialVolunteers() {
  const open = specialCollectionOpen();
  const selected = $("specialVolunteerName")?.value || "";
  const rows = specialVolunteerRows();
  $("specialVolunteerStatus").textContent = state.specialVolunteerError ? "Setup Pending" : open ? "Open Until Fri 7 PM" : "Closed";
  $("specialVolunteerStatus").className = `status ${state.specialVolunteerError ? "warning" : open ? "ready" : "pending"}`;
  $("saveSpecialVolunteer").disabled = !open || !selected || Boolean(state.specialVolunteerError);
  $("revokeSpecialVolunteer").disabled = !open || !selected || !hasSpecialNomination(selected) || Boolean(state.specialVolunteerError);
  document.querySelectorAll(".special-date-card input").forEach((input) => input.disabled = !open || !selected || Boolean(state.specialVolunteerError));
  const codeInput = $("specialVolunteerCode");
  if (codeInput) codeInput.disabled = !open || !selected || Boolean(state.specialVolunteerError);
  const message = $("specialVolunteerMessage");
  if (state.specialVolunteerError && message && !message.textContent) {
    message.textContent = state.specialVolunteerError;
    message.className = "inline-message error";
  }
  $("specialVolunteerLists").innerHTML = SPECIAL_WEEKEND_EVENT.dates.map((date) => {
    const volunteers = rows
      .filter((row) => row.volunteer_date === date.key)
      .sort((a, b) => displayName(a.employee_code).localeCompare(displayName(b.employee_code), "en-IN", { sensitivity: "base" }));
    return `<article class="special-day-list"><div class="special-day-list-head"><strong>${safe(date.label)}</strong><span>${volunteers.length} Nomination${volunteers.length === 1 ? "" : "s"}</span></div>${volunteers.length ? `<div class="special-volunteer-names">${volunteers.map((row) => `<span>${safe(displayName(row.employee_code))}</span>`).join("")}</div>` : `<p>No Nominations Yet.</p>`}</article>`;
  }).join("");
}
async function saveSpecialVolunteerDates(person, accessCode, dates, messagePrefix = "Nomination") {
  if (sharedMode) {
    await window.RosterBackend.saveSpecialVolunteer(SPECIAL_WEEKEND_EVENT.key, person, accessCode, dates);
    $("specialVolunteerCode").value = "";
    $("specialVolunteerMessage").textContent = dates.length ? `${messagePrefix} saved.` : `${messagePrefix} revoked.`;
    $("specialVolunteerMessage").className = "inline-message";
    await refreshSharedState();
    setSpecialDatesForPerson(person);
    return;
  }
  const before = structuredClone(specialVolunteerRows());
  state.specialVolunteers[SPECIAL_WEEKEND_EVENT.key] = specialVolunteerRows().filter((row) => row.employee_code !== person);
  dates.forEach((date) => state.specialVolunteers[SPECIAL_WEEKEND_EVENT.key].push({ employee_code: person, volunteer_date: date, saved_at: new Date().toISOString() }));
  audit(dates.length ? "SPECIAL_VOLUNTEER_SAVED" : "SPECIAL_VOLUNTEER_REVOKED", displayName(person), dates.length ? `${dates.length} special volunteer date(s) saved` : "Special volunteer nomination revoked", before, state.specialVolunteers[SPECIAL_WEEKEND_EVENT.key]);
  persist();
  $("specialVolunteerMessage").textContent = dates.length ? `${messagePrefix} saved.` : `${messagePrefix} revoked.`;
  $("specialVolunteerMessage").className = "inline-message";
  renderSpecialVolunteers();
}
async function saveSpecialVolunteer(event, forcedDates = null, messagePrefix = "Nomination") {
  event?.preventDefault();
  if (sharedMissing) { alert("Shared database is not configured yet. Special volunteers need shared storage."); return; }
  if (!specialCollectionOpen()) { alert("Special volunteer collection is closed."); return; }
  const person = $("specialVolunteerName").value;
  const accessCode = cleanCode($("specialVolunteerCode").value);
  const dates = forcedDates ?? selectedSpecialDates();
  if (!person) { alert("Select your name first."); return; }
  if (sharedMode && !accessCode) { alert("Enter your personal code before saving."); return; }
  try {
    await saveSpecialVolunteerDates(person, accessCode, dates, messagePrefix);
  } catch (error) {
    $("specialVolunteerMessage").textContent = `Save failed: ${error.message}`;
    $("specialVolunteerMessage").className = "inline-message error";
  }
}
async function revokeSpecialVolunteer() {
  const person = $("specialVolunteerName").value;
  if (!person) { alert("Select your name first."); return; }
  if (!hasSpecialNomination(person)) { alert("No nomination found for your name."); return; }
  $("specialVolunteerSat").checked = false;
  $("specialVolunteerSun").checked = false;
  await saveSpecialVolunteer(null, [], "Nomination");
}
async function decideSwap(id, approved) {
  const admin = adminActor(); if (!admin) return;
  const request = state.swapRequests.find((item) => item.id === id); if (!request || request.status !== "colleague-approved") return;
  if (sharedMode) {
    try {
      await window.RosterBackend.decideSwap(id, approved);
      await refreshSharedState();
    } catch (error) { alert(`Shared approval failed: ${error.message}`); }
    return;
  }
  const rosterEntry = Object.entries(state.rosters).find(([, roster]) => roster.assignments.some((row) => row.date === request.fromDate) && (request.type === "cover" || roster.assignments.some((row) => row.date === request.toDate)));
  const before = structuredClone(request);
  if (!approved) { request.status = "rejected"; request.decidedAt = new Date().toISOString(); request.admin = admin; audit(request.type === "cover" ? "COVER_REJECTED" : "SWAP_REJECTED", admin, `Rejected request ${id}`, before, request); }
  else if (!rosterEntry) alert("The roster for this request no longer exists.");
  else {
    const [month, roster] = rosterEntry, oldRoster = structuredClone(roster);
    const rowA = roster.assignments.find((row) => row.date === request.fromDate), rowB = roster.assignments.find((row) => row.date === request.toDate);
    if (request.type === "cover") {
      if (!rowA.assigned.includes(request.requester)) { alert("Assignments changed; this cover request must be reviewed again."); return; }
      if (rowA.assigned.includes(request.colleague)) { alert("Cover rejected: this employee is already assigned on that date."); return; }
      if (RosterEngine.hasScheduleConflict(roster.assignments, request.colleague, request.fromDate)) { alert("Cover rejected: it would create a same-weekend or consecutive-Saturday conflict."); return; }
      rowA.assigned[rowA.assigned.indexOf(request.requester)] = request.colleague;
    } else {
      if (!rowA.assigned.includes(request.requester) || !rowB.assigned.includes(request.colleague)) { alert("Assignments changed; this request must be reviewed again."); return; }
      if (rowA.assigned.includes(request.colleague) || rowB.assigned.includes(request.requester)) { alert("Swap rejected: one employee is already assigned on the destination date."); return; }
      if (RosterEngine.hasScheduleConflict(roster.assignments, request.colleague, request.fromDate, request.toDate) || RosterEngine.hasScheduleConflict(roster.assignments, request.requester, request.toDate, request.fromDate)) { alert("Swap rejected: it would create a same-weekend or consecutive-Saturday conflict."); return; }
      rowA.assigned[rowA.assigned.indexOf(request.requester)] = request.colleague;
      rowB.assigned[rowB.assigned.indexOf(request.colleague)] = request.requester;
    }
    request.status = "approved"; request.decidedAt = new Date().toISOString(); request.admin = admin;
    audit(request.type === "cover" ? "COVER_APPROVED" : "SWAP_APPROVED", admin, request.type === "cover" ? `${request.colleague} covered ${request.requester} on ${request.fromDate} in ${month}` : `${request.requester} (${request.fromDate}) swapped with ${request.colleague} (${request.toDate}) in ${month}`, { request: before, roster: oldRoster }, { request, roster });
    renderCalendar(); renderRoster();
  }
  persist(); renderSwap(); renderAdmin();
}
function renderAdmin() {
  const unlocked = Boolean(activeAdmin);
  $("adminGate").hidden = unlocked;
  $("adminControls").hidden = !unlocked;
  $("adminAccessStatus").textContent = unlocked ? "Unlocked" : "Locked";
  $("adminAccessStatus").className = `status ${unlocked ? "ready" : "pending"}`;
  if (unlocked) $("adminSessionText").textContent = `${activeAdmin} has admin controls unlocked for this browser session.`;
  $("adminRequests").innerHTML = `<div class="empty-state">Swap and cover changes are completed directly after colleague code approval. Full request activity is available in the change history below.</div>`;
  $("mappingRequests").innerHTML = identityRequests.length ? identityRequests.map((request) => `<div class="request-card"><div><strong>${safe(request.full_name)}</strong><small>Account Mapping Request · ${new Date(request.created_at).toLocaleString("en-IN")}</small></div><div class="request-actions"><button class="primary approve-mapping" data-id="${request.id}">Approve</button><button class="danger reject-mapping" data-id="${request.id}">Reject</button></div></div>`).join("") : `<div class="empty-state">No Pending Account Mappings.</div>`;
  document.querySelectorAll(".approve-mapping").forEach((button) => button.addEventListener("click", () => decideIdentity(button.dataset.id, true)));
  document.querySelectorAll(".reject-mapping").forEach((button) => button.addEventListener("click", () => decideIdentity(button.dataset.id, false)));
  $("auditBody").innerHTML = state.audit.slice().reverse().map((entry) => `<tr><td>${new Date(entry.at).toLocaleString("en-IN")}</td><td>${safe(entry.actor)}</td><td>${safe(entry.action)}</td><td>${safe(entry.details)}</td></tr>`).join("") || `<tr><td colspan="4">No Changes Logged Yet.</td></tr>`;
}
async function decideIdentity(id, approved) {
  try {
    await window.RosterBackend.decideIdentity(id, approved);
    if (sharedMode) await refreshSharedState();
    else identityRequests = await window.RosterBackend.mappingRequests() || [];
    renderAdmin();
  }
  catch (error) { alert(`Account mapping failed: ${error.message}`); }
}
async function finalizeMonth() {
  const admin = adminActor(); if (!admin) return;
  const month = monthKey(shownMonth), roster = state.rosters[month]; if (!roster) { alert("Generate the roster before finalizing it."); return; }
  if (sharedMode) {
    try {
      await window.RosterBackend.finalizeRoster(month, admin, activeAdminAccessCode);
      await refreshSharedState();
    } catch (error) { alert(`Finalization failed: ${error.message}`); }
    return;
  }
  const before = structuredClone(roster); roster.status = "finalized"; roster.finalizedAt = new Date().toISOString();
  audit("ROSTER_FINALIZED", admin, `${month} finalized for monthly archive`, before, roster);
  renderCalendar(); renderRoster(); renderAdmin();
}
function downloadFile(content, filename, type) {
  const link = document.createElement("a"), blob = new Blob([content], { type });
  link.href = URL.createObjectURL(blob); link.download = filename; link.click(); URL.revokeObjectURL(link.href);
}
function downloadJSON(data, filename) { downloadFile(JSON.stringify(data, null, 2), filename, "application/json"); }
function formatNADates(person, month) {
  const dates = Object.keys(state.availability[person]?.[month] || {}).sort();
  return dates.length
    ? dates.map((key) => parseDate(key).toLocaleDateString("en-IN", { weekday: "short", day: "2-digit", month: "short", year: "numeric" })).join(", ")
    : "No NA submitted";
}
function buildNAProofText(month) {
  const titleMonth = parseDate(`${month}-01`).toLocaleDateString("en-IN", { month: "long", year: "numeric" });
  const lines = [
    "Weekend Shift Roster - NA Entries Proof",
    `Roster month: ${titleMonth}`,
    "Submission window: 15th 11:00 AM IST to 28th 7:00 PM IST",
    `Exported at: ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "medium" })} IST`,
    ""
  ];
  PEOPLE.forEach((person) => {
    const submittedAt = state.submissions[person]?.[month]?.savedAt;
    const savedInfo = submittedAt ? ` | saved: ${new Date(submittedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "medium" })} IST` : " | no saved response";
    lines.push(`${displayName(person)}: ${formatNADates(person, month)}${savedInfo}`);
  });
  return `${lines.join("\n")}\n`;
}
async function exportNAProof(month = monthKey(shownMonth)) {
  if (sharedMode) await refreshSharedState(false);
  downloadFile(buildNAProofText(month), `weekend-roster-na-proof-${month}.txt`, "text/plain");
}
async function autoExportNAProofAtCutoff() {
  if (!isCutoffPassed() || demoMode || previewMode) return;
  if (sharedMode) await refreshSharedState(false);
  const month = nextRosterMonthKey();
  const key = `${STORAGE_KEY}-na-proof-exported-${month}`;
  if (localStorage.getItem(key)) return;
  try {
    await exportNAProof(month);
    localStorage.setItem(key, new Date().toISOString());
  } catch (error) {
    console.error("NA proof export failed", error);
  }
}
function importData(event) {
  if (sharedMode) { alert("Import is disabled in shared database mode so the browser cannot overwrite database data."); event.target.value = ""; return; }
  const file = event.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = () => { try { const parsed = JSON.parse(reader.result); state = normalizeState({ ...emptyState(), ...parsed }); persist(); loadPersonDraft(); renderAll(); } catch (error) { alert(`Could not import: ${error.message}`); } };
  reader.readAsText(file);
}

document.querySelectorAll(".tab").forEach((tab) => tab.addEventListener("click", () => { hideNATooltip(); document.querySelectorAll(".tab, .panel").forEach((item) => item.classList.remove("active")); tab.classList.add("active"); $(tab.dataset.panel).classList.add("active"); }));
$("currentPersonSelect").addEventListener("change", renderCurrentRoster);
$("personSelect").addEventListener("change", () => {
  const person = selectedPerson();
  if (person !== activeEmployee) {
    activeEmployee = "";
    activeEmployeeAccessCode = "";
  }
  loadPersonDraft();
  renderCalendar();
  if (person && sharedMode) openEmployeeCodeDialog(person);
});
$("prevMonth").addEventListener("click", () => { shownMonth = new Date(shownMonth.getFullYear(), shownMonth.getMonth() - 1, 1); loadPersonDraft(); renderAll(); });
$("nextMonth").addEventListener("click", () => { shownMonth = new Date(shownMonth.getFullYear(), shownMonth.getMonth() + 1, 1); loadPersonDraft(); renderAll(); });
$("saveButton").addEventListener("click", saveAvailability);
$("generateButton").addEventListener("click", () => { const admin = adminActor(); if (admin) generateRoster(admin); });
$("unlockAdmin").addEventListener("click", () => unlockAdmin());
$("lockAdmin").addEventListener("click", lockAdmin);
$("swapRequester").addEventListener("change", () => { swapRequesterSelected = Boolean($("swapRequester").value); $("swapAccessCode").value = ""; renderSwap(); }); $("swapColleague").addEventListener("change", renderSwap); $("submitSwap").addEventListener("click", submitSwap);
$("swapFromDate").addEventListener("change", renderSwap); $("swapToDate").addEventListener("change", updateSwapButton);
document.querySelectorAll('input[name="swapType"]').forEach((input) => input.addEventListener("change", renderSwap));
$("specialVolunteerName").addEventListener("change", () => { $("specialVolunteerCode").value = ""; $("specialVolunteerMessage").textContent = ""; setSpecialDatesForPerson($("specialVolunteerName").value); renderSpecialVolunteers(); });
$("specialVolunteerForm").addEventListener("submit", saveSpecialVolunteer);
$("revokeSpecialVolunteer").addEventListener("click", revokeSpecialVolunteer);
document.querySelectorAll(".special-date-card input").forEach((input) => input.addEventListener("change", renderSpecialVolunteers));
$("exportButton").addEventListener("click", () => downloadJSON(state, `weekend-roster-${monthKey(shownMonth)}.json`));
$("exportNAProof").addEventListener("click", () => exportNAProof());
$("downloadAudit").addEventListener("click", () => downloadJSON({ exportedAt: new Date().toISOString(), entries: state.audit }, "weekend-roster-audit-log.json"));
$("finalizeButton").addEventListener("click", finalizeMonth);
$("employeeCodeForm").addEventListener("submit", unlockSelectedEmployee);
$("closeEmployeeCode").addEventListener("click", () => closeEmployeeCodeDialog(true));
$("cancelEmployeeUnlock").addEventListener("click", () => closeEmployeeCodeDialog(true));

$("accountButton").addEventListener("click", async () => {
  if (sharedMissing) { alert("Supabase is not configured yet. Add the project URL and public anon key to config.js first."); return; }
  if (currentProfile) { await window.RosterBackend.signOut(); location.reload(); }
  else $("authDialog").showModal();
});
$("closeAuth").addEventListener("click", () => $("authDialog").close());
$("googleSignIn").addEventListener("click", async () => {
  try { await window.RosterBackend.signInWithGoogle(); }
  catch (error) { $("authMessage").textContent = error.message; }
});
setOptions($("claimName"), TEAM.map(([value, label]) => ({ value, label })), "Select your name");
setOptions($("adminName"), ADMIN_ACCOUNTS.map((admin) => ({ value: admin.name, label: admin.name })), "Select admin name");
$("claimIdentity").addEventListener("click", async () => {
  const employeeCode = $("claimName").value;
  const fullName = displayName(employeeCode);
  if (!employeeCode) { $("authMessage").textContent = "Select your name first."; return; }
  try { await window.RosterBackend.requestIdentity(employeeCode, fullName); $("authMessage").textContent = "Mapping requested. An administrator must approve it before you can continue."; }
  catch (error) { $("authMessage").textContent = error.message; }
});

async function initializeSharedMode() {
  $("backendStatus").textContent = sharedMode ? "Shared Supabase" : sharedMissing ? "Shared setup needed" : "Local demo";
  $("backendStatus").className = `connection ${sharedMode ? "shared" : "local"}`;
  if (sharedMissing) {
    $("accountButton").textContent = "Setup required";
    $("accountButton").disabled = true;
    document.querySelectorAll("#availabilityPanel button, #swapPanel button, #adminPanel button, #availabilityPanel select, #swapPanel select, #adminPanel select, #adminPanel input").forEach((control) => control.disabled = true);
    renderWindow();
    renderCurrentRoster();
    return;
  }
  if (!sharedMode) {
    return;
  }
  $("backendStatus").textContent = "Shared Supabase";
  $("backendStatus").className = "connection shared";
  $("accountButton").textContent = "Shared database";
  $("accountButton").disabled = true;
  $("accountButton").hidden = true;
  try {
    const remote = await window.RosterBackend.loadState();
    if (remote) state = normalizeState({ ...emptyState(), ...remote });
    try {
      const volunteers = await window.RosterBackend.loadSpecialVolunteers(SPECIAL_WEEKEND_EVENT.key);
      state.specialVolunteers[SPECIAL_WEEKEND_EVENT.key] = volunteers || [];
      state.specialVolunteerError = "";
    } catch (error) {
      state.specialVolunteerError = "Special volunteer database setup is pending.";
      console.error("Special volunteer load failed", error);
    }
    displayNames = { ...displayNames, ...Object.fromEntries((remote.team || []).map((member) => [member.employee_code, member.full_name])) };
    resetShownMonthToSubmissionTarget();
    currentProfile = { role: "employee", employee_code: selectedPerson(), full_name: selectedPerson() ? displayName(selectedPerson()) : "Open team form" };
    loadPersonDraft(); renderAll();
  } catch (error) {
    $("backendStatus").textContent = "Connection error";
    console.error(error);
  }
}

function renderAll() { renderCurrentRoster(); renderCalendar(); renderRoster(); renderSwap(); renderSpecialVolunteers(); renderAdmin(); }
setOptions($("currentPersonSelect"), teamOptions(sortByDisplayName(PEOPLE)), "Select your name");
setOptions($("personSelect"), teamOptions(sortByDisplayName(PEOPLE)), "Select your name");
setOptions($("specialVolunteerName"), teamOptions(sortByDisplayName(PEOPLE)), "Select your name");
resetShownMonthToSubmissionTarget();
loadPersonDraft(); renderAll(); updateClock();
setInterval(() => {
  updateClock();
  renderWindow();
  renderSpecialVolunteers();
  autoExportNAProofAtCutoff();
  ensureCutoffRoster();
}, 1000);
setInterval(() => {
  if (sharedMode && !dirty) {
    refreshSharedState().catch((error) => console.error("Shared refresh failed", error));
  }
}, 30000);
window.addEventListener("focus", () => {
  if (sharedMode && !dirty) {
    refreshSharedState().catch((error) => console.error("Shared refresh failed", error));
  }
});
const currentRoster = state.rosters[monthKey(shownMonth)];
if (previewMode === "after" && !currentRoster) generateRoster("Preview scheduler");
else if (!sharedMode && previewMode !== "before" && isCutoffPassed() && !currentRoster) generateRoster();
initializeSharedMode();
