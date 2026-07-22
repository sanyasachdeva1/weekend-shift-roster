const TEAM = window.PUBLIC_TEAM || [];
const PEOPLE = TEAM.map(([code]) => code);
const TEAM_ROLE = Object.fromEntries(TEAM.map(([code, , role = "basic"]) => [code, role]));
const SIGNATURE_PEOPLE = PEOPLE.filter((code) => TEAM_ROLE[code] === "signature");
const sameRosterGroup = (a, b) => TEAM_ROLE[a] === TEAM_ROLE[b];
// No hard-coded PTO: anyone who does not submit NA dates is available by default.
const INACTIVE = new Set();
const query = new URLSearchParams(location.search);
const ADMIN_ACCOUNTS = [
  { name: "Sanya Sachdeva", salt: "5c143b6c", hash: "45c6494d" },
  { name: "Naveen Kumar M", salt: "264cfb4d", hash: "7170fa04" },
  { name: "Simran Vyas", salt: "c29868bf", hash: "0023bf9d" },
  { name: "ISHANT VARSHNEY", salt: "79cc8728", hash: "96a91250" },
  { name: "Saravanan Natarajan", salt: "30766617", hash: "0c62ecbe" }
];
const STORAGE_KEY = query.get("storage") ? `weekend-roster-data-v4-${query.get("storage")}` : query.get("preview") ? `weekend-roster-data-v4-${query.get("preview")}` : "weekend-roster-data-v4";
const ADMIN_SESSION_KEY = "weekend-roster-admin-session";
const SUBMISSION_OPEN_MINUTE = ((15 - 1) * 24 * 60) + (11 * 60);
const JULY_2026_RESET_OPEN_MINUTE = ((22 - 1) * 24 * 60) + (11 * 60);
const SUBMISSION_CUTOFF_MINUTE = ((28 - 1) * 24 * 60) + (19 * 60);
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

const dateKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const monthKey = (date) => dateKey(date).slice(0, 7);
const parseDate = (key) => new Date(`${key}T12:00:00`);
const initials = (name) => name.split(" ").slice(0, 2).map((part) => part[0]).join("");
const safe = (value) => String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
const displayName = (code) => displayNames[code] || code;
const teamOptions = (codes) => codes.map((value) => ({ value, label: displayName(value) }));
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
const isSubmissionOpen = () => {
  if (sharedMissing) return false;
  const parts = istNowParts(appNow());
  const minute = monthMinute(parts);
  const openMinute = parts.year === 2026 && parts.month === 7 ? JULY_2026_RESET_OPEN_MINUTE : SUBMISSION_OPEN_MINUTE;
  return demoMode || (minute >= openMinute && minute < SUBMISSION_CUTOFF_MINUTE && monthKey(shownMonth) === nextRosterMonthKey());
};

function emptyState() { return { version: 2, availability: {}, submissions: {}, rosters: {}, swapRequests: [], audit: [] }; }
function loadState() {
  if (sharedMode || sharedMissing) return emptyState();
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return normalizeState({ ...emptyState(), ...saved, swapRequests: saved?.swapRequests || [], audit: saved?.audit || [] });
  } catch { return emptyState(); }
}
function normalizeState(data) {
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
  if (!sharedMode || !currentProfile?.employee_code) return false;
  const remote = await window.RosterBackend.loadState();
  state = normalizeState({ ...emptyState(), ...remote });
  if (remote?.team) displayNames = { ...displayNames, ...Object.fromEntries(remote.team.map((member) => [member.employee_code, member.full_name])) };
  if (currentProfile.role === "admin") identityRequests = await window.RosterBackend.mappingRequests() || [];
  if (render) { loadPersonDraft(); renderAll(); }
  return true;
}
function adminActor() {
  if (!activeAdmin) {
    alert("Unlock admin controls with your admin name and code first.");
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
  const code = $("adminCode").value.trim();
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
  sessionStorage.setItem(ADMIN_SESSION_KEY, activeAdmin);
  $("adminCode").value = "";
  $("adminAccessMessage").textContent = "";
  audit("ADMIN_UNLOCKED", activeAdmin, "Admin controls unlocked");
  renderAdmin();
}
function lockAdmin() {
  if (activeAdmin) audit("ADMIN_LOCKED", activeAdmin, "Admin controls locked");
  activeAdmin = "";
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
    $("windowTitle").textContent = "Shared database setup required";
    $("windowMessage").textContent = "Do not collect NA dates yet. This production page needs Supabase configured so submissions from all laptops save into one shared roster database.";
    $("windowBadge").textContent = "Setup required";
    $("saveButton").disabled = true;
    return;
  }
  const open = isSubmissionOpen();
  $("windowNotice").classList.toggle("closed", !open);
  $("windowTitle").textContent = open ? "Availability collection is open" : "Availability collection is closed";
  const parts = istNowParts(appNow());
  const openText = parts.year === 2026 && parts.month === 7 ? "22nd 11:00 AM IST for this fresh collection cycle" : "15th 11:00 AM IST every month";
  $("windowMessage").textContent = open
    ? `Submit and save NA dates for ${shownMonth.toLocaleDateString("en-IN", { month: "long", year: "numeric" })}. The window closes at 28th 7:00 PM IST.`
    : `The next-month form opens at ${openText} and closes at 28th 7:00 PM IST. After that, calendar changes are locked. ${demoMode ? "Demo override is active." : ""}`;
  $("windowBadge").textContent = demoMode ? "Demo open" : open ? "Open · closes 28th 7 PM" : "Closed";
  $("saveButton").disabled = !open || !dirty;
}
function updateSaveState() {
  $("saveState").textContent = dirty ? "Unsaved changes" : "No unsaved changes";
  renderWindow();
}

function setOptions(select, values, placeholder) {
  select.innerHTML = `${placeholder ? `<option value="">${safe(placeholder)}</option>` : ""}${values.map((value) => `<option value="${safe(value.value ?? value)}">${safe(value.label ?? value)}</option>`).join("")}`;
}
function loadPersonDraft() {
  const person = $("personSelect").value || PEOPLE[0];
  pendingNA = new Set(Object.keys(state.availability[person]?.[monthKey(shownMonth)] || {}));
  dirty = false;
  updateSaveState();
}
function renderPeople() {
  // Availability context is integrated into each weekend calendar cell.
}
function naNamesForDate(key) { return PEOPLE.filter((code) => state.availability[code]?.[key.slice(0, 7)]?.[key]).map(displayName); }
function shownRoster() {
  if (previewMode === "before") return null;
  return state.rosters[monthKey(shownMonth)] || null;
}
function renderCalendar() {
  const year = shownMonth.getFullYear(), month = shownMonth.getMonth();
  const roster = shownRoster();
  $("monthTitle").textContent = shownMonth.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
  const offset = (new Date(year, month, 1).getDay() + 6) % 7;
  let html = `<button class="day blank" tabindex="-1"></button>`.repeat(offset);
  for (let day = 1; day <= new Date(year, month + 1, 0).getDate(); day += 1) {
    const date = new Date(year, month, day), weekend = [0, 6].includes(date.getDay()), key = dateKey(date), na = pendingNA.has(key), teamNA = weekend ? naNamesForDate(key) : [];
    const row = weekend ? roster?.assignments?.find((item) => item.date === key) : null;
    const overrideNames = new Set((row?.overrides || []).map((item) => item.name));
    const assignedHtml = row ? `<div class="assignment-list">${row.assigned.map((name) => `<span class="assignment-chip ${overrideNames.has(name) ? "override" : ""}" title="${overrideNames.has(name) ? "NA overridden because this was a latest response" : ""}">${safe(displayName(name))}${overrideNames.has(name) ? " · override" : ""}</span>`).join("")}</div>` : "";
    const weekendHeader = row
      ? `<div class="day-top roster-day-top"><span class="day-number">${day}</span></div>`
      : `<div class="day-top"><span class="day-number">${day}</span><span class="day-label">${na ? "Your NA" : "Available"} <span class="label-separator">•</span> ${teamNA.length} NA</span></div>`;
    html += `<button class="day ${weekend ? "weekend" : ""} ${na ? "na" : ""}" ${weekend ? `data-date="${key}" data-na="${safe(teamNA.length ? `NA: ${teamNA.join(", ")}` : "No NA submitted")}" aria-pressed="${na}" ${isSubmissionOpen() ? "" : "disabled"}` : "disabled"}>${weekend ? `${weekendHeader}${assignedHtml}` : `<span class="day-number weekday-number">${day}</span>`}</button>`;
  }
  $("calendar").innerHTML = html;
  document.querySelectorAll("[data-date]").forEach((button) => button.addEventListener("click", () => {
    pendingNA.has(button.dataset.date) ? pendingNA.delete(button.dataset.date) : pendingNA.add(button.dataset.date);
    dirty = true; renderCalendar(); updateSaveState();
  }));
  renderPeople(); renderWindow();
}
async function saveAvailability() {
  if (sharedMissing) { alert("Shared database is not configured yet. Do not collect NA dates until Supabase is connected."); return; }
  if (!isSubmissionOpen()) return;
  const person = $("personSelect").value, month = monthKey(shownMonth);
  if (sharedMode) {
    try {
      await window.RosterBackend.saveAvailability(person, month, [...pendingNA]);
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
  state.rosters[month] = { month, status: warnings.length ? "needs-review" : "published", generatedAt: new Date().toISOString(), assignments, warnings };
  audit(before ? "ROSTER_REGENERATED" : "ROSTER_GENERATED", actor, `${month} roster generated with ${warnings.length} warning(s)`, before, state.rosters[month]);
  if (sharedMode) {
    try {
      await window.RosterBackend.saveRoster(month, state.rosters[month]);
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
  if (!roster) {
    $("rosterSummary").innerHTML = `<span class="summary-pill">Roster pending cutoff</span><span class="summary-pill">Saturday needs 4 + 1 signature</span><span class="summary-pill">Sunday needs 3 + 1 signature</span>`;
    $("warnings").hidden = true;
    return;
  }
  const ready = ["published", "finalized"].includes(roster.status);
  const assignedCount = roster.assignments.reduce((sum, row) => sum + row.assigned.length, 0);
  const peopleCovered = new Set(roster.assignments.flatMap((row) => row.assigned)).size;
  $("rosterSummary").innerHTML = `<span class="summary-pill ${ready ? "ready" : "warning"}">${safe(roster.status === "finalized" ? "Finalized roster" : ready ? "Generated roster" : "Needs review")}</span><span class="summary-pill">${assignedCount} shifts planned</span><span class="summary-pill">${peopleCovered}/${PEOPLE.length} people scheduled</span>`;
  $("warnings").hidden = !roster.warnings.length; $("warnings").textContent = roster.warnings.join(" · ");
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
  const currentMonth = monthKey(new Date(realNow.getFullYear(), realNow.getMonth(), 1));
  if (state.rosters[currentMonth]) return state.rosters[currentMonth];
  if (previewMode === "after") return state.rosters[monthKey(shownMonth)] || null;
  return demoMode ? state.rosters[monthKey(shownMonth)] : null;
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
    && !RosterEngine.hasScheduleConflict(roster.assignments, colleague, fromDate, row.date)
    && !RosterEngine.hasScheduleConflict(roster.assignments, requester, row.date, fromDate)
  ).map((row) => ({ value: row.date, label: parseDate(row.date).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" }) }));
}
function eligibleCoverColleagues(roster, requester, fromDate) {
  const sourceRow = roster?.assignments.find((row) => row.date === fromDate);
  if (!sourceRow) return [];
  return PEOPLE.filter((person) => person !== requester
    && sameRosterGroup(requester, person)
    && !sourceRow.assigned.includes(person)
    && !RosterEngine.hasScheduleConflict(roster.assignments, person, fromDate));
}
function updateSwapButton() {
  const eligible = Boolean(currentSwapRoster()) && (demoMode || realNow.getDate() >= 1);
  $("submitSwap").disabled = !eligible || !$("swapFromDate").value || !$("swapColleague").value || (requestType() === "swap" && !$("swapToDate").value);
}
function renderSwap() {
  const requester = $("swapRequester").value || PEOPLE[0], previousFrom = $("swapFromDate").value, previousColleague = $("swapColleague").value, previousTo = $("swapToDate").value, roster = currentSwapRoster();
  const mode = requestType();
  $("swapColleagueLabel").firstChild.textContent = mode === "cover" ? "Cover by" : "Swap with";
  $("swapToDateLabel").hidden = mode === "cover";
  $("submitSwap").textContent = mode === "cover" ? "Send cover request to colleague" : "Send request to colleague";
  setOptions($("swapRequester"), teamOptions(PEOPLE.filter((name) => !INACTIVE.has(name))), ""); $("swapRequester").value = requester;
  const assignedDates = employeeDates(roster, requester);
  setOptions($("swapFromDate"), assignedDates, assignedDates.length ? "Select your assigned shift" : "No assigned dates");
  if ([...$("swapFromDate").options].some((option) => option.value === previousFrom)) $("swapFromDate").value = previousFrom;
  const fromDate = $("swapFromDate").value;
  const colleagues = mode === "cover" ? eligibleCoverColleagues(roster, requester, fromDate) : eligibleSwapColleagues(roster, requester, fromDate);
  setOptions($("swapColleague"), teamOptions(colleagues), colleagues.length ? (mode === "cover" ? "Select someone to cover" : "Select an available colleague") : "No eligible colleagues");
  if (colleagues.includes(previousColleague)) $("swapColleague").value = previousColleague;
  const colleague = $("swapColleague").value;
  const dates = mode === "cover" ? [] : eligibleSwapDates(roster, requester, colleague, fromDate);
  setOptions($("swapToDate"), dates, dates.length ? "Select their shift" : "No eligible shift dates");
  $("swapToDate").disabled = mode === "cover";
  if (dates.some((option) => option.value === previousTo)) $("swapToDate").value = previousTo;
  const eligible = Boolean(roster) && (demoMode || realNow.getDate() >= 1);
  updateSwapButton();
  $("swapEligibility").textContent = eligible ? (demoMode ? "Demo eligible" : "Requests open") : "No current roster";
  $("swapRequestList").innerHTML = requestCards(state.swapRequests);
  document.querySelectorAll(".revoke-swap").forEach((button) => button.addEventListener("click", () => revokeSwap(button.dataset.id)));
  document.querySelectorAll(".colleague-approve").forEach((button) => button.addEventListener("click", () => decideColleagueSwap(button.dataset.id, true)));
  document.querySelectorAll(".colleague-reject").forEach((button) => button.addEventListener("click", () => decideColleagueSwap(button.dataset.id, false)));
}
function requestCards(requests, admin = false) {
  if (!requests.length) return `<div class="empty-state">No swap requests.</div>`;
  const viewer = $("swapRequester")?.value;
  return requests.slice().reverse().map((request) => {
    const isCover = request.type === "cover";
    const colleagueAction = !admin && request.status === "awaiting-colleague" && request.colleague === viewer ? `<div class="request-actions"><button class="primary colleague-approve" data-id="${request.id}">${isCover ? "Approve cover" : "Approve swap"}</button><button class="danger colleague-reject" data-id="${request.id}">Decline</button></div>` : "";
    const revokeAction = !admin && ["awaiting-colleague", "colleague-approved", "approved"].includes(request.status) && request.requester === viewer ? `<button class="danger revoke-swap" data-id="${request.id}">${request.status === "approved" ? "Revoke approved swap" : "Revoke request"}</button>` : "";
    const statusText = request.status === "awaiting-colleague" ? `Waiting for ${displayName(request.colleague)} approval` : request.status === "colleague-approved" ? "Colleague approved" : request.status;
    const helper = !admin && request.status === "awaiting-colleague" && request.colleague !== viewer ? `<em class="request-hint">Select ${safe(displayName(request.colleague))} in “Your name” to approve or decline this request.</em>` : "";
    const title = isCover ? `${safe(displayName(request.colleague))} covers for ${safe(displayName(request.requester))}` : `${safe(displayName(request.requester))} ↔ ${safe(displayName(request.colleague))}`;
    const detail = isCover ? `${safe(request.fromDate)} covered on behalf of ${safe(displayName(request.requester))}` : `${safe(request.fromDate)} exchanged with ${safe(request.toDate)}`;
    return `<div class="request-card"><div><strong>${title}</strong><p>${detail}</p><small>${safe(request.reason || "No reason supplied")} · ${new Date(request.createdAt).toLocaleString("en-IN")} · ${safe(statusText)}</small>${helper}</div>${colleagueAction || revokeAction}</div>`;
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
    if (RosterEngine.hasScheduleConflict(roster.assignments, request.colleague, request.fromDate)) return "Cover rejected: it would create a same-weekend or consecutive-Saturday conflict.";
    rowA.assigned[rowA.assigned.indexOf(request.requester)] = request.colleague;
  } else {
    if (!rowA.assigned.includes(request.requester) || !rowB.assigned.includes(request.colleague)) return "Assignments changed; this request must be reviewed again.";
    if (rowA.assigned.includes(request.colleague) || rowB.assigned.includes(request.requester)) return "Swap rejected: one employee is already assigned on the destination date.";
    if (RosterEngine.hasScheduleConflict(roster.assignments, request.colleague, request.fromDate, request.toDate) || RosterEngine.hasScheduleConflict(roster.assignments, request.requester, request.toDate, request.fromDate)) return "Swap rejected: it would create a same-weekend or consecutive-Saturday conflict.";
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
  if (sharedMode) {
    window.RosterBackend.decideColleagueSwap(id, approved)
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
  if (sharedMode) {
    try {
      await window.RosterBackend.revokeSwap(id);
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
      if (RosterEngine.hasScheduleConflict(roster.assignments, request.requester, request.fromDate, request.fromDate)) {
        alert("The original shift now conflicts with another weekend assignment. Ask the admin to review the reversal."); return;
      }
      source.assigned[source.assigned.indexOf(request.colleague)] = request.requester;
    } else {
      if (!source?.assigned.includes(request.colleague) || !destination?.assigned.includes(request.requester) || source.assigned.includes(request.requester) || destination.assigned.includes(request.colleague)) {
        alert("This approved swap can no longer be safely reversed because the roster changed. Ask the admin to review it."); return;
      }
      if (RosterEngine.hasScheduleConflict(roster.assignments, request.requester, request.fromDate, request.toDate) || RosterEngine.hasScheduleConflict(roster.assignments, request.colleague, request.toDate, request.fromDate)) {
        alert("The original shifts now conflict with another weekend assignment. Ask the admin to review the reversal."); return;
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
  if (!sameRosterGroup(request.requester, request.colleague)) { alert("Swap and cover requests must stay within the same group."); return; }
  if (sharedMode) {
    try {
      await window.RosterBackend.requestSwap(request);
      $("swapMessage").textContent = `${type === "cover" ? "Cover request" : "Swap request"} sent to ${displayName(request.colleague)} for approval first.`;
      $("swapReason").value = "";
      await refreshSharedState();
    } catch (error) { alert(`Shared request failed: ${error.message}`); }
    return;
  }
  state.swapRequests.push(request); audit(type === "cover" ? "COVER_REQUESTED" : "SWAP_REQUESTED", displayName(request.requester), type === "cover" ? `${displayName(request.colleague)} covering ${request.fromDate}` : `${request.fromDate} with ${displayName(request.colleague)} on ${request.toDate}`, null, request);
  $("swapMessage").textContent = `${type === "cover" ? "Cover request" : "Swap request"} sent to ${displayName(request.colleague)} for approval first.`; $("swapReason").value = ""; renderSwap(); renderAdmin();
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
  $("adminRequests").innerHTML = `<div class="empty-state">Swap and cover changes are completed directly after colleague approval.</div>`;
  $("mappingRequests").innerHTML = identityRequests.length ? identityRequests.map((request) => `<div class="request-card"><div><strong>${safe(request.full_name)}</strong><small>Account mapping request · ${new Date(request.created_at).toLocaleString("en-IN")}</small></div><div class="request-actions"><button class="primary approve-mapping" data-id="${request.id}">Approve</button><button class="danger reject-mapping" data-id="${request.id}">Reject</button></div></div>`).join("") : `<div class="empty-state">No pending account mappings.</div>`;
  document.querySelectorAll(".approve-mapping").forEach((button) => button.addEventListener("click", () => decideIdentity(button.dataset.id, true)));
  document.querySelectorAll(".reject-mapping").forEach((button) => button.addEventListener("click", () => decideIdentity(button.dataset.id, false)));
  $("auditBody").innerHTML = state.audit.slice().reverse().map((entry) => `<tr><td>${new Date(entry.at).toLocaleString("en-IN")}</td><td>${safe(entry.actor)}</td><td>${safe(entry.action)}</td><td>${safe(entry.details)}</td></tr>`).join("") || `<tr><td colspan="4">No changes logged yet.</td></tr>`;
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
      await window.RosterBackend.finalizeRoster(month);
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
  if (sharedMode && currentProfile?.employee_code) await refreshSharedState(false);
  downloadFile(buildNAProofText(month), `weekend-roster-na-proof-${month}.txt`, "text/plain");
}
async function autoExportNAProofAtCutoff() {
  if (!isCutoffPassed() || demoMode || previewMode) return;
  if (sharedMode && !currentProfile?.employee_code) return;
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

document.querySelectorAll(".tab").forEach((tab) => tab.addEventListener("click", () => { document.querySelectorAll(".tab, .panel").forEach((item) => item.classList.remove("active")); tab.classList.add("active"); $(tab.dataset.panel).classList.add("active"); }));
$("personSelect").addEventListener("change", () => { loadPersonDraft(); renderCalendar(); });
$("prevMonth").addEventListener("click", () => { shownMonth = new Date(shownMonth.getFullYear(), shownMonth.getMonth() - 1, 1); loadPersonDraft(); renderAll(); });
$("nextMonth").addEventListener("click", () => { shownMonth = new Date(shownMonth.getFullYear(), shownMonth.getMonth() + 1, 1); loadPersonDraft(); renderAll(); });
$("saveButton").addEventListener("click", saveAvailability);
$("generateButton").addEventListener("click", () => { const admin = adminActor(); if (admin) generateRoster(admin); });
$("unlockAdmin").addEventListener("click", () => unlockAdmin());
$("lockAdmin").addEventListener("click", lockAdmin);
$("swapRequester").addEventListener("change", renderSwap); $("swapColleague").addEventListener("change", renderSwap); $("submitSwap").addEventListener("click", submitSwap);
$("swapFromDate").addEventListener("change", renderSwap); $("swapToDate").addEventListener("change", updateSwapButton);
document.querySelectorAll('input[name="swapType"]').forEach((input) => input.addEventListener("change", renderSwap));
$("exportButton").addEventListener("click", () => downloadJSON(state, `weekend-roster-${monthKey(shownMonth)}.json`));
$("exportNAProof").addEventListener("click", () => exportNAProof());
$("downloadAudit").addEventListener("click", () => downloadJSON({ exportedAt: new Date().toISOString(), entries: state.audit }, "weekend-roster-audit-log.json"));
$("finalizeButton").addEventListener("click", finalizeMonth);

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
    return;
  }
  if (!sharedMode) {
    return;
  }
  $("backendStatus").textContent = "Shared Supabase"; $("backendStatus").className = "connection shared";
  try {
    const session = await window.RosterBackend.session();
    if (!session) { $("accountButton").textContent = "Sign in"; $("authDialog").showModal(); return; }
    currentProfile = await window.RosterBackend.profile();
    const remote = await window.RosterBackend.loadState();
    if (remote) state = normalizeState({ ...emptyState(), ...remote });
    $("accountButton").textContent = `${currentProfile?.full_name || "Google user"} · Sign out`;
    if (!currentProfile?.employee_code) {
      $("authMessage").textContent = "Your Google account is signed in but is not yet approved for a team member. Submit your name mapping for admin approval.";
      $("authDialog").showModal();
      $("claimSection").hidden = false;
      document.querySelectorAll("#availabilityPanel button, #swapPanel button, #availabilityPanel select, #swapPanel select").forEach((control) => control.disabled = true);
      return;
    }
    displayNames = { ...displayNames, ...Object.fromEntries((remote.team || []).map((member) => [member.employee_code, member.full_name])) };
    $("personSelect").value = currentProfile.employee_code; $("personSelect").disabled = true;
    const adminTab = document.querySelector('[data-panel="adminPanel"]');
    adminTab.hidden = currentProfile?.role !== "admin";
    if (currentProfile?.role === "admin") identityRequests = await window.RosterBackend.mappingRequests() || [];
    loadPersonDraft(); renderAll();
  } catch (error) {
    $("backendStatus").textContent = "Connection error";
    console.error(error);
  }
}

function renderAll() { renderCalendar(); renderRoster(); renderSwap(); renderAdmin(); }
setOptions($("personSelect"), teamOptions(PEOPLE), "");
loadPersonDraft(); renderAll(); updateClock();
setInterval(() => {
  updateClock();
  renderWindow();
  autoExportNAProofAtCutoff();
  ensureCutoffRoster();
}, 1000);
setInterval(() => {
  if (sharedMode && currentProfile?.employee_code && !dirty) {
    refreshSharedState().catch((error) => console.error("Shared refresh failed", error));
  }
}, 30000);
window.addEventListener("focus", () => {
  if (sharedMode && currentProfile?.employee_code && !dirty) {
    refreshSharedState().catch((error) => console.error("Shared refresh failed", error));
  }
});
const currentRoster = state.rosters[monthKey(shownMonth)];
if (previewMode === "after" && !currentRoster) generateRoster("Preview scheduler");
else if (!sharedMode && previewMode !== "before" && isCutoffPassed() && !currentRoster) generateRoster();
initializeSharedMode();
