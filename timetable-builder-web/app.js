(function () {
  "use strict";

  const Core = window.SchedulerCore;
  const STORAGE_KEY = "timetable-workshop-project-v1";
  const UI_KEY = "timetable-workshop-ui-v1";
  const SLOT_LABELS = {
    available: "가능",
    prefer: "선호",
    avoid: "기피",
    unavailable: "불가",
  };
  const SLOT_CYCLE = ["available", "prefer", "avoid", "unavailable"];
  const SUBJECT_COLORS = [
    ["#3478ed", "#f1f6ff"], ["#16896b", "#edf9f5"], ["#7456d8", "#f5f2ff"],
    ["#d16b34", "#fff5ef"], ["#cf4b79", "#fff1f6"], ["#247f98", "#edf8fb"],
    ["#8b711d", "#fff9e8"], ["#5269b2", "#f1f3fb"],
  ];

  const root = document.getElementById("view-root");
  const dialog = document.getElementById("app-dialog");
  const dialogForm = document.getElementById("dialog-form");
  const fileInput = document.getElementById("file-input");
  let project = loadProject();
  let validation = Core.validateProject(project);
  let saveTimer = 0;
  let dialogContext = null;
  let ui = Object.assign({
    view: "dashboard",
    scheduleMode: "class",
    selectedEntity: "",
    selectedLesson: "",
    selectedTeacher: "",
    teacherSearch: "",
    requirementClass: "all",
    requirementSearch: "",
    issueLevel: "all",
  }, loadUi());
  const requestedView = new URLSearchParams(window.location.search).get("view");
  if (["dashboard", "timetable", "constraints", "curriculum", "validation", "data"].includes(requestedView)) ui.view = requestedView;

  function loadProject() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) return Core.normalizeProject(JSON.parse(saved));
    } catch (error) {
      console.warn("저장된 프로젝트를 읽지 못했습니다.", error);
    }
    return Core.normalizeProject(window.TIMETABLE_SAMPLE || Core.newProject());
  }

  function loadUi() {
    try { return JSON.parse(localStorage.getItem(UI_KEY) || "{}"); }
    catch { return {}; }
  }

  function persist(immediate) {
    window.clearTimeout(saveTimer);
    const save = () => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
        localStorage.setItem(UI_KEY, JSON.stringify(ui));
        const label = document.getElementById("save-label");
        if (label) label.textContent = "브라우저에 저장됨";
      } catch (error) {
        toast("저장 공간이 부족합니다", "프로젝트 JSON을 내보내 백업해 주세요.", "error");
      }
    };
    if (immediate) save();
    else {
      const label = document.getElementById("save-label");
      if (label) label.textContent = "저장 중…";
      saveTimer = window.setTimeout(save, 350);
    }
  }

  function commit(nextProject, message) {
    project = Core.normalizeProject(nextProject);
    validation = Core.validateProject(project);
    persist(false);
    syncChrome();
    render();
    if (message) toast(message, "변경 내용이 자동 저장되었습니다.", "success");
  }

  function syncChrome() {
    const nameInput = document.getElementById("project-name");
    if (nameInput && nameInput.value !== project.name) nameInput.value = project.name;
    const badge = document.getElementById("nav-issue-badge");
    if (badge) {
      badge.textContent = validation.errors.length;
      badge.style.display = validation.errors.length ? "grid" : "none";
    }
    document.querySelectorAll(".nav-item").forEach((button) => button.classList.toggle("is-active", button.dataset.view === ui.view));
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function toast(title, detail, type) {
    const region = document.getElementById("toast-region");
    const element = document.createElement("div");
    element.className = `toast ${type || ""}`;
    element.innerHTML = `<div>${type === "error" ? "!" : type === "success" ? "✓" : "•"}</div><div><strong>${escapeHtml(title)}</strong><span>${escapeHtml(detail || "")}</span></div>`;
    region.appendChild(element);
    window.setTimeout(() => element.remove(), 3800);
  }

  function navigate(view) {
    ui.view = view;
    ui.selectedLesson = "";
    persist(false);
    syncChrome();
    render();
    document.getElementById("sidebar").classList.remove("is-open");
    document.getElementById("sidebar-scrim").classList.remove("is-open");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function teacherById(id) { return project.teachers.find((item) => item.id === id); }
  function classById(id) { return project.classes.find((item) => item.id === id); }
  function requirementById(id) { return project.requirements.find((item) => item.id === id); }
  function assignmentCountForTeacher(id) { return project.schedule.filter((item) => item.teacherId === id && item.type !== "special").length; }
  function assignmentsForClass(id) { return project.schedule.filter((item) => item.classId === id); }
  function hash(value) {
    let result = 0;
    for (const char of String(value)) result = ((result << 5) - result + char.charCodeAt(0)) | 0;
    return Math.abs(result);
  }
  function subjectStyle(subject) {
    const pair = SUBJECT_COLORS[hash(subject) % SUBJECT_COLORS.length];
    return `--lesson:${pair[0]};--lesson-bg:${pair[1]}`;
  }

  function pageHead(eyebrow, title, description, actions) {
    return `<div class="page-head"><div><span class="eyebrow">${escapeHtml(eyebrow)}</span><h1>${escapeHtml(title)}</h1><p>${description}</p></div><div class="page-actions">${actions || ""}</div></div>`;
  }

  function metricCard(label, value, unit, icon, caption, tone, tint) {
    return `<article class="metric-card" style="--tone:${tone};--tint:${tint}"><div class="metric-top"><span>${label}</span><span class="metric-icon">${icon}</span></div><div class="metric-value">${value}<small>${unit}</small></div><div class="metric-caption">${caption}</div></article>`;
  }

  function renderDashboard() {
    const regularAssigned = project.schedule.filter((item) => item.type !== "special").length;
    const required = project.requirements.reduce((sum, item) => sum + item.hours, 0);
    const pct = required ? Math.min(100, Math.round(regularAssigned / required * 100)) : 0;
    const constrainedTeachers = project.teachers.filter((teacher) => teacher.kind === "강사" || teacher.allowedDays.length < project.days.length || Object.values(teacher.slotStates).some((value) => value !== "available")).length;
    const hardText = validation.errors.length ? `<strong style="color:var(--red)">${validation.errors.length}건 해결 필요</strong>` : `<strong>필수 조건 통과</strong>`;
    const statusClass = validation.errors.length ? "error" : validation.warnings.length ? "warning" : "";
    const statusIcon = validation.errors.length ? "!" : validation.warnings.length ? "△" : "✓";

    return pageHead("PROJECT OVERVIEW", "시간표 편성 현황", "현재 조건과 배정 상태를 한눈에 확인하고 다음 작업으로 이동합니다.",
      `<button class="subtle-button" data-action="load-sample">현재 학교 샘플 복원</button><button class="primary-button" data-action="generate">✦ 최소변경 재편성</button>`) +
      `<div class="metrics-grid">
        ${metricCard("학급", project.classes.length, "개", "▦", `학년 ${new Set(project.classes.map((item) => item.grade)).size}개 구성`, "#3478ed", "#eaf2ff")}
        ${metricCard("교사·강사", project.teachers.length, "명", "♙", `조건 등록 ${constrainedTeachers}명`, "#7456d8", "#f2efff")}
        ${metricCard("필요 수업", required.toLocaleString(), "시간", "≡", `현재 ${regularAssigned.toLocaleString()}시간 배정`, "#16896b", "#eaf8f4")}
        ${metricCard("필수 충돌", validation.errors.length, "건", validation.errors.length ? "!" : "✓", hardText, validation.errors.length ? "#d94949" : "#16896b", validation.errors.length ? "#fff0f0" : "#eaf8f4")}
      </div>
      <div class="dashboard-grid">
        <div class="stack">
          <section class="panel"><div class="panel-head"><div><h2>편성 완성도</h2><p>수업 시수 충족률과 현재 검증 결과</p></div><span class="source-chip">마지막 검사 · 방금</span></div><div class="panel-body">
            <div class="progress-summary"><div style="position:relative"><div class="donut" style="--pct:${pct}"></div><div class="donut-label" style="inset:50% auto auto 50%;transform:translate(-50%,-50%)"><strong>${pct}%</strong><span>${regularAssigned} / ${required}시간</span></div></div>
            <div class="progress-lines">
              <div class="progress-line"><span>수업 배정</span><div class="bar"><span style="width:${pct}%"></span></div><span>${pct}%</span></div>
              <div class="progress-line"><span>필수 조건</span><div class="bar"><span style="width:${validation.errors.length ? Math.max(5, 100 - validation.errors.length) : 100}%;--bar-color:${validation.errors.length ? "var(--red)" : "var(--green)"}"></span></div><span>${validation.errors.length ? validation.errors.length + "건" : "통과"}</span></div>
              <div class="progress-line"><span>선호 조건</span><div class="bar"><span style="width:${Math.max(0, 100 - validation.warnings.length)}%;--bar-color:var(--amber)"></span></div><span>${validation.warnings.length}건</span></div>
            </div></div>
            <div class="status-banner ${statusClass}" style="margin-top:20px"><div class="status-icon">${statusIcon}</div><div><strong>${validation.errors.length ? "필수 충돌을 먼저 해결해 주세요" : validation.warnings.length ? "편성은 가능하지만 선호 조건을 더 개선할 수 있습니다" : "현재 시간표는 모든 등록 조건을 충족합니다"}</strong><p>불가 시간·요일·교사/학급/특별실 중복·최대 연속수업을 필수 조건으로 검사했습니다.</p></div></div>
          </div></section>
          <section class="panel"><div class="panel-head"><div><h2>가져온 원본에 대한 메모</h2><p>자동 변환 시 확인된 가정과 주의사항</p></div></div><div class="panel-body"><ul class="note-list">${(project.sourceNotes.length ? project.sourceNotes : ["원본 메모가 없습니다."]).map((note) => `<li>${escapeHtml(note)}</li>`).join("")}</ul></div></section>
        </div>
        <div class="stack">
          <section class="panel"><div class="panel-head"><div><h2>빠른 작업</h2><p>자주 쓰는 기능</p></div></div><div class="panel-body"><div class="quick-list">
            <button class="quick-item" data-nav="constraints"><span class="q-icon">◇</span><span><strong>교사 불가 시간 입력</strong><small>요일·교시별 가능/선호/기피/불가</small></span><span class="arrow">›</span></button>
            <button class="quick-item" data-nav="curriculum"><span class="q-icon">≡</span><span><strong>학급별 수업 시수 확인</strong><small>교사·과목·연강·특별실 지정</small></span><span class="arrow">›</span></button>
            <button class="quick-item" data-nav="timetable"><span class="q-icon">▦</span><span><strong>시간표 직접 조정</strong><small>수업 이동·맞교환·고정</small></span><span class="arrow">›</span></button>
            <button class="quick-item" data-nav="validation"><span class="q-icon">✓</span><span><strong>충돌 상세 보기</strong><small>${validation.errors.length}개 오류 · ${validation.warnings.length}개 권고</small></span><span class="arrow">›</span></button>
          </div></div></section>
          <section class="panel"><div class="panel-head"><div><h2>조건 구성</h2><p>현재 프로젝트에 등록된 조건</p></div></div><div class="panel-body"><div class="progress-lines">
            <div class="detail-row"><span>강사</span><strong>${project.teachers.filter((item) => item.kind === "강사").length}명</strong></div>
            <div class="detail-row"><span>불가 교시</span><strong>${project.teachers.reduce((sum, item) => sum + Object.values(item.slotStates).filter((value) => value === "unavailable").length, 0)}칸</strong></div>
            <div class="detail-row"><span>연강 수업</span><strong>${project.requirements.filter((item) => item.blockSize > 1).length}개</strong></div>
            <div class="detail-row"><span>고정 수업</span><strong>${project.schedule.filter((item) => item.locked).length}시간</strong></div>
          </div></div></section>
        </div>
      </div>`;
  }

  function renderSchedule() {
    const collection = ui.scheduleMode === "class" ? project.classes : project.teachers;
    if (!ui.selectedEntity || !collection.some((item) => item.id === ui.selectedEntity)) ui.selectedEntity = collection[0]?.id || "";
    const entity = collection.find((item) => item.id === ui.selectedEntity);
    const assignments = project.schedule.filter((item) => ui.scheduleMode === "class" ? item.classId === ui.selectedEntity : item.teacherId === ui.selectedEntity);
    const slotMap = new Map(assignments.map((item) => [Core.slotKey(item.day, item.period), item]));
    const maxPeriods = Math.max(...project.days.map((item) => item.periods), 0);
    const optionLabel = (item) => ui.scheduleMode === "class" ? `${item.name} · 담임 ${item.homeroom || "미지정"}` : `${item.name} · ${item.kind} · ${assignmentCountForTeacher(item.id)}시간`;
    const selected = project.schedule.find((item) => item.id === ui.selectedLesson);

    let rows = "";
    for (let period = 1; period <= maxPeriods; period += 1) {
      rows += `<tr><td class="period">${period}교시</td>`;
      for (const day of project.days) {
        if (period > day.periods) {
          rows += `<td style="background:#f5f7fa"></td>`;
          continue;
        }
        const assignment = slotMap.get(Core.slotKey(day.id, period));
        const counterpart = assignment ? (ui.scheduleMode === "class" ? teacherById(assignment.teacherId)?.name : classById(assignment.classId)?.name) : "";
        rows += `<td class="schedule-cell ${selected ? "drop-ready" : ""}" data-day="${day.id}" data-period="${period}">${assignment ?
          `<button class="lesson-card ${assignment.type === "special" ? "special" : ""} ${assignment.locked ? "is-locked" : ""} ${selected?.id === assignment.id ? "is-selected" : ""}" style="${subjectStyle(assignment.subject)}" data-lesson="${assignment.id}"><strong>${escapeHtml(assignment.subject)}</strong><span>${escapeHtml(counterpart || "담당 없음")}</span><small>${assignment.room ? escapeHtml(assignment.room) : assignment.blockId ? "연강" : ""}</small></button>` :
          `<button class="empty-slot" data-empty-slot="1">${selected ? "여기로 이동" : "+"}</button>`}</td>`;
      }
      rows += `</tr>`;
    }

    return pageHead("TIMETABLE EDITOR", "시간표 편집", "수업을 선택한 뒤 다른 칸을 누르면 이동하거나 맞교환합니다. 고정된 수업은 자동 편성에서 유지됩니다.",
      `<button class="subtle-button" data-action="print">인쇄</button><button class="primary-button" data-action="generate">✦ 최소변경 재편성</button>`) +
      `<div class="toolbar">
        <div class="segmented"><button class="${ui.scheduleMode === "class" ? "is-active" : ""}" data-schedule-mode="class">학급별</button><button class="${ui.scheduleMode === "teacher" ? "is-active" : ""}" data-schedule-mode="teacher">교사별</button></div>
        <select class="field" id="entity-select" aria-label="시간표 대상">${collection.map((item) => `<option value="${item.id}" ${item.id === ui.selectedEntity ? "selected" : ""}>${escapeHtml(optionLabel(item))}</option>`).join("")}</select>
        <span class="source-chip">${entity ? escapeHtml(ui.scheduleMode === "class" ? `${entity.name} · ${assignments.length}시간` : `${entity.name} · ${assignments.length}시간`) : "대상 없음"}</span>
        <span class="spacer"></span>
        ${selected ? `<button class="subtle-button" data-action="cancel-selection">선택 취소</button>` : ""}
      </div>
      <div class="timetable-layout ${selected ? "has-selection" : ""}">
        <div class="schedule-wrap"><table class="schedule-grid"><thead><tr><th>교시</th>${project.days.map((day) => `<th>${escapeHtml(day.label)}<br><small>${day.periods}교시</small></th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></div>
        ${renderLessonDetail(selected)}
      </div>`;
  }

  function renderLessonDetail(assignment) {
    if (!assignment) return `<aside class="detail-card"><div class="placeholder"><div class="placeholder-icon">↔</div><strong>수업을 선택하세요</strong><p>수업을 누르면 상세 정보와 고정·삭제 기능이 나타납니다.</p></div></aside>`;
    const teacher = teacherById(assignment.teacherId);
    const klass = classById(assignment.classId);
    const requirement = requirementById(assignment.requirementId);
    return `<aside class="detail-card"><span class="eyebrow">SELECTED LESSON</span><h3>${escapeHtml(assignment.subject)}</h3><p>${escapeHtml(klass?.name || "학급 없음")} · ${escapeHtml(teacher?.name || "담당 없음")}</p>
      <div class="detail-list">
        <div class="detail-row"><span>시간</span><strong>${assignment.day}요일 ${assignment.period}교시</strong></div>
        <div class="detail-row"><span>담당</span><strong>${escapeHtml(teacher?.name || "-")}</strong></div>
        <div class="detail-row"><span>특별실</span><strong>${escapeHtml(assignment.room || "일반교실")}</strong></div>
        <div class="detail-row"><span>배정 상태</span><strong>${assignment.locked ? "고정" : "이동 가능"}</strong></div>
        <div class="detail-row"><span>주당 시수</span><strong>${requirement?.hours ?? "-"}시간</strong></div>
      </div>
      <div class="status-banner warning" style="margin-bottom:14px"><div class="status-icon">i</div><div><strong>이동 방법</strong><p>선택 상태에서 같은 학급의 빈 칸 또는 다른 수업을 눌러 이동·맞교환합니다.</p></div></div>
      <div class="detail-actions"><button class="subtle-button" data-action="toggle-lock" data-id="${assignment.id}">${assignment.locked ? "고정 해제" : "수업 고정"}</button><button class="danger-button" data-action="delete-lesson" data-id="${assignment.id}" ${assignment.locked ? "disabled" : ""}>배정 삭제</button></div>
    </aside>`;
  }

  function renderConstraints() {
    const filtered = project.teachers.filter((teacher) => teacher.name.includes(ui.teacherSearch) || teacher.subjects.join(" ").includes(ui.teacherSearch));
    if (!ui.selectedTeacher || !project.teachers.some((item) => item.id === ui.selectedTeacher)) ui.selectedTeacher = filtered[0]?.id || project.teachers[0]?.id || "";
    const teacher = teacherById(ui.selectedTeacher);
    const maxPeriods = Math.max(...project.days.map((item) => item.periods), 0);
    let slotRows = "";
    for (let period = 1; period <= maxPeriods; period += 1) {
      slotRows += `<tr><td>${period}교시</td>`;
      for (const day of project.days) {
        if (period > day.periods) slotRows += `<td style="background:#f4f6f9"></td>`;
        else {
          const key = Core.slotKey(day.id, period);
          const state = teacher?.slotStates[key] || "available";
          slotRows += `<td><button class="slot-state ${state}" data-slot-key="${key}" title="클릭하여 상태 변경">${SLOT_LABELS[state]}</button></td>`;
        }
      }
      slotRows += `</tr>`;
    }

    const editor = teacher ? `<section class="editor-panel"><div class="editor-head"><span class="initial" style="--avatar:${SUBJECT_COLORS[hash(teacher.name) % SUBJECT_COLORS.length][0]}">${escapeHtml(teacher.name.slice(-2))}</span><div><h2>${escapeHtml(teacher.name)}</h2><p>${escapeHtml(teacher.subjects.join(" · ") || "담당 과목 미등록")} · 현재 ${assignmentCountForTeacher(teacher.id)}시간</p></div><div class="head-actions"><button class="danger-button" data-action="delete-teacher" data-id="${teacher.id}">삭제</button></div></div>
      <div class="editor-body"><div class="form-grid four">
        <label class="form-group"><span class="form-label">구분</span><select class="form-select" data-teacher-field="kind"><option ${teacher.kind === "교사" ? "selected" : ""}>교사</option><option ${teacher.kind === "강사" ? "selected" : ""}>강사</option></select></label>
        <label class="form-group"><span class="form-label">목표 시수</span><input class="form-input" type="number" min="0" max="40" value="${teacher.targetHours}" data-teacher-field="targetHours"></label>
        <label class="form-group"><span class="form-label">일일 최대</span><input class="form-input" type="number" min="1" max="7" value="${teacher.maxDaily}" data-teacher-field="maxDaily"></label>
        <label class="form-group"><span class="form-label">최대 연속수업</span><input class="form-input" type="number" min="1" max="7" value="${teacher.maxConsecutive}" data-teacher-field="maxConsecutive"></label>
        <label class="form-group"><span class="form-label">희망 출근일 수</span><input class="form-input" type="number" min="1" max="5" value="${teacher.preferredWorkDays}" data-teacher-field="preferredWorkDays"><span class="form-help">초과 시 선호 조건 위반으로 표시</span></label>
        <label class="form-group"><span class="form-label">담당 과목</span><input class="form-input" value="${escapeHtml(teacher.subjects.join(", "))}" data-teacher-field="subjects" placeholder="국어, 독서"></label>
        <label class="form-group full-row"><span class="form-label">메모</span><textarea class="form-textarea" data-teacher-field="notes" placeholder="예: 화요일만 출근, 2~5교시 연강 희망">${escapeHtml(teacher.notes)}</textarea></label>
      </div>
      <div class="section-divider"><div class="section-title"><div><h3>근무 가능 요일</h3><p>해제한 요일에는 어떤 수업도 배정하지 않습니다.</p></div><label style="display:flex;align-items:center;gap:7px;font-size:.72rem;color:var(--muted)"><input type="checkbox" data-teacher-field="preferConsecutive" ${teacher.preferConsecutive ? "checked" : ""}> 공강 없이 연속 배정 선호</label></div>
        <div class="day-toggles">${project.days.map((day) => `<button class="day-toggle ${teacher.allowedDays.includes(day.id) ? "is-on" : ""}" data-toggle-day="${day.id}">${day.id}요일</button>`).join("")}</div>
      </div>
      <div class="section-divider"><div class="section-title"><div><h3>요일·교시별 수업 가능 상태</h3><p>칸을 누를 때마다 가능 → 선호 → 기피 → 불가 순으로 바뀝니다.</p></div><button class="subtle-button" data-action="reset-slots">전체 가능</button></div>
        <div class="availability-wrap"><table class="availability-grid"><thead><tr><th>교시</th>${project.days.map((day) => `<th>${day.id}요일</th>`).join("")}</tr></thead><tbody>${slotRows}</tbody></table></div>
        <div class="legend"><span><i style="--color:#edf1f6"></i>가능</span><span><i style="--color:var(--green-bg)"></i>선호</span><span><i style="--color:var(--amber-bg)"></i>기피</span><span><i style="--color:#f6dede"></i>불가</span></div>
      </div></div></section>` : `<section class="editor-panel"><div class="empty-state"><strong>등록된 교사가 없습니다</strong>교사를 추가해 조건을 입력하세요.</div></section>`;

    return pageHead("TEACHER CONSTRAINTS", "교사 조건", "교사와 강사의 근무 가능 요일, 수업 불가 교시, 연속수업 한도를 설정합니다.", `<button class="primary-button" data-action="add-teacher">+ 교사 추가</button>`) +
      `<div class="split-layout"><aside class="master-list"><div class="master-list-head"><input class="search-field" id="teacher-search" value="${escapeHtml(ui.teacherSearch)}" placeholder="교사·과목 검색"></div><div class="master-items">${filtered.map((item) => `<button class="master-item ${item.id === ui.selectedTeacher ? "is-active" : ""}" data-select-teacher="${item.id}"><span class="initial" style="--avatar:${SUBJECT_COLORS[hash(item.name) % SUBJECT_COLORS.length][0]}">${escapeHtml(item.name.slice(-2))}</span><span><strong>${escapeHtml(item.name)} ${item.kind === "강사" ? '<span class="pill warning">강사</span>' : ""}</strong><small>${escapeHtml(item.subjects.join(" · ") || "과목 미등록")}</small></span><span class="count">${assignmentCountForTeacher(item.id)}h</span></button>`).join("") || `<div class="empty-state">검색 결과가 없습니다.</div>`}</div></aside>${editor}</div>`;
  }

  function renderCurriculum() {
    const rows = project.requirements.filter((item) => {
      const klass = classById(item.classId);
      const teacher = teacherById(item.teacherId);
      const matchesClass = ui.requirementClass === "all" || item.classId === ui.requirementClass;
      const haystack = `${klass?.name || ""} ${item.subject} ${teacher?.name || ""} ${item.room}`;
      return matchesClass && haystack.includes(ui.requirementSearch);
    });
    const totalHours = project.requirements.reduce((sum, item) => sum + item.hours, 0);
    return pageHead("CURRICULUM & LOAD", "수업 시수", "학급별 과목·담당 교사·주당 시수를 등록하고 연강이나 특별실 조건을 지정합니다.",
      `<button class="subtle-button" data-action="add-class">+ 학급</button><button class="primary-button" data-action="add-requirement">+ 수업 시수</button>`) +
      `<div class="metrics-grid" style="grid-template-columns:repeat(3,minmax(0,1fr))">
        ${metricCard("등록 학급", project.classes.length, "개", "▦", "학급별 1주 시간표", "#3478ed", "#eaf2ff")}
        ${metricCard("수업 항목", project.requirements.length, "개", "≡", `총 ${totalHours}시간`, "#16896b", "#eaf8f4")}
        ${metricCard("연강 항목", project.requirements.filter((item) => item.blockSize > 1).length, "개", "↔", "2시간 이상 연속 배정", "#7456d8", "#f2efff")}
      </div>
      <div class="toolbar"><select class="field" id="requirement-class"><option value="all">전체 학급</option>${project.classes.map((item) => `<option value="${item.id}" ${ui.requirementClass === item.id ? "selected" : ""}>${escapeHtml(item.name)}</option>`).join("")}</select><input class="search-field" id="requirement-search" value="${escapeHtml(ui.requirementSearch)}" placeholder="과목·교사·특별실 검색"><span class="spacer"></span><span class="source-chip">${rows.length}개 항목 표시</span></div>
      <section class="table-panel"><div class="table-scroll"><table class="data-table"><thead><tr><th>학급</th><th>과목</th><th>담당 교사</th><th>주당 시수</th><th>편성 단위</th><th>특별실</th><th>현재 배정</th><th>관리</th></tr></thead><tbody>${rows.map((item) => {
        const used = project.schedule.filter((lesson) => lesson.requirementId === item.id).length;
        return `<tr><td><span class="pill">${escapeHtml(classById(item.classId)?.name || "-")}</span></td><td><strong>${escapeHtml(item.subject)}</strong></td><td>${escapeHtml(teacherById(item.teacherId)?.name || "미지정")}</td><td>${item.hours}시간</td><td>${item.blockSize > 1 ? `<span class="pill teacher">${item.blockSize}시간 연강</span>` : "1시간"}</td><td>${escapeHtml(item.room || "-")}</td><td><span class="pill ${used === item.hours ? "success" : "error"}">${used}/${item.hours}</span></td><td><div class="table-actions"><button class="mini-button" data-action="edit-requirement" data-id="${item.id}" title="수정">✎</button><button class="mini-button" data-action="delete-requirement" data-id="${item.id}" title="삭제">×</button></div></td></tr>`;
      }).join("") || `<tr><td colspan="8"><div class="empty-state"><strong>조건에 맞는 수업이 없습니다</strong>필터를 바꾸거나 수업 시수를 추가하세요.</div></td></tr>`}</tbody></table></div></section>`;
  }

  function renderValidation() {
    const all = validation.all.filter((item) => ui.issueLevel === "all" || item.level === ui.issueLevel);
    const summaryText = validation.errors.length ? "필수 조건 오류가 있어 자동편성 또는 수동수정이 필요합니다." : "모든 필수 조건을 통과했습니다. 권고사항은 품질 개선용입니다.";
    return pageHead("VALIDATION", "충돌 검사", summaryText, `<button class="subtle-button" data-action="export-issues">검사 결과 CSV</button><button class="primary-button" data-action="generate">✦ 자동 해결 시도</button>`) +
      `<div class="validation-summary">
        <div class="validation-card"><span class="v-icon" style="--tone:var(--red);--tint:var(--red-bg)">!</span><div><strong>${validation.errors.length}</strong><span>필수 오류</span></div></div>
        <div class="validation-card"><span class="v-icon" style="--tone:#986d18;--tint:var(--amber-bg)">△</span><div><strong>${validation.warnings.length}</strong><span>선호 조건 권고</span></div></div>
        <div class="validation-card"><span class="v-icon" style="--tone:var(--blue-600);--tint:var(--blue-100)">i</span><div><strong>${validation.infos.length}</strong><span>시수 정보</span></div></div>
      </div>
      <div class="toolbar"><div class="segmented"><button class="${ui.issueLevel === "all" ? "is-active" : ""}" data-issue-level="all">전체</button><button class="${ui.issueLevel === "error" ? "is-active" : ""}" data-issue-level="error">오류</button><button class="${ui.issueLevel === "warning" ? "is-active" : ""}" data-issue-level="warning">권고</button><button class="${ui.issueLevel === "info" ? "is-active" : ""}" data-issue-level="info">정보</button></div><span class="spacer"></span><span class="source-chip">검사 시각 ${new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}</span></div>
      <section class="panel flush"><div class="panel-head"><div><h2>검사 항목</h2><p>오류는 반드시 해결해야 하며, 권고는 편성 품질을 높이기 위한 조건입니다.</p></div></div><div class="panel-body"><ul class="issue-list">${all.map((item) => {
        const style = item.level === "error" ? "--tone:var(--red);--tint:var(--red-bg)" : item.level === "warning" ? "--tone:#986d18;--tint:var(--amber-bg)" : "--tone:var(--blue-600);--tint:var(--blue-100)";
        return `<li class="issue-item"><span class="issue-dot" style="${style}">${item.level === "error" ? "!" : item.level === "warning" ? "△" : "i"}</span><div><strong>${escapeHtml(item.message)}</strong><p>${escapeHtml(issueHelp(item.code))}${item.day ? ` · ${item.day}요일 ${item.period || ""}교시` : ""}</p></div>${item.assignmentId ? `<button class="subtle-button" data-action="locate-issue" data-id="${item.assignmentId}">시간표에서 보기</button>` : ""}</li>`;
      }).join("") || `<li class="empty-state"><strong>표시할 검사 항목이 없습니다</strong>현재 필터 범위에서 이상이 발견되지 않았습니다.</li>`}</ul></div></section>`;
  }

  function issueHelp(code) {
    const help = {
      CLASS_CONFLICT: "한 학급에는 같은 교시에 한 수업만 배정할 수 있습니다.",
      TEACHER_CONFLICT: "담당 교사의 다른 수업과 시간이 겹칩니다.",
      ROOM_CONFLICT: "특별실 사용 시간을 바꾸거나 다른 실을 지정하세요.",
      UNAVAILABLE_SLOT: "교사 조건에서 가능 상태로 바꾸거나 수업을 이동하세요.",
      FORBIDDEN_DAY: "교사의 근무 가능 요일 밖에 배정되어 있습니다.",
      MAX_DAILY: "하루 수업 수를 분산하거나 교사 한도를 조정하세요.",
      MAX_CONSECUTIVE: "연속수업을 나누거나 교사 한도를 조정하세요.",
      MISSING_HOURS: "수업 시수에 필요한 배정이 부족합니다.",
      EXTRA_HOURS: "등록된 주당 시수보다 많은 수업이 있습니다.",
      WORKDAY_SPREAD: "강사 수업을 더 적은 요일로 모으면 좋습니다.",
      TEACHER_GAPS: "강사 수업 사이 공강을 줄이면 좋습니다.",
      REPEATED_SUBJECT: "같은 날 같은 과목이 반복되었습니다.",
      TEACHER_HOURS: "교사의 목표 시수와 실제 배정 시수가 다릅니다.",
    };
    return help[code] || "등록 조건과 현재 배정을 확인하세요.";
  }

  function renderData() {
    const size = new Blob([JSON.stringify(project)]).size;
    return pageHead("IMPORT & EXPORT", "데이터 관리", "프로젝트를 백업하거나 다른 컴퓨터로 옮기고, 학급별·교사별 시간표를 CSV로 내보냅니다.", "") +
      `<div class="data-cards">
        <article class="data-card" style="--tone:#3478ed;--tint:#eaf2ff"><div class="data-icon">↓</div><h3>프로젝트 백업</h3><p>교사 조건, 수업 시수, 현재 배정을 모두 포함하는 JSON 파일입니다. 파일 크기 약 ${Math.ceil(size / 1024)}KB.</p><button class="subtle-button full" data-action="export-json">JSON 내보내기</button></article>
        <article class="data-card" style="--tone:#16896b;--tint:#eaf8f4"><div class="data-icon">↑</div><h3>프로젝트 불러오기</h3><p>이 앱에서 내보낸 JSON 또는 정규화된 시간표 CSV를 불러옵니다. 현재 작업은 자동으로 대체됩니다.</p><button class="subtle-button full" data-action="import-file">JSON·CSV 불러오기</button></article>
        <article class="data-card" style="--tone:#7456d8;--tint:#f2efff"><div class="data-icon">▦</div><h3>학급별 시간표</h3><p>학급·요일·교시·과목·담당교사가 들어 있는 엑셀 호환 UTF-8 CSV를 만듭니다.</p><button class="subtle-button full" data-action="export-class-csv">학급별 CSV</button></article>
        <article class="data-card" style="--tone:#d16b34;--tint:#fff5ef"><div class="data-icon">♙</div><h3>교사별 시간표</h3><p>교사·요일·교시·과목·학급을 기준으로 정렬한 업무용 CSV를 만듭니다.</p><button class="subtle-button full" data-action="export-teacher-csv">교사별 CSV</button></article>
        <article class="data-card" style="--tone:#247f98;--tint:#edf8fb"><div class="data-icon">↺</div><h3>현재 학교 샘플</h3><p>제공된 2026학년도 2학기 시간표를 최초 분석 상태로 되돌립니다.</p><button class="subtle-button full" data-action="load-sample">샘플 다시 불러오기</button></article>
        <article class="data-card" style="--tone:#5269b2;--tint:#f1f3fb"><div class="data-icon">⎙</div><h3>시간표 인쇄</h3><p>시간표 편집 화면에 선택된 학급 또는 교사의 표를 A4 문서로 인쇄합니다.</p><button class="subtle-button full" data-action="go-print">시간표로 이동</button></article>
      </div>
      <section class="panel danger-zone"><div class="panel-head"><div><h2>새 프로젝트 시작</h2><p>교사·학급·시수를 비운 뒤 처음부터 구성합니다. 먼저 JSON 백업을 권장합니다.</p></div><button class="danger-button" data-action="new-project">모두 비우기</button></div></section>`;
  }

  function render() {
    const renderers = {
      dashboard: renderDashboard,
      timetable: renderSchedule,
      constraints: renderConstraints,
      curriculum: renderCurriculum,
      validation: renderValidation,
      data: renderData,
    };
    root.innerHTML = (renderers[ui.view] || renderDashboard)();
    syncChrome();
  }

  function openDialog(type, item) {
    dialogContext = { type, item };
    const title = document.getElementById("dialog-title");
    const eyebrow = document.getElementById("dialog-eyebrow");
    const body = document.getElementById("dialog-body");
    const submit = document.getElementById("dialog-submit");
    submit.style.display = "inline-flex";
    eyebrow.textContent = "DATA INPUT";

    if (type === "teacher") {
      title.textContent = "교사 추가";
      body.innerHTML = `<div class="form-grid"><label class="form-group"><span class="form-label">이름</span><input class="form-input" name="name" required autofocus></label><label class="form-group"><span class="form-label">구분</span><select class="form-select" name="kind"><option>교사</option><option>강사</option></select></label><label class="form-group full-row"><span class="form-label">담당 과목</span><input class="form-input" name="subjects" placeholder="예: 수학, 창의수학"></label><label class="form-group"><span class="form-label">목표 시수</span><input class="form-input" name="targetHours" type="number" min="0" value="0"></label><label class="form-group"><span class="form-label">희망 출근일</span><input class="form-input" name="preferredWorkDays" type="number" min="1" max="5" value="5"></label></div>`;
    } else if (type === "class") {
      title.textContent = "학급 추가";
      body.innerHTML = `<div class="form-grid"><label class="form-group"><span class="form-label">학급명</span><input class="form-input" name="name" required autofocus placeholder="예: 1-1"></label><label class="form-group"><span class="form-label">학년</span><input class="form-input" name="grade" type="number" min="1" max="6" value="1"></label><label class="form-group full-row"><span class="form-label">담임교사</span><input class="form-input" name="homeroom" placeholder="교사 이름"></label></div>`;
    } else if (type === "requirement") {
      const req = item || {};
      title.textContent = item ? "수업 시수 수정" : "수업 시수 추가";
      body.innerHTML = `<div class="form-grid">
        <label class="form-group"><span class="form-label">학급</span><select class="form-select" name="classId" required>${project.classes.map((klass) => `<option value="${klass.id}" ${req.classId === klass.id ? "selected" : ""}>${escapeHtml(klass.name)}</option>`).join("")}</select></label>
        <label class="form-group"><span class="form-label">과목</span><input class="form-input" name="subject" required value="${escapeHtml(req.subject || "")}" autofocus></label>
        <label class="form-group"><span class="form-label">담당 교사</span><select class="form-select" name="teacherId" required>${project.teachers.map((teacher) => `<option value="${teacher.id}" ${req.teacherId === teacher.id ? "selected" : ""}>${escapeHtml(teacher.name)}</option>`).join("")}</select></label>
        <label class="form-group"><span class="form-label">주당 시수</span><input class="form-input" name="hours" type="number" min="1" max="20" required value="${req.hours || 1}"></label>
        <label class="form-group"><span class="form-label">연속 편성 단위</span><select class="form-select" name="blockSize"><option value="1" ${req.blockSize !== 2 ? "selected" : ""}>1시간씩</option><option value="2" ${req.blockSize === 2 ? "selected" : ""}>2시간 연강</option></select></label>
        <label class="form-group"><span class="form-label">특별실</span><input class="form-input" name="room" value="${escapeHtml(req.room || "")}" placeholder="예: 미술실"></label>
        <label class="form-group full-row"><span class="form-label">메모</span><textarea class="form-textarea" name="notes">${escapeHtml(req.notes || "")}</textarea></label>
      </div>`;
    } else if (type === "help") {
      eyebrow.textContent = "QUICK START";
      title.textContent = "처음 사용 안내";
      submit.style.display = "none";
      body.innerHTML = `<div class="status-banner"><div class="status-icon">1</div><div><strong>교사 조건부터 확인하세요</strong><p>강사의 근무 가능 요일과 연강 선호, 교사별 불가 교시를 입력합니다.</p></div></div><div class="status-banner" style="margin-top:10px"><div class="status-icon">2</div><div><strong>수업 시수를 점검하세요</strong><p>학급·과목·담당교사·주당 시수, 연강과 특별실을 등록합니다.</p></div></div><div class="status-banner" style="margin-top:10px"><div class="status-icon">3</div><div><strong>자동 편성 후 충돌을 확인하세요</strong><p>기본은 현재표를 최대한 유지하며 문제가 있는 수업만 옮깁니다. 시간표 편집에서 직접 맞교환하고 고정할 수도 있습니다.</p></div></div><p style="margin:18px 0 0;color:var(--muted);font-size:.74rem;line-height:1.6">중요한 작업 전에는 데이터 관리에서 JSON 백업을 내려받으세요. 이 앱은 서버로 자료를 보내지 않고 현재 브라우저 안에서만 처리합니다.</p>`;
    }
    dialog.showModal();
  }

  function handleDialogSubmit(event) {
    event.preventDefault();
    if (!dialogContext || dialogContext.type === "help") { dialog.close(); return; }
    const data = Object.fromEntries(new FormData(dialogForm).entries());
    const next = Core.clone(project);
    if (dialogContext.type === "teacher") {
      const teacher = {
        id: Core.uid("teacher"), name: data.name.trim(), kind: data.kind, subjects: data.subjects.split(",").map((item) => item.trim()).filter(Boolean),
        targetHours: Number(data.targetHours), maxDaily: 6, maxConsecutive: 3, preferredWorkDays: Number(data.preferredWorkDays),
        allowedDays: project.days.map((day) => day.id), slotStates: {}, preferConsecutive: data.kind === "강사", notes: "",
      };
      next.teachers.push(teacher);
      ui.selectedTeacher = teacher.id;
    } else if (dialogContext.type === "class") {
      next.classes.push({ id: Core.uid("class"), name: data.name.trim(), grade: Number(data.grade), homeroom: data.homeroom.trim() });
    } else if (dialogContext.type === "requirement") {
      const req = {
        id: dialogContext.item?.id || Core.uid("req"), classId: data.classId, subject: data.subject.trim(), teacherId: data.teacherId,
        hours: Number(data.hours), blockSize: Number(data.blockSize), room: data.room.trim(), preferredDays: dialogContext.item?.preferredDays || [],
        forbiddenSlots: dialogContext.item?.forbiddenSlots || [], notes: data.notes.trim(),
      };
      const index = next.requirements.findIndex((item) => item.id === req.id);
      if (index >= 0) next.requirements[index] = req;
      else next.requirements.push(req);
    }
    dialog.close();
    commit(next, "항목을 저장했습니다");
  }

  function runGeneration() {
    if (!project.classes.length || !project.requirements.length) {
      toast("편성할 데이터가 없습니다", "학급과 수업 시수를 먼저 등록해 주세요.", "error");
      return;
    }
    const overlay = document.createElement("div");
    overlay.className = "generating";
    overlay.innerHTML = `<div class="generating-card"><div class="spinner"></div><h3>조건을 맞추며 편성하고 있습니다</h3><p>현재 배정을 최대한 유지하고, 불가 시간이나 충돌이 있는 수업부터 다시 배치합니다.</p></div>`;
    document.body.appendChild(overlay);
    window.setTimeout(() => {
      try {
        const result = Core.generateSchedule(project, { reuseExisting: true, attempts: project.settings.attempts || 12 });
        project = result.project;
        validation = result.validation;
        persist(true);
        render();
        const message = result.unscheduled.length ? `${result.unscheduled.length}개 수업 묶음을 배치하지 못했습니다.` : result.validation.errors.length ? `${result.validation.errors.length}개 필수 오류가 남았습니다.` : "모든 필수 조건을 충족했습니다.";
        toast(result.unscheduled.length || result.validation.errors.length ? "재편성 완료 · 추가 조정 필요" : "재편성이 완료되었습니다", `${message} 변경 수업 ${result.changed}시간.`, result.unscheduled.length || result.validation.errors.length ? "error" : "success");
      } catch (error) {
        console.error(error);
        toast("자동 편성 중 오류가 발생했습니다", error.message, "error");
      } finally {
        overlay.remove();
      }
    }, 60);
  }

  function handleScheduleCell(target) {
    const cell = target.closest(".schedule-cell");
    const lessonButton = target.closest("[data-lesson]");
    if (!cell) return;
    if (lessonButton && !ui.selectedLesson) {
      ui.selectedLesson = lessonButton.dataset.lesson;
      render();
      return;
    }
    if (lessonButton && ui.selectedLesson === lessonButton.dataset.lesson) {
      ui.selectedLesson = "";
      render();
      return;
    }
    if (ui.selectedLesson) {
      const result = Core.checkMove(project, ui.selectedLesson, cell.dataset.day, Number(cell.dataset.period), true);
      if (!result.ok) {
        toast("이동할 수 없습니다", result.reason, "error");
        if (lessonButton) ui.selectedLesson = lessonButton.dataset.lesson;
        render();
        return;
      }
      ui.selectedLesson = "";
      commit(result.project, result.swapped ? "두 수업을 맞교환했습니다" : "수업을 이동했습니다");
      return;
    }
    if (lessonButton) {
      ui.selectedLesson = lessonButton.dataset.lesson;
      render();
    }
  }

  function download(filename, text, mime, bom) {
    const blob = new Blob([bom ? "\ufeff" : "", text], { type: mime || "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  function csvCell(value) {
    const text = String(value ?? "");
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  }

  function rowsToCsv(rows) { return rows.map((row) => row.map(csvCell).join(",")).join("\r\n"); }

  function exportClassCsv() {
    const rows = [["학급", "학년", "담임", "요일", "교시", "과목", "담당교사", "특별실", "고정", "구분"]];
    const sorted = project.schedule.slice().sort((a, b) => (classById(a.classId)?.name || "").localeCompare(classById(b.classId)?.name || "", "ko") || project.days.findIndex((d) => d.id === a.day) - project.days.findIndex((d) => d.id === b.day) || a.period - b.period);
    for (const item of sorted) {
      const klass = classById(item.classId);
      rows.push([klass?.name, klass?.grade, klass?.homeroom, item.day, item.period, item.subject, teacherById(item.teacherId)?.name, item.room, item.locked ? "고정" : "", item.type === "special" ? "특별" : "정규수업"]);
    }
    download(`${safeName(project.name)}_학급별.csv`, rowsToCsv(rows), "text/csv;charset=utf-8", true);
  }

  function exportTeacherCsv() {
    const rows = [["교사", "구분", "요일", "교시", "과목", "학급", "특별실", "고정"]];
    const sorted = project.schedule.filter((item) => item.teacherId).slice().sort((a, b) => (teacherById(a.teacherId)?.name || "").localeCompare(teacherById(b.teacherId)?.name || "", "ko") || project.days.findIndex((d) => d.id === a.day) - project.days.findIndex((d) => d.id === b.day) || a.period - b.period);
    for (const item of sorted) {
      const teacher = teacherById(item.teacherId);
      rows.push([teacher?.name, teacher?.kind, item.day, item.period, item.subject, classById(item.classId)?.name, item.room, item.locked ? "고정" : ""]);
    }
    download(`${safeName(project.name)}_교사별.csv`, rowsToCsv(rows), "text/csv;charset=utf-8", true);
  }

  function exportIssues() {
    const rows = [["수준", "코드", "내용", "요일", "교시"]];
    for (const item of validation.all) rows.push([item.level, item.code, item.message, item.day, item.period || ""]);
    download(`${safeName(project.name)}_충돌검사.csv`, rowsToCsv(rows), "text/csv;charset=utf-8", true);
  }

  function safeName(value) { return String(value).replace(/[\\/:*?"<>|]/g, "_"); }

  function parseCsv(text) {
    const rows = [];
    let row = [];
    let cell = "";
    let quoted = false;
    for (let i = 0; i < text.length; i += 1) {
      const char = text[i];
      if (quoted) {
        if (char === '"' && text[i + 1] === '"') { cell += '"'; i += 1; }
        else if (char === '"') quoted = false;
        else cell += char;
      } else if (char === '"') quoted = true;
      else if (char === ",") { row.push(cell); cell = ""; }
      else if (char === "\n") { row.push(cell.replace(/\r$/, "")); rows.push(row); row = []; cell = ""; }
      else cell += char;
    }
    if (cell.length || row.length) { row.push(cell.replace(/\r$/, "")); rows.push(row); }
    return rows;
  }

  function projectFromNormalizedCsv(text) {
    const rows = parseCsv(text.replace(/^\ufeff/, ""));
    const headers = rows.shift() || [];
    const index = Object.fromEntries(headers.map((name, i) => [name.trim(), i]));
    if (index["학급"] == null || index["요일"] == null || index["교시"] == null || index["과목"] == null) throw new Error("학급·요일·교시·과목 열이 필요합니다.");
    const records = rows.filter((row) => row.some(Boolean)).map((row) => ({
      className: row[index["학급"]]?.trim(), grade: Number(row[index["학년"]] || 0), homeroom: row[index["담임"]]?.trim() || "",
      day: row[index["요일"]]?.trim(), period: Number(row[index["교시"]]), subject: row[index["과목"]]?.trim(), teacher: row[index["담당교사"]]?.trim() || "",
      room: row[index["특별실"]]?.trim() || "", type: (row[index["구분"]] || "정규수업").includes("정규") ? "regular" : "special",
    }));
    const next = Core.newProject();
    next.name = "CSV에서 가져온 시간표";
    const classNames = [...new Set(records.map((item) => item.className).filter(Boolean))];
    const teacherNames = [...new Set(records.map((item) => item.teacher).filter(Boolean))];
    next.classes = classNames.map((name, i) => { const first = records.find((item) => item.className === name); return { id: `class-${i + 1}`, name, grade: first.grade, homeroom: first.homeroom }; });
    next.teachers = teacherNames.map((name, i) => ({ id: `teacher-${i + 1}`, name, kind: "교사", subjects: [...new Set(records.filter((item) => item.teacher === name).map((item) => item.subject))], targetHours: records.filter((item) => item.teacher === name && item.type === "regular").length, maxDaily: 6, maxConsecutive: 3, preferredWorkDays: 5, allowedDays: next.days.map((day) => day.id), slotStates: {}, preferConsecutive: false, notes: "" }));
    const classMap = new Map(next.classes.map((item) => [item.name, item.id]));
    const teacherMap = new Map(next.teachers.map((item) => [item.name, item.id]));
    const groups = new Map();
    for (const record of records.filter((item) => item.type === "regular")) {
      const key = `${record.className}|${record.subject}|${record.teacher}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(record);
    }
    const reqMap = new Map();
    next.requirements = [...groups.entries()].map(([key, items], i) => {
      const first = items[0]; const id = `req-${i + 1}`; reqMap.set(key, id);
      return { id, classId: classMap.get(first.className), subject: first.subject, teacherId: teacherMap.get(first.teacher) || "", hours: items.length, blockSize: 1, room: first.room, preferredDays: [], forbiddenSlots: [], notes: "CSV에서 가져옴" };
    });
    next.schedule = records.map((item, i) => ({ id: `lesson-${i + 1}`, requirementId: item.type === "regular" ? reqMap.get(`${item.className}|${item.subject}|${item.teacher}`) : "", classId: classMap.get(item.className), teacherId: teacherMap.get(item.teacher) || "", subject: item.subject, day: item.day, period: item.period, room: item.room, blockId: "", locked: item.type === "special", type: item.type }));
    next.sourceNotes = ["정규화 CSV에서 가져왔습니다. 교사별 불가 시간과 연강 조건은 별도로 설정하세요."];
    return Core.normalizeProject(next);
  }

  function handleFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const next = file.name.toLowerCase().endsWith(".json") ? Core.normalizeProject(JSON.parse(reader.result)) : projectFromNormalizedCsv(reader.result);
        project = next;
        validation = Core.validateProject(project);
        ui.selectedEntity = "";
        ui.selectedTeacher = "";
        ui.view = "dashboard";
        persist(true);
        render();
        toast("프로젝트를 불러왔습니다", `${project.classes.length}학급 · ${project.teachers.length}교사`, "success");
      } catch (error) {
        toast("파일을 불러오지 못했습니다", error.message, "error");
      }
      fileInput.value = "";
    };
    reader.readAsText(file, "utf-8");
  }

  function confirmLoadSample() {
    if (!window.confirm("현재 작업을 제공된 학교 시간표 샘플로 바꿀까요? 중요한 작업은 먼저 JSON으로 백업하세요.")) return;
    project = Core.normalizeProject(window.TIMETABLE_SAMPLE);
    validation = Core.validateProject(project);
    ui.selectedEntity = "";
    ui.selectedTeacher = "";
    persist(true);
    render();
    toast("학교 샘플을 복원했습니다", "원본 분석 시점의 시간표와 조건을 불러왔습니다.", "success");
  }

  function actionHandler(action, element) {
    if (action === "generate") runGeneration();
    else if (action === "print") window.print();
    else if (action === "go-print") { navigate("timetable"); window.setTimeout(() => window.print(), 250); }
    else if (action === "cancel-selection") { ui.selectedLesson = ""; render(); }
    else if (action === "toggle-lock") {
      const next = Core.clone(project); const item = next.schedule.find((lesson) => lesson.id === element.dataset.id); if (item) item.locked = !item.locked; commit(next, item?.locked ? "수업을 고정했습니다" : "수업 고정을 해제했습니다");
    } else if (action === "delete-lesson") {
      if (!window.confirm("이 배정을 삭제할까요? 수업 시수는 남아 있어 충돌 검사에서 미배정으로 표시됩니다.")) return;
      const next = Core.clone(project); next.schedule = next.schedule.filter((item) => item.id !== element.dataset.id); ui.selectedLesson = ""; commit(next, "배정을 삭제했습니다");
    } else if (action === "add-teacher") openDialog("teacher");
    else if (action === "add-class") openDialog("class");
    else if (action === "add-requirement") {
      if (!project.classes.length || !project.teachers.length) toast("학급과 교사가 필요합니다", "두 항목을 먼저 등록해 주세요.", "error"); else openDialog("requirement");
    } else if (action === "edit-requirement") openDialog("requirement", requirementById(element.dataset.id));
    else if (action === "delete-requirement") {
      const id = element.dataset.id; const req = requirementById(id); const count = project.schedule.filter((item) => item.requirementId === id).length;
      if (!window.confirm(`${req?.subject || "수업"} 시수와 연결된 배정 ${count}시간을 함께 삭제할까요?`)) return;
      const next = Core.clone(project); next.requirements = next.requirements.filter((item) => item.id !== id); next.schedule = next.schedule.filter((item) => item.requirementId !== id); commit(next, "수업 시수를 삭제했습니다");
    } else if (action === "delete-teacher") {
      const id = element.dataset.id; const teacher = teacherById(id); const used = project.requirements.filter((item) => item.teacherId === id).length;
      if (used) { toast("교사를 삭제할 수 없습니다", `연결된 수업 시수 ${used}개를 먼저 다른 교사로 바꾸세요.`, "error"); return; }
      if (!window.confirm(`${teacher?.name || "교사"} 정보를 삭제할까요?`)) return;
      const next = Core.clone(project); next.teachers = next.teachers.filter((item) => item.id !== id); ui.selectedTeacher = ""; commit(next, "교사를 삭제했습니다");
    } else if (action === "reset-slots") {
      const next = Core.clone(project); const teacher = next.teachers.find((item) => item.id === ui.selectedTeacher); if (teacher) teacher.slotStates = {}; commit(next, "모든 교시를 가능 상태로 바꿨습니다");
    } else if (action === "locate-issue") {
      const item = project.schedule.find((lesson) => lesson.id === element.dataset.id); if (!item) return; ui.scheduleMode = "class"; ui.selectedEntity = item.classId; ui.selectedLesson = item.id; navigate("timetable");
    } else if (action === "export-json") download(`${safeName(project.name)}.json`, JSON.stringify(project, null, 2), "application/json;charset=utf-8", false);
    else if (action === "export-class-csv") exportClassCsv();
    else if (action === "export-teacher-csv") exportTeacherCsv();
    else if (action === "export-issues") exportIssues();
    else if (action === "import-file") fileInput.click();
    else if (action === "load-sample") confirmLoadSample();
    else if (action === "new-project") {
      if (!window.confirm("현재 프로젝트를 모두 비우고 새로 시작할까요? 이 작업은 브라우저에서 되돌릴 수 없습니다.")) return;
      project = Core.newProject(); validation = Core.validateProject(project); ui.selectedEntity = ""; ui.selectedTeacher = ""; ui.view = "dashboard"; persist(true); render(); toast("새 프로젝트를 시작했습니다", "교사와 학급부터 등록해 주세요.", "success");
    }
  }

  root.addEventListener("click", (event) => {
    const nav = event.target.closest("[data-nav]");
    if (nav) { navigate(nav.dataset.nav); return; }
    const action = event.target.closest("[data-action]");
    if (action) { actionHandler(action.dataset.action, action); return; }
    const mode = event.target.closest("[data-schedule-mode]");
    if (mode) { ui.scheduleMode = mode.dataset.scheduleMode; ui.selectedEntity = ""; ui.selectedLesson = ""; render(); return; }
    const teacher = event.target.closest("[data-select-teacher]");
    if (teacher) { ui.selectedTeacher = teacher.dataset.selectTeacher; render(); return; }
    const day = event.target.closest("[data-toggle-day]");
    if (day) {
      const next = Core.clone(project); const item = next.teachers.find((teacherItem) => teacherItem.id === ui.selectedTeacher); const id = day.dataset.toggleDay;
      if (item.allowedDays.includes(id)) {
        if (item.allowedDays.length === 1) { toast("요일을 모두 해제할 수 없습니다", "최소 한 요일은 근무 가능해야 합니다.", "error"); return; }
        item.allowedDays = item.allowedDays.filter((value) => value !== id);
      } else item.allowedDays.push(id);
      commit(next);
      return;
    }
    const slot = event.target.closest("[data-slot-key]");
    if (slot) {
      const next = Core.clone(project); const item = next.teachers.find((teacherItem) => teacherItem.id === ui.selectedTeacher); const current = item.slotStates[slot.dataset.slotKey] || "available"; const nextState = SLOT_CYCLE[(SLOT_CYCLE.indexOf(current) + 1) % SLOT_CYCLE.length];
      if (nextState === "available") delete item.slotStates[slot.dataset.slotKey]; else item.slotStates[slot.dataset.slotKey] = nextState;
      commit(next);
      return;
    }
    if (event.target.closest(".schedule-cell")) handleScheduleCell(event.target);
    const issueLevel = event.target.closest("[data-issue-level]");
    if (issueLevel) { ui.issueLevel = issueLevel.dataset.issueLevel; render(); }
  });

  root.addEventListener("change", (event) => {
    if (event.target.id === "entity-select") { ui.selectedEntity = event.target.value; ui.selectedLesson = ""; render(); }
    else if (event.target.id === "requirement-class") { ui.requirementClass = event.target.value; render(); }
    else if (event.target.matches("[data-teacher-field]")) {
      const next = Core.clone(project); const teacher = next.teachers.find((item) => item.id === ui.selectedTeacher); const field = event.target.dataset.teacherField;
      if (!teacher) return;
      if (["targetHours", "maxDaily", "maxConsecutive", "preferredWorkDays"].includes(field)) teacher[field] = Number(event.target.value);
      else if (field === "subjects") teacher.subjects = event.target.value.split(",").map((item) => item.trim()).filter(Boolean);
      else if (field === "preferConsecutive") teacher[field] = event.target.checked;
      else teacher[field] = event.target.value;
      commit(next);
    }
  });

  root.addEventListener("input", (event) => {
    if (event.target.id === "teacher-search") { ui.teacherSearch = event.target.value; const cursor = event.target.selectionStart; render(); const input = document.getElementById("teacher-search"); input?.focus(); input?.setSelectionRange(cursor, cursor); }
    else if (event.target.id === "requirement-search") { ui.requirementSearch = event.target.value; const cursor = event.target.selectionStart; render(); const input = document.getElementById("requirement-search"); input?.focus(); input?.setSelectionRange(cursor, cursor); }
  });

  document.querySelectorAll(".nav-item").forEach((button) => button.addEventListener("click", () => navigate(button.dataset.view)));
  document.getElementById("project-name").addEventListener("change", (event) => { const next = Core.clone(project); next.name = event.target.value.trim() || "시간표 프로젝트"; commit(next); });
  document.getElementById("generate-button").addEventListener("click", runGeneration);
  document.getElementById("validate-button").addEventListener("click", () => { validation = Core.validateProject(project); navigate("validation"); });
  document.getElementById("more-button").addEventListener("click", () => download(`${safeName(project.name)}.json`, JSON.stringify(project, null, 2), "application/json;charset=utf-8"));
  document.getElementById("help-button").addEventListener("click", () => openDialog("help"));
  document.getElementById("mobile-menu").addEventListener("click", () => { document.getElementById("sidebar").classList.add("is-open"); document.getElementById("sidebar-scrim").classList.add("is-open"); });
  document.getElementById("sidebar-scrim").addEventListener("click", () => { document.getElementById("sidebar").classList.remove("is-open"); document.getElementById("sidebar-scrim").classList.remove("is-open"); });
  fileInput.addEventListener("change", () => handleFile(fileInput.files[0]));
  dialogForm.addEventListener("submit", handleDialogSubmit);
  dialogForm.querySelectorAll("[data-dialog-close]").forEach((button) => button.addEventListener("click", () => dialog.close()));

  syncChrome();
  render();
})();
