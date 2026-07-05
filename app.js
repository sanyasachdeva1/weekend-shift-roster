const TEAM = window.PUBLIC_TEAM || [];
const PEOPLE = TEAM.map(([code]) => code);
// No hard-coded PTO: anyone who does not submit NA dates is available by default.
const INACTIVE = new Set();
const STORAGE_KEY = "weekend-roster-data-v2";
const $ = (id) => document.getElementById(id);
const realNow = new Date();
const demoMode = new URLSearchParams(location.search).get("demo") === "1";
let shownMonth = new Date(realNow.getFullYear(), realNow.getMonth() + 1, 1);
let state = loadState();
let pendingNA = new Set();
let dirty = false;
let currentProfile = null;
let identityRequests = [];
let displayNames = Object.fromEntries(TEAM);

const dateKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const monthKey = (date) => dateKey(date).slice(0, 7);
const parseDate = (key) => new Date(`${key}T12:00:00`);
const initials = (name) => name.split(" ").slice(0, 2).map((part) => part[0]).join("");
const safe = (value) => String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
const displayName = (code) => displayNames[code] || code;
const isSubmissionOpen = () => demoMode || (realNow.getDate() >= 15 && realNow.getDate() <= 28 && monthKey(shownMonth) === monthKey(new Date(realNow.getFullYear(), realNow.getMonth() + 1, 1)));

function emptyState() { return { version: 2, availability: {}, submissions: {}, rosters: {}, swapRequests: [], audit: [] }; }
function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return { ...emptyState(), ...saved, swapRequests: saved?.swapRequests || [], audit: saved?.audit || [] };
  } catch { return emptyState(); }
}
function persist() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
function audit(action, actor, details, before = null, after = null) {
  state.audit.push({ id: crypto.randomUUID(), at: new Date().toISOString(), action, actor, details, before, after });
  persist();
}

function updateClock() {
  const time = new Date();
  $("liveTime").textContent = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(time);
  $("liveDate").textContent = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(time);
}
function renderWindow() {
  const open = isSubmissionOpen();
  $("windowNotice").classList.toggle("closed", !open);
  $("windowTitle").textContent = open ? "Availability collection is open" : "Availability collection is closed";
  $("windowMessage").textContent = open
    ? `Submit and save NA dates for ${shownMonth.toLocaleDateString("en-IN", { month: "long", year: "numeric" })} by the 28th.`
    : `The next-month form opens on the 15th and closes after the 28th. ${demoMode ? "Demo override is active." : "Calendar changes are locked."}`;
  $("windowBadge").textContent = demoMode ? "Demo open" : open ? "Open · closes 28th" : "Closed";
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
  const selected = $("personSelect").value || PEOPLE[0];
  setOptions($("personSelect"), PEOPLE, "");
  $("personSelect").value = selected;
  const month = monthKey(shownMonth);
  let responses = 0;
  $("teamList").innerHTML = PEOPLE.map((name) => {
    const submission = state.submissions[name]?.[month];
    const count = Object.keys(state.availability[name]?.[month] || {}).length;
    if (submission) responses += 1;
    const badge = submission ? `<span class="badge done">Saved · ${count} NA</span>` : `<span class="badge">Default available</span>`;
    return `<div class="person-row"><span class="avatar">${initials(name)}</span><div><strong title="${safe(displayName(name))}">${safe(displayName(name))}</strong><small>${submission ? `Submitted ${new Date(submission.savedAt).toLocaleString("en-IN")}` : "No response · available all month"}</small></div>${badge}</div>`;
  }).join("");
  $("responseCount").textContent = `${responses} / ${PEOPLE.length}`;
}
function renderCalendar() {
  const year = shownMonth.getFullYear(), month = shownMonth.getMonth();
  $("monthTitle").textContent = shownMonth.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
  const offset = (new Date(year, month, 1).getDay() + 6) % 7;
  let html = `<button class="day blank" tabindex="-1"></button>`.repeat(offset);
  for (let day = 1; day <= new Date(year, month + 1, 0).getDate(); day += 1) {
    const date = new Date(year, month, day), weekend = [0, 6].includes(date.getDay()), key = dateKey(date), na = pendingNA.has(key);
    html += `<button class="day ${weekend ? "weekend" : ""} ${na ? "na" : ""}" ${weekend ? `data-date="${key}" aria-pressed="${na}" ${isSubmissionOpen() ? "" : "disabled"}` : "disabled"}><span class="day-number">${day}</span>${weekend ? `<span class="day-label">${na ? "NA" : "Available"}</span>` : ""}</button>`;
  }
  $("calendar").innerHTML = html;
  document.querySelectorAll("[data-date]").forEach((button) => button.addEventListener("click", () => {
    pendingNA.has(button.dataset.date) ? pendingNA.delete(button.dataset.date) : pendingNA.add(button.dataset.date);
    dirty = true; renderCalendar(); updateSaveState();
  }));
  renderPeople(); renderWindow();
}
async function saveAvailability() {
  if (!isSubmissionOpen()) return;
  const person = $("personSelect").value, month = monthKey(shownMonth), before = state.availability[person]?.[month] || {};
  state.availability[person] ||= {};
  state.availability[person][month] = Object.fromEntries([...pendingNA].map((key) => [key, true]));
  state.submissions[person] ||= {};
  state.submissions[person][month] = { savedAt: new Date().toISOString() };
  audit("AVAILABILITY_SAVED", person, `${pendingNA.size} NA date(s) saved for ${month}`, before, state.availability[person][month]);
  if (window.RosterBackend.configured) {
    try { await window.RosterBackend.saveAvailability(person, month, [...pendingNA]); }
    catch (error) { alert(`Shared save failed: ${error.message}`); return; }
  }
  dirty = false; updateSaveState(); renderPeople();
}

function weekendDates(monthDate) {
  const dates = [], year = monthDate.getFullYear(), month = monthDate.getMonth();
  for (let day = 1; day <= new Date(year, month + 1, 0).getDate(); day += 1) {
    const date = new Date(year, month, day); if ([0, 6].includes(date.getDay())) dates.push(date);
  }
  return dates;
}
async function generateRoster(actor = "System scheduler") {
  const month = monthKey(shownMonth), eligible = PEOPLE.filter((name) => !INACTIVE.has(name));
  const generated = RosterEngine.generate({ people: eligible, monthDate: shownMonth, availability: state.availability, submissions: state.submissions, rosters: state.rosters });
  const assignments = generated.assignments;
  const warnings = generated.warnings.map((warning) => PEOPLE.reduce((text, code) => text.replaceAll(code, displayName(code)), warning));
  const before = state.rosters[month] || null;
  state.rosters[month] = { month, status: warnings.length ? "needs-review" : "published", generatedAt: new Date().toISOString(), assignments, warnings };
  audit(before ? "ROSTER_REGENERATED" : "ROSTER_GENERATED", actor, `${month} roster generated with ${warnings.length} warning(s)`, before, state.rosters[month]);
  if (window.RosterBackend.configured) await window.RosterBackend.saveRoster(month, state.rosters[month]);
  renderRoster(); renderSwap(); renderAdmin();
}
function renderRoster() {
  const roster = state.rosters[monthKey(shownMonth)];
  if (!roster) { $("rosterEmpty").hidden = false; $("rosterTableWrap").hidden = true; $("rosterStatus").textContent = "Pending cutoff"; return; }
  $("rosterEmpty").hidden = true; $("rosterTableWrap").hidden = false;
  $("rosterBody").innerHTML = roster.assignments.map((row) => {
    const date = parseDate(row.date), overrideNames = new Set((row.overrides || []).map((item) => item.name));
    return `<tr><td><strong>${date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</strong></td><td>${date.toLocaleDateString("en-IN", { weekday: "long" })}</td><td>${row.required}</td><td><div class="names">${row.assigned.map((name) => `<span class="name-chip ${overrideNames.has(name) ? "override" : ""}" title="${overrideNames.has(name) ? "NA overridden because this was a latest response" : ""}">${safe(displayName(name))}${overrideNames.has(name) ? " · override" : ""}</span>`).join("")}</div></td><td class="${row.assigned.length === row.required ? "ok" : "shortage"}">${row.assigned.length === row.required ? (overrideNames.size ? "Covered with override" : "Covered") : "Shortage"}</td></tr>`;
  }).join("");
  const ready = ["published", "finalized"].includes(roster.status);
  $("rosterStatus").textContent = roster.status === "finalized" ? "Finalized" : ready ? "Published" : "Needs review";
  $("rosterStatus").className = `status ${ready ? "ready" : "warning"}`;
  $("warnings").hidden = !roster.warnings.length; $("warnings").textContent = roster.warnings.join(" · ");
}

function currentSwapRoster() {
  const currentMonth = monthKey(new Date(realNow.getFullYear(), realNow.getMonth(), 1));
  if (state.rosters[currentMonth]) return state.rosters[currentMonth];
  return demoMode ? state.rosters[monthKey(shownMonth)] : null;
}
function employeeDates(roster, person) { return (roster?.assignments || []).filter((row) => row.assigned.includes(person)).map((row) => ({ value: row.date, label: parseDate(row.date).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" }) })); }
function updateSwapButton() {
  const eligible = Boolean(currentSwapRoster()) && (demoMode || realNow.getDate() >= 1);
  $("submitSwap").disabled = !eligible || !$("swapFromDate").value || !$("swapToDate").value;
}
function renderSwap() {
  const requester = $("swapRequester").value || PEOPLE[0], colleague = $("swapColleague").value || PEOPLE[1], roster = currentSwapRoster();
  setOptions($("swapRequester"), PEOPLE.filter((name) => !INACTIVE.has(name)), ""); $("swapRequester").value = requester;
  setOptions($("swapColleague"), PEOPLE.filter((name) => !INACTIVE.has(name) && name !== requester), "");
  $("swapColleague").value = colleague === requester ? PEOPLE.find((name) => !INACTIVE.has(name) && name !== requester) : colleague;
  setOptions($("swapFromDate"), employeeDates(roster, requester), "No assigned dates");
  setOptions($("swapToDate"), employeeDates(roster, $("swapColleague").value), "No assigned dates");
  const eligible = Boolean(roster) && (demoMode || realNow.getDate() >= 1);
  updateSwapButton();
  $("swapEligibility").textContent = eligible ? (demoMode ? "Demo eligible" : "Requests open") : "No current roster";
  $("swapRequestList").innerHTML = requestCards(state.swapRequests);
}
function requestCards(requests, admin = false) {
  if (!requests.length) return `<div class="empty-state">No swap requests.</div>`;
  return requests.slice().reverse().map((request) => `<div class="request-card"><div><strong>${safe(displayName(request.requester))} ↔ ${safe(displayName(request.colleague))}</strong><p>${safe(request.fromDate)} exchanged with ${safe(request.toDate)}</p><small>${safe(request.reason || "No reason supplied")} · ${new Date(request.createdAt).toLocaleString("en-IN")} · ${safe(request.status)}</small></div>${admin && request.status === "pending" ? `<div class="request-actions"><button class="primary approve-swap" data-id="${request.id}">Approve</button><button class="danger reject-swap" data-id="${request.id}">Reject</button></div>` : ""}</div>`).join("");
}
async function submitSwap() {
  const request = { id: crypto.randomUUID(), requester: $("swapRequester").value, fromDate: $("swapFromDate").value, colleague: $("swapColleague").value, toDate: $("swapToDate").value, reason: $("swapReason").value.trim(), status: "pending", createdAt: new Date().toISOString() };
  state.swapRequests.push(request); audit("SWAP_REQUESTED", request.requester, `${request.fromDate} with ${request.colleague} on ${request.toDate}`, null, request);
  if (window.RosterBackend.configured) {
    try { await window.RosterBackend.requestSwap(request); }
    catch (error) { alert(`Shared request failed: ${error.message}`); return; }
  }
  $("swapMessage").textContent = "Request sent to the admin for approval."; $("swapReason").value = ""; renderSwap(); renderAdmin();
}
async function decideSwap(id, approved) {
  const admin = $("adminName").value.trim(); if (!admin) { alert("Enter the administrator name first."); return; }
  const request = state.swapRequests.find((item) => item.id === id); if (!request || request.status !== "pending") return;
  const rosterEntry = Object.entries(state.rosters).find(([, roster]) => roster.assignments.some((row) => row.date === request.fromDate) && roster.assignments.some((row) => row.date === request.toDate));
  const before = structuredClone(request);
  if (!approved) { request.status = "rejected"; request.decidedAt = new Date().toISOString(); request.admin = admin; audit("SWAP_REJECTED", admin, `Rejected request ${id}`, before, request); }
  else if (!rosterEntry) alert("The roster for this request no longer exists.");
  else {
    const [month, roster] = rosterEntry, oldRoster = structuredClone(roster);
    const rowA = roster.assignments.find((row) => row.date === request.fromDate), rowB = roster.assignments.find((row) => row.date === request.toDate);
    if (!rowA.assigned.includes(request.requester) || !rowB.assigned.includes(request.colleague)) { alert("Assignments changed; this request must be reviewed again."); return; }
    rowA.assigned[rowA.assigned.indexOf(request.requester)] = request.colleague;
    rowB.assigned[rowB.assigned.indexOf(request.colleague)] = request.requester;
    request.status = "approved"; request.decidedAt = new Date().toISOString(); request.admin = admin;
    audit("SWAP_APPROVED", admin, `${request.requester} (${request.fromDate}) swapped with ${request.colleague} (${request.toDate}) in ${month}`, { request: before, roster: oldRoster }, { request, roster });
    renderRoster();
  }
  persist(); renderSwap(); renderAdmin();
  if (window.RosterBackend.configured) {
    try { await window.RosterBackend.decideSwap(id, approved); }
    catch (error) { alert(`Shared approval failed: ${error.message}`); }
  }
}
function renderAdmin() {
  $("adminRequests").innerHTML = requestCards(state.swapRequests.filter((request) => request.status === "pending"), true);
  document.querySelectorAll(".approve-swap").forEach((button) => button.addEventListener("click", () => decideSwap(button.dataset.id, true)));
  document.querySelectorAll(".reject-swap").forEach((button) => button.addEventListener("click", () => decideSwap(button.dataset.id, false)));
  $("mappingRequests").innerHTML = identityRequests.length ? identityRequests.map((request) => `<div class="request-card"><div><strong>${safe(request.full_name)}</strong><p>${safe(request.employee_code)}</p><small>Google-authenticated account · ${new Date(request.created_at).toLocaleString("en-IN")}</small></div><div class="request-actions"><button class="primary approve-mapping" data-id="${request.id}">Approve</button><button class="danger reject-mapping" data-id="${request.id}">Reject</button></div></div>`).join("") : `<div class="empty-state">No pending account mappings.</div>`;
  document.querySelectorAll(".approve-mapping").forEach((button) => button.addEventListener("click", () => decideIdentity(button.dataset.id, true)));
  document.querySelectorAll(".reject-mapping").forEach((button) => button.addEventListener("click", () => decideIdentity(button.dataset.id, false)));
  $("auditBody").innerHTML = state.audit.slice().reverse().map((entry) => `<tr><td>${new Date(entry.at).toLocaleString("en-IN")}</td><td>${safe(entry.actor)}</td><td>${safe(entry.action)}</td><td>${safe(entry.details)}</td></tr>`).join("") || `<tr><td colspan="4">No changes logged yet.</td></tr>`;
}
async function decideIdentity(id, approved) {
  try { await window.RosterBackend.decideIdentity(id, approved); identityRequests = await window.RosterBackend.mappingRequests() || []; renderAdmin(); }
  catch (error) { alert(`Account mapping failed: ${error.message}`); }
}
async function finalizeMonth() {
  const admin = $("adminName").value.trim(); if (!admin) { alert("Enter the administrator name first."); return; }
  const month = monthKey(shownMonth), roster = state.rosters[month]; if (!roster) { alert("Generate the roster before finalizing it."); return; }
  const before = structuredClone(roster); roster.status = "finalized"; roster.finalizedAt = new Date().toISOString();
  audit("ROSTER_FINALIZED", admin, `${month} finalized for monthly archive`, before, roster);
  if (window.RosterBackend.configured) { try { await window.RosterBackend.finalizeRoster(month); } catch (error) { alert(`Finalization failed: ${error.message}`); return; } }
  renderRoster(); renderAdmin();
}
function downloadJSON(data, filename) { const link = document.createElement("a"), blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }); link.href = URL.createObjectURL(blob); link.download = filename; link.click(); URL.revokeObjectURL(link.href); }
function importData(event) { const file = event.target.files[0]; if (!file) return; const reader = new FileReader(); reader.onload = () => { try { const parsed = JSON.parse(reader.result); state = { ...emptyState(), ...parsed }; persist(); loadPersonDraft(); renderAll(); } catch (error) { alert(`Could not import: ${error.message}`); } }; reader.readAsText(file); }

document.querySelectorAll(".tab").forEach((tab) => tab.addEventListener("click", () => { document.querySelectorAll(".tab, .panel").forEach((item) => item.classList.remove("active")); tab.classList.add("active"); $(tab.dataset.panel).classList.add("active"); }));
$("personSelect").addEventListener("change", () => { loadPersonDraft(); renderCalendar(); });
$("prevMonth").addEventListener("click", () => { shownMonth = new Date(shownMonth.getFullYear(), shownMonth.getMonth() - 1, 1); loadPersonDraft(); renderAll(); });
$("nextMonth").addEventListener("click", () => { shownMonth = new Date(shownMonth.getFullYear(), shownMonth.getMonth() + 1, 1); loadPersonDraft(); renderAll(); });
$("saveButton").addEventListener("click", saveAvailability);
$("generateButton").addEventListener("click", () => { const admin = $("adminName").value.trim(); if (!admin) alert("Enter the administrator name first."); else generateRoster(admin); });
$("swapRequester").addEventListener("change", renderSwap); $("swapColleague").addEventListener("change", renderSwap); $("submitSwap").addEventListener("click", submitSwap);
$("swapFromDate").addEventListener("change", updateSwapButton); $("swapToDate").addEventListener("change", updateSwapButton);
$("exportButton").addEventListener("click", () => downloadJSON(state, `weekend-roster-${monthKey(shownMonth)}.json`));
$("downloadAudit").addEventListener("click", () => downloadJSON({ exportedAt: new Date().toISOString(), entries: state.audit }, "weekend-roster-audit-log.json"));
$("finalizeButton").addEventListener("click", finalizeMonth);
$("importFile").addEventListener("change", importData);

$("accountButton").addEventListener("click", async () => {
  if (currentProfile) { await window.RosterBackend.signOut(); location.reload(); }
  else $("authDialog").showModal();
});
$("closeAuth").addEventListener("click", () => $("authDialog").close());
$("googleSignIn").addEventListener("click", async () => {
  try { await window.RosterBackend.signInWithGoogle(); }
  catch (error) { $("authMessage").textContent = error.message; }
});
setOptions($("claimName"), TEAM.map(([value, label]) => ({ value, label })), "Select your name");
$("claimIdentity").addEventListener("click", async () => {
  const employeeCode = $("claimName").value;
  const fullName = displayName(employeeCode);
  if (!employeeCode) { $("authMessage").textContent = "Select your name first."; return; }
  try { await window.RosterBackend.requestIdentity(employeeCode, fullName); $("authMessage").textContent = "Mapping requested. An administrator must approve it before you can continue."; }
  catch (error) { $("authMessage").textContent = error.message; }
});

async function initializeSharedMode() {
  if (!window.RosterBackend.configured) {
    return;
  }
  $("backendStatus").textContent = "Shared Supabase"; $("backendStatus").className = "connection shared";
  try {
    const session = await window.RosterBackend.session();
    if (!session) { $("accountButton").textContent = "Sign in"; $("authDialog").showModal(); return; }
    currentProfile = await window.RosterBackend.profile();
    const remote = await window.RosterBackend.loadState();
    if (remote) { state = { ...emptyState(), ...remote }; persist(); }
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
setOptions($("personSelect"), PEOPLE, "");
loadPersonDraft(); renderAll(); updateClock(); setInterval(updateClock, 1000);
if (realNow.getDate() >= 29 && !state.rosters[monthKey(shownMonth)]) generateRoster();
initializeSharedMode();
