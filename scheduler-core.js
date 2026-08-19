(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.SchedulerCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const DEFAULT_DAYS = [
    { id: "월", label: "월요일", periods: 6 },
    { id: "화", label: "화요일", periods: 7 },
    { id: "수", label: "수요일", periods: 6 },
    { id: "목", label: "목요일", periods: 7 },
    { id: "금", label: "금요일", periods: 6 },
  ];

  const DEFAULT_SETTINGS = {
    attempts: 12,
    reuseExisting: true,
    weights: {
      compactDays: 14,
      gaps: 9,
      preferredSlot: 18,
      avoidedSlot: 28,
      consecutive: 18,
      repeatedSubject: 13,
      loadBalance: 3,
      change: 5,
    },
  };

  function uid(prefix) {
    return `${prefix || "id"}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function slotKey(day, period) {
    return `${day}-${Number(period)}`;
  }

  function dayIndex(project, day) {
    return project.days.findIndex((item) => item.id === day);
  }

  function slotOrdinal(project, day, period) {
    let result = 0;
    for (const item of project.days) {
      if (item.id === day) return result + Number(period);
      result += Number(item.periods);
    }
    return Number.MAX_SAFE_INTEGER;
  }

  function allSlots(project) {
    const slots = [];
    for (const day of project.days) {
      for (let period = 1; period <= day.periods; period += 1) {
        slots.push({ day: day.id, period, key: slotKey(day.id, period) });
      }
    }
    return slots;
  }

  function normalizeProject(input) {
    const project = clone(input || {});
    project.version = project.version || 1;
    project.name = project.name || "새 시간표 프로젝트";
    project.days = Array.isArray(project.days) && project.days.length ? project.days : clone(DEFAULT_DAYS);
    project.settings = Object.assign({}, clone(DEFAULT_SETTINGS), project.settings || {});
    project.settings.weights = Object.assign({}, clone(DEFAULT_SETTINGS.weights), project.settings.weights || {});
    project.teachers = Array.isArray(project.teachers) ? project.teachers : [];
    project.classes = Array.isArray(project.classes) ? project.classes : [];
    project.requirements = Array.isArray(project.requirements) ? project.requirements : [];
    project.schedule = Array.isArray(project.schedule) ? project.schedule : [];
    project.rooms = Array.isArray(project.rooms) ? project.rooms : [];
    project.sourceNotes = Array.isArray(project.sourceNotes) ? project.sourceNotes : [];

    const dayIds = project.days.map((day) => day.id);
    project.teachers = project.teachers.map((teacher, index) => ({
      id: teacher.id || `teacher-${index + 1}`,
      name: teacher.name || `교사 ${index + 1}`,
      kind: teacher.kind || "교사",
      subjects: Array.isArray(teacher.subjects) ? teacher.subjects : [],
      targetHours: Number(teacher.targetHours || 0),
      maxDaily: Number(teacher.maxDaily || 6),
      maxConsecutive: Number(teacher.maxConsecutive || 3),
      preferredWorkDays: Number(teacher.preferredWorkDays || dayIds.length),
      allowedDays: Array.isArray(teacher.allowedDays) && teacher.allowedDays.length ? teacher.allowedDays : dayIds.slice(),
      slotStates: teacher.slotStates || {},
      preferConsecutive: Boolean(teacher.preferConsecutive),
      notes: teacher.notes || "",
    }));

    project.classes = project.classes.map((item, index) => ({
      id: item.id || `class-${index + 1}`,
      name: item.name || `학급 ${index + 1}`,
      grade: Number(item.grade || 0),
      homeroom: item.homeroom || "",
    }));

    project.requirements = project.requirements.map((item, index) => ({
      id: item.id || `req-${index + 1}`,
      classId: item.classId || "",
      subject: item.subject || "과목",
      teacherId: item.teacherId || "",
      hours: Math.max(0, Number(item.hours || 0)),
      blockSize: Math.max(1, Number(item.blockSize || 1)),
      room: item.room || "",
      preferredDays: Array.isArray(item.preferredDays) ? item.preferredDays : [],
      forbiddenSlots: Array.isArray(item.forbiddenSlots) ? item.forbiddenSlots : [],
      notes: item.notes || "",
    }));

    project.schedule = project.schedule.map((item, index) => ({
      id: item.id || `lesson-${index + 1}`,
      requirementId: item.requirementId || "",
      classId: item.classId || "",
      teacherId: item.teacherId || "",
      subject: item.subject || "",
      day: item.day || "",
      period: Number(item.period || 0),
      room: item.room || "",
      blockId: item.blockId || "",
      locked: Boolean(item.locked),
      type: item.type || "regular",
    }));
    return project;
  }

  function newProject() {
    return normalizeProject({
      version: 1,
      name: "새 시간표 프로젝트",
      days: clone(DEFAULT_DAYS),
      settings: clone(DEFAULT_SETTINGS),
      teachers: [],
      classes: [],
      requirements: [],
      schedule: [],
      rooms: [],
      sourceNotes: [],
    });
  }

  function makeLookup(project) {
    return {
      teachers: new Map(project.teachers.map((item) => [item.id, item])),
      classes: new Map(project.classes.map((item) => [item.id, item])),
      requirements: new Map(project.requirements.map((item) => [item.id, item])),
      days: new Map(project.days.map((item) => [item.id, item])),
    };
  }

  function issue(level, code, message, assignment, extra) {
    return Object.assign({
      id: uid("issue"),
      level,
      code,
      message,
      assignmentId: assignment ? assignment.id : "",
      day: assignment ? assignment.day : "",
      period: assignment ? assignment.period : 0,
    }, extra || {});
  }

  function consecutiveMax(periods) {
    const sorted = [...new Set(periods.map(Number))].sort((a, b) => a - b);
    let max = 0;
    let run = 0;
    let previous = -100;
    for (const period of sorted) {
      run = period === previous + 1 ? run + 1 : 1;
      previous = period;
      max = Math.max(max, run);
    }
    return max;
  }

  function internalGaps(periods) {
    const sorted = [...new Set(periods.map(Number))].sort((a, b) => a - b);
    if (sorted.length < 2) return 0;
    return Math.max(0, sorted[sorted.length - 1] - sorted[0] + 1 - sorted.length);
  }

  function validateProject(input) {
    const project = normalizeProject(input);
    const lookup = makeLookup(project);
    const errors = [];
    const warnings = [];
    const infos = [];
    const classSlots = new Map();
    const teacherSlots = new Map();
    const roomSlots = new Map();
    const teacherDays = new Map();
    const requirementUsage = new Map();

    function pushSlot(map, key, assignment) {
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(assignment);
    }

    for (const assignment of project.schedule) {
      const day = lookup.days.get(assignment.day);
      if (!day || assignment.period < 1 || assignment.period > day.periods) {
        errors.push(issue("error", "INVALID_SLOT", `${assignment.day || "?"} ${assignment.period || "?"}교시는 운영 시간 밖입니다.`, assignment));
        continue;
      }
      if (!lookup.classes.has(assignment.classId)) {
        errors.push(issue("error", "UNKNOWN_CLASS", "등록되지 않은 학급이 배정되어 있습니다.", assignment));
      }
      if (assignment.teacherId && !lookup.teachers.has(assignment.teacherId)) {
        errors.push(issue("error", "UNKNOWN_TEACHER", "등록되지 않은 교사가 배정되어 있습니다.", assignment));
      }

      const key = slotKey(assignment.day, assignment.period);
      pushSlot(classSlots, `${assignment.classId}|${key}`, assignment);
      if (assignment.teacherId) pushSlot(teacherSlots, `${assignment.teacherId}|${key}`, assignment);
      if (assignment.room) pushSlot(roomSlots, `${assignment.room}|${key}`, assignment);

      if (assignment.requirementId) {
        requirementUsage.set(assignment.requirementId, (requirementUsage.get(assignment.requirementId) || 0) + 1);
      }

      const teacher = lookup.teachers.get(assignment.teacherId);
      if (teacher) {
        if (!teacher.allowedDays.includes(assignment.day)) {
          errors.push(issue("error", "FORBIDDEN_DAY", `${teacher.name} 교사는 ${assignment.day}요일 수업이 불가합니다.`, assignment, { teacherId: teacher.id }));
        }
        const state = teacher.slotStates[key] || "available";
        if (state === "unavailable") {
          errors.push(issue("error", "UNAVAILABLE_SLOT", `${teacher.name} 교사의 수업 불가 시간입니다.`, assignment, { teacherId: teacher.id }));
        } else if (state === "avoid") {
          warnings.push(issue("warning", "AVOIDED_SLOT", `${teacher.name} 교사의 기피 시간에 배정되었습니다.`, assignment, { teacherId: teacher.id }));
        }
        const dayKey = `${teacher.id}|${assignment.day}`;
        if (!teacherDays.has(dayKey)) teacherDays.set(dayKey, []);
        teacherDays.get(dayKey).push(assignment.period);
      }
    }

    for (const [key, items] of classSlots.entries()) {
      if (items.length > 1) {
        const classId = key.split("|")[0];
        const className = lookup.classes.get(classId)?.name || classId;
        errors.push(issue("error", "CLASS_CONFLICT", `${className} 학급에 같은 시간 수업이 ${items.length}개 있습니다.`, items[0], { relatedIds: items.map((item) => item.id), classId }));
      }
    }
    for (const [key, items] of teacherSlots.entries()) {
      if (items.length > 1) {
        const teacherId = key.split("|")[0];
        const teacherName = lookup.teachers.get(teacherId)?.name || teacherId;
        errors.push(issue("error", "TEACHER_CONFLICT", `${teacherName} 교사가 같은 시간에 ${items.length}개 학급에 배정되었습니다.`, items[0], { relatedIds: items.map((item) => item.id), teacherId }));
      }
    }
    for (const [key, items] of roomSlots.entries()) {
      if (items.length > 1) {
        const room = key.split("|")[0];
        errors.push(issue("error", "ROOM_CONFLICT", `${room} 특별실이 같은 시간에 중복 사용됩니다.`, items[0], { relatedIds: items.map((item) => item.id), room }));
      }
    }

    for (const requirement of project.requirements) {
      const used = requirementUsage.get(requirement.id) || 0;
      if (used < requirement.hours) {
        errors.push(issue("error", "MISSING_HOURS", `${lookup.classes.get(requirement.classId)?.name || requirement.classId} ${requirement.subject} ${requirement.hours - used}시간이 미배정입니다.`, null, { requirementId: requirement.id, missing: requirement.hours - used }));
      } else if (used > requirement.hours) {
        errors.push(issue("error", "EXTRA_HOURS", `${lookup.classes.get(requirement.classId)?.name || requirement.classId} ${requirement.subject}이 ${used - requirement.hours}시간 초과 배정되었습니다.`, null, { requirementId: requirement.id, extra: used - requirement.hours }));
      }

      if (requirement.blockSize > 1) {
        const grouped = new Map();
        const related = project.schedule.filter((item) => item.requirementId === requirement.id);
        for (const assignment of related) {
          if (assignment.blockId) {
            if (!grouped.has(assignment.blockId)) grouped.set(assignment.blockId, []);
            grouped.get(assignment.blockId).push(assignment);
          }
        }
        for (const block of grouped.values()) {
          const periods = block.map((item) => item.period).sort((a, b) => a - b);
          const sameDay = block.every((item) => item.day === block[0].day);
          if (block.length > 1 && (!sameDay || consecutiveMax(periods) !== block.length)) {
            errors.push(issue("error", "BROKEN_BLOCK", `${requirement.subject} 연강 묶음이 연속 교시가 아닙니다.`, block[0], { relatedIds: block.map((item) => item.id), requirementId: requirement.id }));
          }
        }
      }
    }

    for (const teacher of project.teachers) {
      const activeDays = [];
      let total = 0;
      for (const day of project.days) {
        const periods = teacherDays.get(`${teacher.id}|${day.id}`) || [];
        if (!periods.length) continue;
        activeDays.push(day.id);
        total += periods.length;
        if (periods.length > teacher.maxDaily) {
          errors.push(issue("error", "MAX_DAILY", `${teacher.name} 교사의 ${day.label} 수업이 일일 한도 ${teacher.maxDaily}시간을 넘습니다.`, null, { teacherId: teacher.id, day: day.id, actual: periods.length }));
        }
        const run = consecutiveMax(periods);
        if (run > teacher.maxConsecutive) {
          errors.push(issue("error", "MAX_CONSECUTIVE", `${teacher.name} 교사의 ${day.label} 연속수업이 한도 ${teacher.maxConsecutive}시간을 넘습니다.`, null, { teacherId: teacher.id, day: day.id, actual: run }));
        }
        const gaps = internalGaps(periods);
        if (gaps > 0 && (teacher.kind === "강사" || teacher.preferConsecutive)) {
          warnings.push(issue("warning", "TEACHER_GAPS", `${teacher.name} 교사의 ${day.label} 수업 사이에 공강 ${gaps}시간이 있습니다.`, null, { teacherId: teacher.id, day: day.id, actual: gaps }));
        }
      }
      if (teacher.preferredWorkDays > 0 && activeDays.length > teacher.preferredWorkDays) {
        warnings.push(issue("warning", "WORKDAY_SPREAD", `${teacher.name} 교사의 수업이 ${activeDays.length}일에 분산되었습니다(희망 ${teacher.preferredWorkDays}일).`, null, { teacherId: teacher.id, actual: activeDays.length }));
      }
      if (teacher.targetHours > 0 && total !== teacher.targetHours) {
        infos.push(issue("info", "TEACHER_HOURS", `${teacher.name} 교사는 목표 ${teacher.targetHours}시간 중 ${total}시간이 배정되었습니다.`, null, { teacherId: teacher.id, actual: total }));
      }
    }

    const byClassSubjectDay = new Map();
    for (const assignment of project.schedule) {
      if (assignment.type === "special") continue;
      const key = `${assignment.classId}|${assignment.subject}|${assignment.day}`;
      if (!byClassSubjectDay.has(key)) byClassSubjectDay.set(key, []);
      byClassSubjectDay.get(key).push(assignment);
    }
    for (const items of byClassSubjectDay.values()) {
      if (items.length > 1) {
        const requirement = lookup.requirements.get(items[0].requirementId);
        const intentional = requirement && requirement.blockSize > 1 && items.some((item) => item.blockId);
        if (!intentional) {
          const className = lookup.classes.get(items[0].classId)?.name || items[0].classId;
          warnings.push(issue("warning", "REPEATED_SUBJECT", `${className} ${items[0].subject} 수업이 ${items[0].day}요일에 ${items.length}회 배정되었습니다.`, items[0], { relatedIds: items.map((item) => item.id) }));
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      infos,
      all: [...errors, ...warnings, ...infos],
      summary: {
        errors: errors.length,
        warnings: warnings.length,
        infos: infos.length,
        assigned: project.schedule.filter((item) => item.type !== "special").length,
        required: project.requirements.reduce((sum, item) => sum + item.hours, 0),
      },
    };
  }

  function occupancyState(project, base) {
    const state = {
      schedule: [],
      classSlots: new Map(),
      teacherSlots: new Map(),
      roomSlots: new Map(),
      teacherDays: new Map(),
      classDays: new Map(),
      classSubjectDays: new Map(),
    };

    function add(item) {
      const lesson = Object.assign({}, item);
      state.schedule.push(lesson);
      const key = slotKey(lesson.day, lesson.period);
      state.classSlots.set(`${lesson.classId}|${key}`, lesson);
      if (lesson.teacherId) state.teacherSlots.set(`${lesson.teacherId}|${key}`, lesson);
      if (lesson.room) state.roomSlots.set(`${lesson.room}|${key}`, lesson);
      const td = `${lesson.teacherId}|${lesson.day}`;
      if (lesson.teacherId) {
        if (!state.teacherDays.has(td)) state.teacherDays.set(td, []);
        state.teacherDays.get(td).push(lesson.period);
      }
      const cd = `${lesson.classId}|${lesson.day}`;
      if (!state.classDays.has(cd)) state.classDays.set(cd, []);
      state.classDays.get(cd).push(lesson.period);
      const csd = `${lesson.classId}|${lesson.subject}|${lesson.day}`;
      state.classSubjectDays.set(csd, (state.classSubjectDays.get(csd) || 0) + 1);
    }

    function remove(item) {
      const index = state.schedule.findIndex((lesson) => lesson.id === item.id);
      if (index >= 0) state.schedule.splice(index, 1);
      rebuild();
    }

    function rebuild() {
      const items = state.schedule.slice();
      state.schedule.length = 0;
      state.classSlots.clear();
      state.teacherSlots.clear();
      state.roomSlots.clear();
      state.teacherDays.clear();
      state.classDays.clear();
      state.classSubjectDays.clear();
      for (const item of items) add(item);
    }

    function restore(items) {
      state.schedule = items.map((item) => Object.assign({}, item));
      rebuild();
    }

    state.add = add;
    state.remove = remove;
    state.restore = restore;
    for (const item of base || []) add(item);
    return state;
  }

  function canPlace(project, lookup, state, task, day, startPeriod) {
    const dayInfo = lookup.days.get(day);
    const teacher = lookup.teachers.get(task.teacherId);
    if (!dayInfo || startPeriod < 1 || startPeriod + task.size - 1 > dayInfo.periods) return false;
    if (teacher && !teacher.allowedDays.includes(day)) return false;
    const existingTeacherPeriods = teacher ? (state.teacherDays.get(`${teacher.id}|${day}`) || []) : [];
    const prospective = existingTeacherPeriods.slice();

    for (let offset = 0; offset < task.size; offset += 1) {
      const period = startPeriod + offset;
      const key = slotKey(day, period);
      if (state.classSlots.has(`${task.classId}|${key}`)) return false;
      if (task.teacherId && state.teacherSlots.has(`${task.teacherId}|${key}`)) return false;
      if (task.room && state.roomSlots.has(`${task.room}|${key}`)) return false;
      if (teacher) {
        const slotState = teacher.slotStates[key] || "available";
        if (slotState === "unavailable") return false;
        prospective.push(period);
      }
      if (task.forbiddenSlots.includes(key)) return false;
    }
    if (teacher) {
      if (prospective.length > teacher.maxDaily) return false;
      if (consecutiveMax(prospective) > teacher.maxConsecutive) return false;
    }
    return true;
  }

  function placementScore(project, lookup, state, task, day, startPeriod, random) {
    const weights = project.settings.weights;
    const teacher = lookup.teachers.get(task.teacherId);
    let score = random() * 3;
    const classPeriods = state.classDays.get(`${task.classId}|${day}`) || [];
    score += classPeriods.length * weights.loadBalance;
    if (task.preferredDays.length && !task.preferredDays.includes(day)) score += weights.avoidedSlot / 2;

    const sameSubject = state.classSubjectDays.get(`${task.classId}|${task.subject}|${day}`) || 0;
    if (sameSubject > 0 && task.size === 1) score += sameSubject * weights.repeatedSubject;

    if (teacher) {
      const before = state.teacherDays.get(`${teacher.id}|${day}`) || [];
      if (!before.length && teacher.preferredWorkDays < project.days.length) score += weights.compactDays;
      const after = before.slice();
      let adjacent = false;
      for (let offset = 0; offset < task.size; offset += 1) {
        const period = startPeriod + offset;
        const slotState = teacher.slotStates[slotKey(day, period)] || "available";
        if (slotState === "prefer") score -= weights.preferredSlot;
        if (slotState === "avoid") score += weights.avoidedSlot;
        if (before.includes(period - 1) || before.includes(period + 1)) adjacent = true;
        after.push(period);
      }
      score += (internalGaps(after) - internalGaps(before)) * weights.gaps;
      if (teacher.preferConsecutive || teacher.kind === "강사") {
        score += adjacent ? -weights.consecutive : weights.consecutive * 0.5;
      }
    }
    score += startPeriod * 0.12;
    return score;
  }

  function seededRandom(seed) {
    let value = (Number(seed) || Date.now()) % 2147483647;
    if (value <= 0) value += 2147483646;
    return function () {
      value = value * 16807 % 2147483647;
      return (value - 1) / 2147483646;
    };
  }

  function makeTasks(project, usedByRequirement) {
    const tasks = [];
    for (const requirement of project.requirements) {
      let remaining = Math.max(0, requirement.hours - (usedByRequirement.get(requirement.id) || 0));
      let sequence = 1;
      while (remaining > 0) {
        const size = Math.min(requirement.blockSize, remaining);
        tasks.push({
          id: `${requirement.id}-task-${sequence}`,
          requirementId: requirement.id,
          classId: requirement.classId,
          teacherId: requirement.teacherId,
          subject: requirement.subject,
          room: requirement.room,
          size,
          preferredDays: requirement.preferredDays,
          forbiddenSlots: requirement.forbiddenSlots,
        });
        remaining -= size;
        sequence += 1;
      }
    }
    return tasks;
  }

  function scheduleTask(project, lookup, state, task, random) {
    const candidates = [];
    for (const day of project.days) {
      for (let period = 1; period <= day.periods; period += 1) {
        if (!canPlace(project, lookup, state, task, day.id, period)) continue;
        candidates.push({
          day: day.id,
          period,
          score: placementScore(project, lookup, state, task, day.id, period, random),
        });
      }
    }
    if (!candidates.length) return false;
    candidates.sort((a, b) => a.score - b.score);
    const pickRange = Math.min(3, candidates.length);
    const candidate = candidates[Math.floor(random() * pickRange)];
    const blockId = task.size > 1 ? uid("block") : "";
    for (let offset = 0; offset < task.size; offset += 1) {
      state.add({
        id: uid("lesson"),
        requirementId: task.requirementId,
        classId: task.classId,
        teacherId: task.teacherId,
        subject: task.subject,
        day: candidate.day,
        period: candidate.period + offset,
        room: task.room,
        blockId,
        locked: false,
        type: "regular",
      });
    }
    return true;
  }

  function seedExisting(project, lookup, state, used, options) {
    const rejected = [];
    const candidates = project.schedule
      .filter((item) => !item.locked && item.type !== "special")
      .sort((a, b) => slotOrdinal(project, a.day, a.period) - slotOrdinal(project, b.day, b.period));
    if (!options.reuseExisting) return rejected.concat(candidates);

    for (const item of candidates) {
      const requirement = lookup.requirements.get(item.requirementId);
      const already = used.get(item.requirementId) || 0;
      if (!requirement || already >= requirement.hours) {
        rejected.push(item);
        continue;
      }
      const task = {
        classId: item.classId,
        teacherId: item.teacherId,
        subject: item.subject,
        room: item.room,
        size: 1,
        preferredDays: requirement.preferredDays || [],
        forbiddenSlots: requirement.forbiddenSlots || [],
      };
      if (canPlace(project, lookup, state, task, item.day, item.period)) {
        state.add(item);
        used.set(item.requirementId, already + 1);
      } else {
        rejected.push(item);
      }
    }
    return rejected;
  }

  function repairRejectedBySwap(project, lookup, state, used, rejected, random) {
    const unresolved = [];
    let searchBudget = 40000;

    function taskFor(item) {
      const requirement = lookup.requirements.get(item.requirementId);
      if (!requirement) return null;
      return {
        classId: item.classId,
        teacherId: item.teacherId,
        subject: item.subject,
        room: item.room,
        size: 1,
        preferredDays: requirement.preferredDays || [],
        forbiddenSlots: requirement.forbiddenSlots || [],
      };
    }

    function blockersAt(item, day, period) {
      const key = slotKey(day, period);
      const blockers = [
        state.classSlots.get(`${item.classId}|${key}`),
        item.teacherId ? state.teacherSlots.get(`${item.teacherId}|${key}`) : null,
        item.room ? state.roomSlots.get(`${item.room}|${key}`) : null,
      ].filter(Boolean);
      return [...new Map(blockers.map((blocker) => [blocker.id, blocker])).values()];
    }

    function placeWithChain(item, depth, stack) {
      searchBudget -= 1;
      if (searchBudget < 0 || depth < 0) return false;
      const task = taskFor(item);
      if (!task || item.blockId) return false;
      const candidates = allSlots(project).map((slot) => {
        const blockers = blockersAt(item, slot.day, slot.period);
        return {
          day: slot.day,
          period: slot.period,
          blockers,
          rank: blockers.length * 60 + placementScore(project, lookup, state, task, slot.day, slot.period, random),
        };
      }).sort((a, b) => a.rank - b.rank);

      for (const candidate of candidates) {
        if (candidate.blockers.some((blocker) => blocker.locked || blocker.type === "special" || blocker.blockId || stack.has(blocker.id))) continue;
        const snapshot = state.schedule.map((lesson) => Object.assign({}, lesson));
        for (const blocker of candidate.blockers) state.remove(blocker);
        if (canPlace(project, lookup, state, task, candidate.day, candidate.period)) {
          state.add(Object.assign({}, item, { day: candidate.day, period: candidate.period }));
          let resolved = true;
          const nextStack = new Set(stack);
          nextStack.add(item.id);
          for (const blocker of candidate.blockers) {
            if (!placeWithChain(blocker, depth - 1, nextStack)) {
              resolved = false;
              break;
            }
          }
          if (resolved) return true;
        }
        state.restore(snapshot);
      }
      return false;
    }

    for (const original of rejected) {
      const requirement = lookup.requirements.get(original.requirementId);
      if (!requirement || original.blockId) {
        unresolved.push(original);
        continue;
      }
      const originalTask = {
        classId: original.classId,
        teacherId: original.teacherId,
        subject: original.subject,
        room: original.room,
        size: 1,
        preferredDays: requirement.preferredDays || [],
        forbiddenSlots: requirement.forbiddenSlots || [],
      };
      const candidates = state.schedule
        .filter((item) => item.classId === original.classId && !item.locked && item.type !== "special" && !item.blockId)
        .map((item) => ({ item, rank: random() }))
        .sort((a, b) => a.rank - b.rank)
        .map((entry) => entry.item);
      let repaired = false;

      for (const target of candidates) {
        const targetRequirement = lookup.requirements.get(target.requirementId);
        if (!targetRequirement) continue;
        const targetTask = {
          classId: target.classId,
          teacherId: target.teacherId,
          subject: target.subject,
          room: target.room,
          size: 1,
          preferredDays: targetRequirement.preferredDays || [],
          forbiddenSlots: targetRequirement.forbiddenSlots || [],
        };
        state.remove(target);
        const originalFits = canPlace(project, lookup, state, originalTask, target.day, target.period);
        if (!originalFits) {
          state.add(target);
          continue;
        }
        const movedOriginal = Object.assign({}, original, { day: target.day, period: target.period });
        state.add(movedOriginal);
        const targetFits = canPlace(project, lookup, state, targetTask, original.day, original.period);
        if (targetFits) {
          state.add(Object.assign({}, target, { day: original.day, period: original.period }));
          used.set(original.requirementId, (used.get(original.requirementId) || 0) + 1);
          repaired = true;
          break;
        }
        state.remove(movedOriginal);
        state.add(target);
      }
      if (!repaired) {
        repaired = placeWithChain(original, 7, new Set());
        if (repaired) used.set(original.requirementId, (used.get(original.requirementId) || 0) + 1);
      }
      if (!repaired) unresolved.push(original);
    }
    return unresolved;
  }

  function generatedScore(validation, unscheduled, changed) {
    return unscheduled.length * 100000 + validation.errors.length * 20000 + validation.warnings.length * 200 + changed * 4;
  }

  function generateSchedule(input, rawOptions) {
    const project = normalizeProject(input);
    const lookup = makeLookup(project);
    const options = Object.assign({
      attempts: project.settings.attempts,
      reuseExisting: project.settings.reuseExisting,
      seed: Date.now(),
    }, rawOptions || {});
    const fixed = project.schedule.filter((item) => item.locked || item.type === "special");
    let best = null;

    for (let attempt = 0; attempt < Math.max(1, options.attempts); attempt += 1) {
      const random = seededRandom(options.seed + attempt * 7919);
      const state = occupancyState(project, fixed);
      const used = new Map();
      for (const item of fixed) {
        if (item.requirementId) used.set(item.requirementId, (used.get(item.requirementId) || 0) + 1);
      }
      const originalPositions = new Map(project.schedule.map((item) => [item.id, `${item.day}|${item.period}`]));
      const rejected = seedExisting(project, lookup, state, used, options);
      if (options.reuseExisting && rejected.length) repairRejectedBySwap(project, lookup, state, used, rejected, random);
      const tasks = makeTasks(project, used);

      const difficulty = (task) => {
        const teacher = lookup.teachers.get(task.teacherId);
        const availableDays = teacher ? teacher.allowedDays.length : project.days.length;
        const unavailable = teacher ? Object.values(teacher.slotStates).filter((value) => value === "unavailable").length : 0;
        return task.size * 1000 + unavailable * 8 - availableDays * 12 + random();
      };
      tasks.sort((a, b) => difficulty(b) - difficulty(a));

      const unscheduled = [];
      for (const task of tasks) {
        if (!scheduleTask(project, lookup, state, task, random)) unscheduled.push(task);
      }

      const candidate = normalizeProject(Object.assign({}, project, { schedule: state.schedule }));
      const validation = validateProject(candidate);
      const changed = state.schedule.filter((item) => item.type !== "special" && originalPositions.get(item.id) !== `${item.day}|${item.period}`).length;
      const score = generatedScore(validation, unscheduled, changed);
      if (!best || score < best.score) {
        best = { project: candidate, validation, unscheduled, changed, score, attempt: attempt + 1 };
      }
      if (best.unscheduled.length === 0 && best.validation.errors.length === 0) break;
    }
    return best;
  }

  function checkMove(input, assignmentId, targetDay, targetPeriod, swap) {
    const project = normalizeProject(input);
    const baseline = validateProject(project);
    const original = project.schedule.find((item) => item.id === assignmentId);
    if (!original) return { ok: false, reason: "수업을 찾을 수 없습니다." };
    if (original.locked) return { ok: false, reason: "고정된 수업은 잠금을 먼저 해제해야 합니다." };
    const day = project.days.find((item) => item.id === targetDay);
    if (!day || targetPeriod < 1 || targetPeriod > day.periods) return { ok: false, reason: "운영 시간 밖입니다." };

    const target = project.schedule.find((item) => item.classId === original.classId && item.day === targetDay && item.period === Number(targetPeriod));
    if (target && !swap) return { ok: false, reason: "대상 칸에 이미 수업이 있습니다." };
    if (target?.locked) return { ok: false, reason: "대상 칸의 수업이 고정되어 있습니다." };

    const old = { day: original.day, period: original.period };
    original.day = targetDay;
    original.period = Number(targetPeriod);
    if (target) {
      target.day = old.day;
      target.period = old.period;
    }
    const validation = validateProject(project);
    const movedIds = new Set([original.id, target?.id].filter(Boolean));
    const signature = (item) => `${item.code}|${item.message}|${item.day}|${item.period}`;
    const existingErrors = new Set(baseline.errors.map(signature));
    const blocking = validation.errors.filter((item) => {
      if (existingErrors.has(signature(item))) return false;
      return !item.assignmentId || movedIds.has(item.assignmentId) || (item.relatedIds || []).some((id) => movedIds.has(id));
    });
    if (blocking.length) return { ok: false, reason: blocking[0].message, validation };
    return { ok: true, project, validation, swapped: Boolean(target) };
  }

  function clearUnlocked(input) {
    const project = normalizeProject(input);
    project.schedule = project.schedule.filter((item) => item.locked || item.type === "special");
    return project;
  }

  return {
    DEFAULT_DAYS,
    DEFAULT_SETTINGS,
    uid,
    clone,
    slotKey,
    allSlots,
    normalizeProject,
    newProject,
    validateProject,
    generateSchedule,
    checkMove,
    clearUnlocked,
    consecutiveMax,
    internalGaps,
  };
});
