(function (root) {
  const keyOf = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const monthOf = (date) => keyOf(date).slice(0, 7);

  function generate({ people, monthDate, availability, submissions, rosters }) {
    const month = monthOf(monthDate);
    const previousMonth = monthOf(new Date(monthDate.getFullYear(), monthDate.getMonth() - 1, 1));
    const previousRoster = rosters[previousMonth];
    const previousLoad = Object.fromEntries(people.map((code) => [code, (previousRoster?.assignments || []).filter((row) => row.assigned.includes(code)).length]));
    const targetLoad = Object.fromEntries(people.map((code) => [code, previousLoad[code] >= 2 ? 1 : 2]));
    const monthlyLoad = Object.fromEntries(people.map((code) => [code, 0]));
    const lastSaturday = new Set(), assignments = [], warnings = [];
    const days = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0).getDate();
    for (let day = 1; day <= days; day += 1) {
      const date = new Date(monthDate.getFullYear(), monthDate.getMonth(), day);
      if (![0, 6].includes(date.getDay())) continue;
      const key = keyOf(date), saturday = date.getDay() === 6, required = saturday ? 4 : 3;
      const fairnessSort = (a, b) => (saturday && lastSaturday.has(a) ? 1 : 0) - (saturday && lastSaturday.has(b) ? 1 : 0)
        || (monthlyLoad[a] >= targetLoad[a] ? 1 : 0) - (monthlyLoad[b] >= targetLoad[b] ? 1 : 0)
        || (monthlyLoad[a] / targetLoad[a]) - (monthlyLoad[b] / targetLoad[b])
        || previousLoad[b] - previousLoad[a] || a.localeCompare(b);
      const candidates = people.filter((code) => !availability[code]?.[month]?.[key]).sort(fairnessSort);
      const assigned = candidates.slice(0, required), overrides = [];
      if (assigned.length < required) {
        const unavailable = people.filter((code) => availability[code]?.[month]?.[key] && !assigned.includes(code));
        unavailable.sort((a, b) => new Date(submissions[b]?.[month]?.savedAt || 0) - new Date(submissions[a]?.[month]?.savedAt || 0) || fairnessSort(a, b));
        for (const code of unavailable.slice(0, required - assigned.length)) {
          assigned.push(code); overrides.push({ name: code, submittedAt: submissions[code]?.[month]?.savedAt || null, reason: "Latest responder NA override" });
        }
      }
      assigned.forEach((code) => monthlyLoad[code] += 1);
      if (saturday) { lastSaturday.clear(); assigned.forEach((code) => lastSaturday.add(code)); }
      if (overrides.length) warnings.push(`${key}: ${overrides.map((item) => item.name).join(", ")} assigned by latest-response override`);
      if (assigned.length < required) warnings.push(`${key}: short ${required - assigned.length}`);
      assignments.push({ date: key, required, assigned, overrides });
    }
    return { assignments, warnings, previousLoad, targetLoad, monthlyLoad };
  }
  root.RosterEngine = { generate };
})(globalThis);
