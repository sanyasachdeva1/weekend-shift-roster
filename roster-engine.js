(function (root) {
  const keyOf = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const monthOf = (date) => keyOf(date).slice(0, 7);
  const parse = (key) => new Date(`${key}T12:00:00`);
  function weekendDatesForMonth(monthDate) {
    const dates = [];
    const days = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0).getDate();
    for (let day = 1; day <= days; day += 1) {
      const date = new Date(monthDate.getFullYear(), monthDate.getMonth(), day);
      if ([0, 6].includes(date.getDay())) dates.push(keyOf(date));
    }
    return dates;
  }
  const weekendStart = (key) => { const date = parse(key); if (date.getDay() === 0) date.setDate(date.getDate() - 1); return keyOf(date); };
  const dayMs = 86400000;
  function createsSevenDayStretch(existingDate, candidateDate) {
    const existing = parse(existingDate);
    const candidate = parse(candidateDate);
    const diffDays = Math.round((candidate - existing) / dayMs);
    return (existing.getDay() === 0 && candidate.getDay() === 6 && diffDays === 6)
      || (candidate.getDay() === 0 && existing.getDay() === 6 && diffDays === -6);
  }
  function hasConsecutiveSaturday(assignments, code, candidateDate, excludedDate = null) {
    const candidate = parse(candidateDate);
    return candidate.getDay() === 6 && assignments.some((row) =>
      row.date !== excludedDate
      && row.assigned.includes(code)
      && parse(row.date).getDay() === 6
      && Math.abs(candidate - parse(row.date)) === 7 * dayMs
    );
  }
  function hasScheduleConflict(assignments, code, candidateDate, excludedDate = null) {
    return assignments.some((row) => row.date !== excludedDate && row.assigned.includes(code) && (
      weekendStart(row.date) === weekendStart(candidateDate)
      || createsSevenDayStretch(row.date, candidateDate)
    ));
  }
  const cloneAssignments = (assignments) => JSON.parse(JSON.stringify(assignments));
  const isNA = (availability, code, date) => Boolean(availability[code]?.[date.slice(0, 7)]?.[date]);
  const assignmentPositions = (assignments) => assignments.flatMap((row, rowIndex) => row.assigned.map((code, assignedIndex) => ({ rowIndex, assignedIndex, code, date: row.date })));
  function countConsecutiveSaturdays(assignments, people) {
    return people.filter((code) => assignments
      .filter((row) => row.assigned.includes(code) && parse(row.date).getDay() === 6)
      .some((row) => hasConsecutiveSaturday(assignments, code, row.date, row.date))).length;
  }
  function countSameDayTypeSecondShifts(assignments, people) {
    return people.filter((code) => {
      const dayTypes = assignments.filter((row) => row.assigned.includes(code)).map((row) => parse(row.date).getDay());
      return dayTypes.length === 2 && dayTypes[0] === dayTypes[1];
    }).length;
  }
  function hardValid(assignments, people, maxMonthlyLoad) {
    for (const row of assignments) {
      if (new Set(row.assigned).size !== row.assigned.length) return false;
    }
    for (const code of people) {
      const rows = assignments.filter((row) => row.assigned.includes(code));
      if (rows.length > maxMonthlyLoad) return false;
      for (const row of rows) if (hasScheduleConflict(assignments, code, row.date, row.date)) return false;
    }
    return true;
  }
  function countPreviousTwoShiftRepeats(assignments, people, previousLoad) {
    return people.filter((code) => previousLoad[code] >= 2 && assignments.filter((row) => row.assigned.includes(code)).length > 1).length;
  }
  function comfortScore(assignments, people, availability, previousLoad, maxMonthlyLoad) {
    if (!hardValid(assignments, people, maxMonthlyLoad)) return Number.POSITIVE_INFINITY;
    const overrideCount = assignments.reduce((sum, row) => sum + row.assigned.filter((code) => isNA(availability, code, row.date)).length, 0);
    return overrideCount * 1000000
      + countPreviousTwoShiftRepeats(assignments, people, previousLoad) * 10000
      + countConsecutiveSaturdays(assignments, people) * 1000
      + countSameDayTypeSecondShifts(assignments, people);
  }
  function refreshOverrides(assignments, availability, submissions, month) {
    const warnings = [];
    for (const row of assignments) {
      row.overrides = row.assigned
        .filter((code) => isNA(availability, code, row.date))
        .map((code) => ({ name: code, submittedAt: submissions[code]?.[month]?.savedAt || null, reason: "Comfort optimized NA override" }))
        .sort((a, b) => new Date(b.submittedAt || 0) - new Date(a.submittedAt || 0) || a.name.localeCompare(b.name));
      if (row.overrides.length) warnings.push(`${row.date}: ${row.overrides.map((item) => item.name).join(", ")} assigned by availability override`);
      if (row.assigned.length < row.required) warnings.push(`${row.date}: short ${row.required - row.assigned.length}`);
    }
    return warnings;
  }
  function optimizeComfort({ assignments, people, availability, submissions, month, previousLoad, maxMonthlyLoad = 2, beamWidth = 80, maxDepth = 8 }) {
    const start = cloneAssignments(assignments);
    let best = start, bestScore = comfortScore(start, people, availability, previousLoad, maxMonthlyLoad);
    let frontier = [{ assignments: start, score: bestScore, key: JSON.stringify(start.map((row) => row.assigned)) }];
    const seen = new Set(frontier.map((item) => item.key));
    for (let depth = 0; depth < maxDepth; depth += 1) {
      const next = [];
      for (const item of frontier) {
        const positions = assignmentPositions(item.assignments);
        for (let i = 0; i < positions.length; i += 1) {
          for (let j = i + 1; j < positions.length; j += 1) {
            const a = positions[i], b = positions[j];
            if (a.rowIndex === b.rowIndex) continue;
            const candidate = cloneAssignments(item.assignments);
            candidate[a.rowIndex].assigned[a.assignedIndex] = b.code;
            candidate[b.rowIndex].assigned[b.assignedIndex] = a.code;
            const key = JSON.stringify(candidate.map((row) => row.assigned));
            if (seen.has(key)) continue;
            seen.add(key);
            const score = comfortScore(candidate, people, availability, previousLoad, maxMonthlyLoad);
            if (!Number.isFinite(score)) continue;
            next.push({ assignments: candidate, score, key });
            if (score < bestScore) { best = candidate; bestScore = score; }
          }
        }
      }
      if (!next.length) break;
      frontier = next.sort((a, b) => a.score - b.score || a.key.localeCompare(b.key)).slice(0, beamWidth);
    }
    const optimized = cloneAssignments(best);
    const warnings = refreshOverrides(optimized, availability, submissions, month);
    return { assignments: optimized, warnings };
  }

  function generateGroup({ people, monthDate, availability, submissions, rosters, requiredForDate, maxMonthlyLoad = 2 }) {
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
    const canReceiveMore = (code) => monthlyLoad[code] < maxMonthlyLoad;
    const isBelowTarget = (code) => monthlyLoad[code] < targetLoad[code];
    const assignedDayTypes = (code) => new Set(assignments
      .filter((row) => row.assigned.includes(code))
      .map((row) => parse(row.date).getDay()));
    const sameDayTypePenalty = (code, dateKey) => {
      if (monthlyLoad[code] !== 1) return 0;
      const dayTypes = assignedDayTypes(code);
      return dayTypes.has(parse(dateKey).getDay()) ? 1 : 0;
    };

    // Phase 1: reserve one shift for every team member before any second shifts.
    // People with fewer available dates are placed first so flexible people retain options.
    const coverageOrder = people.slice().sort((a, b) => {
      const availableCount = (code) => assignments.filter((row) => !availability[code]?.[month]?.[row.date]).length;
      return availableCount(a) - availableCount(b)
        || new Date(submissions[b]?.[month]?.savedAt || 0) - new Date(submissions[a]?.[month]?.savedAt || 0)
        || a.localeCompare(b);
    });
    for (const code of coverageOrder) {
      let choices = assignments.filter((row) => canReceiveMore(code) && row.assigned.length < row.required && !availability[code]?.[month]?.[row.date] && !hasScheduleConflict(assignments, code, row.date));
      let overridden = false;
      if (!choices.length) { choices = assignments.filter((row) => canReceiveMore(code) && row.assigned.length < row.required && !hasScheduleConflict(assignments, code, row.date)); overridden = true; }
      choices.sort((a, b) => sameDayTypePenalty(code, a.date) - sameDayTypePenalty(code, b.date)
        || (hasConsecutiveSaturday(assignments, code, a.date) ? 1 : 0) - (hasConsecutiveSaturday(assignments, code, b.date) ? 1 : 0)
        || (a.assigned.length / a.required) - (b.assigned.length / b.required) || a.date.localeCompare(b.date));
      const row = choices[0];
      if (!row) { warnings.push(`${code}: no monthly coverage slot available`); continue; }
      row.assigned.push(code); monthlyLoad[code] += 1;
      if (overridden) row.overrides.push({ name: code, submittedAt: submissions[code]?.[month]?.savedAt || null, reason: "Minimum monthly coverage override" });
    }

    // Phase 2: fill remaining daily requirements while respecting NA and 1/2 targets.
    const lastSaturday = new Set();
    for (const row of assignments) {
      const date = new Date(`${row.date}T12:00:00`), saturday = date.getDay() === 6;
      const fairnessSort = (a, b) => sameDayTypePenalty(a, row.date) - sameDayTypePenalty(b, row.date)
        || (hasConsecutiveSaturday(assignments, a, row.date) ? 1 : 0) - (hasConsecutiveSaturday(assignments, b, row.date) ? 1 : 0)
        || (saturday && lastSaturday.has(a) ? 1 : 0) - (saturday && lastSaturday.has(b) ? 1 : 0)
        || (monthlyLoad[a] >= targetLoad[a] ? 1 : 0) - (monthlyLoad[b] >= targetLoad[b] ? 1 : 0)
        || (monthlyLoad[a] / targetLoad[a]) - (monthlyLoad[b] / targetLoad[b])
        || previousLoad[b] - previousLoad[a] || a.localeCompare(b);
      const addCandidates = (candidates) => {
        for (const code of candidates) {
          if (row.assigned.length >= row.required) break;
          if (row.assigned.includes(code)) continue;
          row.assigned.push(code); monthlyLoad[code] += 1;
        }
      };
      const candidates = people.filter((code) => canReceiveMore(code) && !row.assigned.includes(code) && !availability[code]?.[month]?.[row.date] && !hasScheduleConflict(assignments, code, row.date)).sort(fairnessSort);
      addCandidates(candidates.filter(isBelowTarget));
      addCandidates(candidates.filter((code) => !isBelowTarget(code)));
      if (row.assigned.length < row.required) {
        const unavailable = people.filter((code) => canReceiveMore(code) && availability[code]?.[month]?.[row.date] && !row.assigned.includes(code) && !hasScheduleConflict(assignments, code, row.date));
        unavailable.sort((a, b) => (isBelowTarget(a) ? 0 : 1) - (isBelowTarget(b) ? 0 : 1)
          || new Date(submissions[b]?.[month]?.savedAt || 0) - new Date(submissions[a]?.[month]?.savedAt || 0) || fairnessSort(a, b));
        for (const code of unavailable) {
          if (row.assigned.length >= row.required) break;
          row.assigned.push(code); monthlyLoad[code] += 1;
          row.overrides.push({ name: code, submittedAt: submissions[code]?.[month]?.savedAt || null, reason: "Latest responder NA override" });
        }
      }
      if (saturday) { lastSaturday.clear(); row.assigned.forEach((code) => lastSaturday.add(code)); }
      if (row.overrides.length) warnings.push(`${row.date}: ${row.overrides.map((item) => item.name).join(", ")} assigned by availability override`);
      if (row.assigned.length < row.required) warnings.push(`${row.date}: short ${row.required - row.assigned.length}`);
    }
    const optimized = optimizeComfort({ assignments, people, availability, submissions, month, previousLoad, maxMonthlyLoad });
    return { assignments: optimized.assignments, warnings: optimized.warnings, previousLoad, targetLoad, monthlyLoad };
  }
  function generate({ people, monthDate, availability, submissions, rosters, signaturePeople = [] }) {
    const signatureSet = new Set(signaturePeople);
    const basicPeople = people.filter((code) => !signatureSet.has(code));
    if (!signaturePeople.length) return generateGroup({ people, monthDate, availability, submissions, rosters, requiredForDate: (date) => date.getDay() === 6 ? 4 : 3, maxMonthlyLoad: 2 });

    const signatureShiftCount = weekendDatesForMonth(monthDate).length;
    const signatureMaxMonthlyLoad = Math.max(2, Math.ceil(signatureShiftCount / Math.max(signaturePeople.length, 1)));
    const basic = generateGroup({ people: basicPeople, monthDate, availability, submissions, rosters, requiredForDate: (date) => date.getDay() === 6 ? 4 : 3, maxMonthlyLoad: 2 });
    const signature = generateGroup({ people: signaturePeople, monthDate, availability, submissions, rosters, requiredForDate: () => 1, maxMonthlyLoad: signatureMaxMonthlyLoad });
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
  root.RosterEngine = { generate, hasScheduleConflict, hasConsecutiveSaturday };
})(globalThis);
