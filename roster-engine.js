(function (root) {
  const keyOf = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const monthOf = (date) => keyOf(date).slice(0, 7);
  const parse = (key) => new Date(`${key}T12:00:00`);
  const weekendStart = (key) => { const date = parse(key); if (date.getDay() === 0) date.setDate(date.getDate() - 1); return keyOf(date); };
  function hasScheduleConflict(assignments, code, candidateDate, excludedDate = null) {
    const candidate = parse(candidateDate);
    return assignments.some((row) => row.date !== excludedDate && row.assigned.includes(code) && (
      weekendStart(row.date) === weekendStart(candidateDate)
      || (candidate.getDay() === 6 && parse(row.date).getDay() === 6 && Math.abs(candidate - parse(row.date)) === 7 * 86400000)
    ));
  }

  function generateGroup({ people, monthDate, availability, submissions, rosters, requiredForDate }) {
    const month = monthOf(monthDate);
    const previousMonth = monthOf(new Date(monthDate.getFullYear(), monthDate.getMonth() - 1, 1));
    const previousRoster = rosters[previousMonth];
    const previousLoad = Object.fromEntries(people.map((code) => [code, (previousRoster?.assignments || []).filter((row) => row.assigned.includes(code)).length]));
    const targetLoad = Object.fromEntries(people.map((code) => [code, previousLoad[code] >= 2 ? 1 : 2]));
    const monthlyLoad = Object.fromEntries(people.map((code) => [code, 0]));
    const assignments = [], warnings = [];
    const days = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0).getDate();
    for (let day = 1; day <= days; day += 1) {
      const date = new Date(monthDate.getFullYear(), monthDate.getMonth(), day);
      if (![0, 6].includes(date.getDay())) continue;
      assignments.push({ date: keyOf(date), required: requiredForDate(date), assigned: [], overrides: [] });
    }

    // Phase 1: reserve one shift for every team member before any second shifts.
    // People with fewer available dates are placed first so flexible people retain options.
    const coverageOrder = people.slice().sort((a, b) => {
      const availableCount = (code) => assignments.filter((row) => !availability[code]?.[month]?.[row.date]).length;
      return availableCount(a) - availableCount(b)
        || new Date(submissions[b]?.[month]?.savedAt || 0) - new Date(submissions[a]?.[month]?.savedAt || 0)
        || a.localeCompare(b);
    });
    for (const code of coverageOrder) {
      let choices = assignments.filter((row) => row.assigned.length < row.required && !availability[code]?.[month]?.[row.date] && !hasScheduleConflict(assignments, code, row.date));
      let overridden = false;
      if (!choices.length) { choices = assignments.filter((row) => row.assigned.length < row.required && !hasScheduleConflict(assignments, code, row.date)); overridden = true; }
      choices.sort((a, b) => (a.assigned.length / a.required) - (b.assigned.length / b.required) || a.date.localeCompare(b.date));
      const row = choices[0];
      if (!row) { warnings.push(`${code}: no monthly coverage slot available`); continue; }
      row.assigned.push(code); monthlyLoad[code] += 1;
      if (overridden) row.overrides.push({ name: code, submittedAt: submissions[code]?.[month]?.savedAt || null, reason: "Minimum monthly coverage override" });
    }

    // Phase 2: fill remaining daily requirements while respecting NA and 1/2 targets.
    const lastSaturday = new Set();
    for (const row of assignments) {
      const date = new Date(`${row.date}T12:00:00`), saturday = date.getDay() === 6;
      const fairnessSort = (a, b) => (saturday && lastSaturday.has(a) ? 1 : 0) - (saturday && lastSaturday.has(b) ? 1 : 0)
        || (monthlyLoad[a] >= targetLoad[a] ? 1 : 0) - (monthlyLoad[b] >= targetLoad[b] ? 1 : 0)
        || (monthlyLoad[a] / targetLoad[a]) - (monthlyLoad[b] / targetLoad[b])
        || previousLoad[b] - previousLoad[a] || a.localeCompare(b);
      const candidates = people.filter((code) => !row.assigned.includes(code) && !availability[code]?.[month]?.[row.date] && !hasScheduleConflict(assignments, code, row.date)).sort(fairnessSort);
      for (const code of candidates.slice(0, row.required - row.assigned.length)) { row.assigned.push(code); monthlyLoad[code] += 1; }
      if (row.assigned.length < row.required) {
        const unavailable = people.filter((code) => availability[code]?.[month]?.[row.date] && !row.assigned.includes(code) && !hasScheduleConflict(assignments, code, row.date));
        unavailable.sort((a, b) => new Date(submissions[b]?.[month]?.savedAt || 0) - new Date(submissions[a]?.[month]?.savedAt || 0) || fairnessSort(a, b));
        for (const code of unavailable.slice(0, row.required - row.assigned.length)) {
          row.assigned.push(code); monthlyLoad[code] += 1;
          row.overrides.push({ name: code, submittedAt: submissions[code]?.[month]?.savedAt || null, reason: "Latest responder NA override" });
        }
      }
      if (saturday) { lastSaturday.clear(); row.assigned.forEach((code) => lastSaturday.add(code)); }
      if (row.overrides.length) warnings.push(`${row.date}: ${row.overrides.map((item) => item.name).join(", ")} assigned by availability override`);
      if (row.assigned.length < row.required) warnings.push(`${row.date}: short ${row.required - row.assigned.length}`);
    }
    return { assignments, warnings, previousLoad, targetLoad, monthlyLoad };
  }
  function generate({ people, monthDate, availability, submissions, rosters, signaturePeople = [] }) {
    const signatureSet = new Set(signaturePeople);
    const basicPeople = people.filter((code) => !signatureSet.has(code));
    if (!signaturePeople.length) return generateGroup({ people, monthDate, availability, submissions, rosters, requiredForDate: (date) => date.getDay() === 6 ? 4 : 3 });

    const basic = generateGroup({ people: basicPeople, monthDate, availability, submissions, rosters, requiredForDate: (date) => date.getDay() === 6 ? 4 : 3 });
    const signature = generateGroup({ people: signaturePeople, monthDate, availability, submissions, rosters, requiredForDate: () => 1 });
    const signatureByDate = Object.fromEntries(signature.assignments.map((row) => [row.date, row]));
    const assignments = basic.assignments.map((row) => {
      const sig = signatureByDate[row.date] || { assigned: [], overrides: [] };
      const saturday = parse(row.date).getDay() === 6;
      return {
        date: row.date,
        required: row.required + 1,
        requiredBasic: row.required,
        requiredSignature: 1,
        assigned: [...row.assigned, ...sig.assigned],
        overrides: [...row.overrides, ...sig.overrides]
      };
    });
    return {
      assignments,
      warnings: [...basic.warnings, ...signature.warnings],
      previousLoad: { ...basic.previousLoad, ...signature.previousLoad },
      targetLoad: { ...basic.targetLoad, ...signature.targetLoad },
      monthlyLoad: { ...basic.monthlyLoad, ...signature.monthlyLoad }
    };
  }
  root.RosterEngine = { generate, hasScheduleConflict };
})(globalThis);
