(function (global) {
  "use strict";

  const encoder = new TextEncoder();
  const STYLE = {
    DEFAULT: 0,
    TITLE: 1,
    META: 2,
    HEADER: 3,
    PERIOD: 4,
    SUBJECT: 5,
    DETAIL: 6,
    SEPARATOR: 7,
    ENTITY: 8,
    COMPACT_SUBJECT: 9,
    COMPACT_DETAIL: 10,
    NOTE: 11,
    HOURS: 12,
    BLANK_BORDER: 13,
  };

  function xmlEscape(value) {
    return String(value ?? "")
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&apos;");
  }

  function columnName(index) {
    let value = index;
    let result = "";
    while (value > 0) {
      value -= 1;
      result = String.fromCharCode(65 + (value % 26)) + result;
      value = Math.floor(value / 26);
    }
    return result;
  }

  function makeSheet(name, widths, orientation) {
    return {
      name,
      widths: widths.slice(),
      orientation: orientation || "portrait",
      rows: [],
      merges: [],
      rowBreaks: [],
      repeatRows: "",
      printArea: "",
    };
  }

  function ensureRow(sheet, rowIndex) {
    while (sheet.rows.length < rowIndex) sheet.rows.push({ cells: [], height: 20 });
    return sheet.rows[rowIndex - 1];
  }

  function setRowHeight(sheet, rowIndex, height) {
    ensureRow(sheet, rowIndex).height = height;
  }

  function setCell(sheet, rowIndex, columnIndex, value, style) {
    const row = ensureRow(sheet, rowIndex);
    row.cells[columnIndex - 1] = { value: value ?? "", style: style ?? STYLE.DEFAULT };
  }

  function fillCells(sheet, rowStart, rowEnd, columnStart, columnEnd, style) {
    for (let row = rowStart; row <= rowEnd; row += 1) {
      for (let column = columnStart; column <= columnEnd; column += 1) {
        if (!ensureRow(sheet, row).cells[column - 1]) setCell(sheet, row, column, "", style);
      }
    }
  }

  function merge(sheet, rowStart, columnStart, rowEnd, columnEnd, value, style) {
    fillCells(sheet, rowStart, rowEnd, columnStart, columnEnd, style);
    setCell(sheet, rowStart, columnStart, value, style);
    sheet.merges.push(`${columnName(columnStart)}${rowStart}:${columnName(columnEnd)}${rowEnd}`);
  }

  function schoolMeta(project) {
    const source = String(project.name || "");
    const yearMatch = source.match(/(20\d{2})\s*학년도?/);
    const semesterMatch = source.match(/([12])\s*학기/);
    const schoolMatch = source.match(/([^\s]+(?:중학교|고등학교|초등학교))/);
    return {
      year: yearMatch?.[1] || String(new Date().getFullYear()),
      semester: semesterMatch?.[1] || "",
      school: schoolMatch?.[1] || "",
    };
  }

  function displayDays(project) {
    const days = (project.days || []).slice(0, 5).map((day) => ({
      id: day.id,
      label: String(day.label || day.id || "").replace("요일", "").slice(0, 1),
      periods: Math.max(0, Number(day.periods) || 0),
    }));
    while (days.length < 5) days.push({ id: "", label: "", periods: 0 });
    return days;
  }

  function timetableIndex(project, field) {
    const result = new Map();
    for (const lesson of project.schedule || []) {
      const entityId = lesson[field];
      if (!entityId) continue;
      const key = `${entityId}|${lesson.day}|${lesson.period}`;
      if (!result.has(key)) result.set(key, []);
      result.get(key).push(lesson);
    }
    return result;
  }

  function slotLessons(index, entityId, day, period) {
    return index.get(`${entityId}|${day}|${period}`) || [];
  }

  function uniqueText(values) {
    return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))].join(" / ");
  }

  function isBlockContinuation(project, index, entityId, day, period, lesson) {
    if (period <= 1) return false;
    const requirement = (project.requirements || []).find((item) => item.id === lesson.requirementId);
    if (!lesson.blockId && (!requirement || Number(requirement.blockSize) < 2)) return false;
    return slotLessons(index, entityId, day, period - 1).some((previous) => {
      if (lesson.blockId && previous.blockId) return previous.blockId === lesson.blockId;
      return lesson.requirementId && previous.requirementId === lesson.requirementId;
    });
  }

  function shortName(name) {
    const text = String(name || "").trim();
    return text.length > 2 ? text.slice(0, 2) : text;
  }

  function buildIndividualSheet(project, kind) {
    const isTeacher = kind === "teacher";
    const entities = isTeacher ? (project.teachers || []) : (project.classes || []);
    const entityField = isTeacher ? "teacherId" : "classId";
    const index = timetableIndex(project, entityField);
    const teachers = new Map((project.teachers || []).map((teacher) => [teacher.id, teacher]));
    const classes = new Map((project.classes || []).map((klass) => [klass.id, klass]));
    const days = displayDays(project);
    const meta = schoolMeta(project);
    const sheet = makeSheet(isTeacher ? "교사별 시간표" : "학반별 시간표", [5.5, 13, 13, 13, 13, 13], "portrait");

    entities.forEach((entity, entityIndex) => {
      const base = entityIndex * 18 + 1;
      merge(sheet, base, 1, base, 6, isTeacher ? "교사 시간표" : "학반 시간표", STYLE.TITLE);
      merge(sheet, base + 1, 1, base + 1, 3, `${meta.year} 학년도`, STYLE.META);
      const heading = isTeacher ? entity.name : `${entity.name}${entity.homeroom ? `  ${entity.homeroom}` : ""}`;
      merge(sheet, base + 1, 4, base + 1, 6, heading, STYLE.META);
      setCell(sheet, base + 2, 1, "", STYLE.HEADER);
      days.forEach((day, dayIndex) => setCell(sheet, base + 2, dayIndex + 2, day.label, STYLE.HEADER));
      setRowHeight(sheet, base, 24);
      setRowHeight(sheet, base + 1, 22);
      setRowHeight(sheet, base + 2, 21);

      for (let period = 1; period <= 7; period += 1) {
        const subjectRow = base + 3 + (period - 1) * 2;
        const detailRow = subjectRow + 1;
        merge(sheet, subjectRow, 1, detailRow, 1, period, STYLE.PERIOD);
        days.forEach((day, dayIndex) => {
          const lessons = day.id && period <= day.periods ? slotLessons(index, entity.id, day.id, period) : [];
          const continuation = lessons.length > 0 && lessons.every((lesson) => isBlockContinuation(project, index, entity.id, day.id, period, lesson));
          const subjects = continuation ? "│" : uniqueText(lessons.map((lesson) => lesson.subject));
          const details = continuation ? "▽" : uniqueText(lessons.map((lesson) => {
            if (isTeacher) return classes.get(lesson.classId)?.name || "";
            return teachers.get(lesson.teacherId)?.name || "";
          }));
          setCell(sheet, subjectRow, dayIndex + 2, subjects, STYLE.SUBJECT);
          setCell(sheet, detailRow, dayIndex + 2, details, STYLE.DETAIL);
        });
        setRowHeight(sheet, subjectRow, 21);
        setRowHeight(sheet, detailRow, 24);
      }

      merge(sheet, base + 17, 1, base + 17, 6, "", STYLE.SEPARATOR);
      setRowHeight(sheet, base + 17, 8);
      if (entityIndex < entities.length - 1) sheet.rowBreaks.push(base + 17);
    });

    const lastRow = Math.max(1, entities.length * 18);
    sheet.printArea = `$A$1:$F$${lastRow}`;
    return sheet;
  }

  function buildWholeTeacherSheet(project) {
    const teachers = project.teachers || [];
    const classes = new Map((project.classes || []).map((klass) => [klass.id, klass]));
    const days = displayDays(project);
    const index = timetableIndex(project, "teacherId");
    const meta = schoolMeta(project);
    const scheduleCount = days.reduce((sum, day) => sum + day.periods, 0);
    const firstScheduleColumn = 3;
    const lastScheduleColumn = firstScheduleColumn + scheduleCount - 1;
    const hoursColumn = lastScheduleColumn + 1;
    const teacherColumn = lastScheduleColumn + 2;
    const homeroomColumn = lastScheduleColumn + 3;
    const notesColumn = lastScheduleColumn + 4;
    const widths = [4.5, 10];
    for (let indexValue = 0; indexValue < scheduleCount; indexValue += 1) widths.push(5);
    widths.push(6, 10, 8, 18);
    const sheet = makeSheet("전체교사 시간표", widths, "landscape");

    merge(sheet, 1, 1, 1, notesColumn, "전체 교사 시간표", STYLE.TITLE);
    const metaSplit = Math.max(2, Math.floor(notesColumn / 2));
    merge(sheet, 2, 1, 2, metaSplit, `${meta.year} 학년도${meta.semester ? ` ${meta.semester}학기` : ""}`, STYLE.META);
    merge(sheet, 2, metaSplit + 1, 2, notesColumn, meta.school, STYLE.META);
    merge(sheet, 3, 1, 4, 1, "번호", STYLE.HEADER);
    merge(sheet, 3, 2, 4, 2, "교사", STYLE.HEADER);

    let column = firstScheduleColumn;
    days.forEach((day) => {
      if (!day.periods) return;
      merge(sheet, 3, column, 3, column + day.periods - 1, day.label, STYLE.HEADER);
      for (let period = 1; period <= day.periods; period += 1) setCell(sheet, 4, column + period - 1, period, STYLE.PERIOD);
      column += day.periods;
    });
    merge(sheet, 3, hoursColumn, 4, hoursColumn, "시수", STYLE.HEADER);
    merge(sheet, 3, teacherColumn, 4, teacherColumn, "교사", STYLE.HEADER);
    merge(sheet, 3, homeroomColumn, 4, homeroomColumn, "담임", STYLE.HEADER);
    merge(sheet, 3, notesColumn, 4, notesColumn, "비고", STYLE.HEADER);
    [1, 2, 3, 4].forEach((row, indexValue) => setRowHeight(sheet, row, [25, 22, 22, 21][indexValue]));

    teachers.forEach((teacher, teacherIndex) => {
      const subjectRow = 5 + teacherIndex * 2;
      const detailRow = subjectRow + 1;
      merge(sheet, subjectRow, 1, detailRow, 1, teacherIndex + 1, STYLE.ENTITY);
      merge(sheet, subjectRow, 2, detailRow, 2, teacher.name, STYLE.ENTITY);
      let currentColumn = firstScheduleColumn;
      days.forEach((day) => {
        for (let period = 1; period <= day.periods; period += 1) {
          const lessons = slotLessons(index, teacher.id, day.id, period);
          const continuation = lessons.length > 0 && lessons.every((lesson) => isBlockContinuation(project, index, teacher.id, day.id, period, lesson));
          setCell(sheet, subjectRow, currentColumn, continuation ? "─▷" : uniqueText(lessons.map((lesson) => lesson.subject)), STYLE.COMPACT_SUBJECT);
          setCell(sheet, detailRow, currentColumn, continuation ? "" : uniqueText(lessons.map((lesson) => classes.get(lesson.classId)?.name || "")), STYLE.COMPACT_DETAIL);
          currentColumn += 1;
        }
      });
      const lessonHours = (project.schedule || []).filter((lesson) => lesson.teacherId === teacher.id && lesson.type !== "special").length;
      const homeroom = (project.classes || []).find((klass) => klass.homeroom === teacher.name)?.name || "";
      merge(sheet, subjectRow, hoursColumn, detailRow, hoursColumn, lessonHours, STYLE.HOURS);
      merge(sheet, subjectRow, teacherColumn, detailRow, teacherColumn, teacher.name, STYLE.ENTITY);
      merge(sheet, subjectRow, homeroomColumn, detailRow, homeroomColumn, homeroom, STYLE.ENTITY);
      merge(sheet, subjectRow, notesColumn, detailRow, notesColumn, teacher.notes || "", STYLE.NOTE);
      setRowHeight(sheet, subjectRow, 20);
      setRowHeight(sheet, detailRow, 20);
    });

    const lastRow = Math.max(4, 4 + teachers.length * 2);
    sheet.repeatRows = "$1:$4";
    sheet.printArea = `$A$1:$${columnName(notesColumn)}$${lastRow}`;
    return sheet;
  }

  function buildWholeClassSheet(project) {
    const classes = project.classes || [];
    const teachers = new Map((project.teachers || []).map((teacher) => [teacher.id, teacher]));
    const days = displayDays(project);
    const index = timetableIndex(project, "classId");
    const meta = schoolMeta(project);
    const scheduleCount = days.reduce((sum, day) => sum + day.periods, 0);
    const firstScheduleColumn = 2;
    const lastScheduleColumn = firstScheduleColumn + scheduleCount - 1;
    const classColumn = lastScheduleColumn + 1;
    const homeroomColumn = lastScheduleColumn + 2;
    const notesColumn = lastScheduleColumn + 3;
    const widths = [7];
    for (let indexValue = 0; indexValue < scheduleCount; indexValue += 1) widths.push(5);
    widths.push(7, 10, 14);
    const sheet = makeSheet("전체학반시간표", widths, "landscape");

    merge(sheet, 1, 1, 1, notesColumn, "전체 학반 시간표", STYLE.TITLE);
    const metaSplit = Math.max(2, Math.floor(notesColumn / 2));
    merge(sheet, 2, 1, 2, metaSplit, `${meta.year} 학년도${meta.semester ? ` ${meta.semester}학기` : ""}`, STYLE.META);
    merge(sheet, 2, metaSplit + 1, 2, notesColumn, meta.school, STYLE.META);
    merge(sheet, 3, 1, 4, 1, "학반", STYLE.HEADER);

    let column = firstScheduleColumn;
    days.forEach((day) => {
      if (!day.periods) return;
      merge(sheet, 3, column, 3, column + day.periods - 1, day.label, STYLE.HEADER);
      for (let period = 1; period <= day.periods; period += 1) setCell(sheet, 4, column + period - 1, period, STYLE.PERIOD);
      column += day.periods;
    });
    merge(sheet, 3, classColumn, 4, classColumn, "학반", STYLE.HEADER);
    merge(sheet, 3, homeroomColumn, 4, homeroomColumn, "담임", STYLE.HEADER);
    merge(sheet, 3, notesColumn, 4, notesColumn, "비고", STYLE.HEADER);
    [1, 2, 3, 4].forEach((row, indexValue) => setRowHeight(sheet, row, [25, 22, 22, 21][indexValue]));

    classes.forEach((klass, classIndex) => {
      const subjectRow = 5 + classIndex * 2;
      const detailRow = subjectRow + 1;
      merge(sheet, subjectRow, 1, detailRow, 1, klass.name, STYLE.ENTITY);
      let currentColumn = firstScheduleColumn;
      days.forEach((day) => {
        for (let period = 1; period <= day.periods; period += 1) {
          const lessons = slotLessons(index, klass.id, day.id, period);
          const continuation = lessons.length > 0 && lessons.every((lesson) => isBlockContinuation(project, index, klass.id, day.id, period, lesson));
          setCell(sheet, subjectRow, currentColumn, continuation ? "─▷" : uniqueText(lessons.map((lesson) => lesson.subject)), STYLE.COMPACT_SUBJECT);
          setCell(sheet, detailRow, currentColumn, continuation ? "" : uniqueText(lessons.map((lesson) => shortName(teachers.get(lesson.teacherId)?.name))), STYLE.COMPACT_DETAIL);
          currentColumn += 1;
        }
      });
      merge(sheet, subjectRow, classColumn, detailRow, classColumn, klass.name, STYLE.ENTITY);
      merge(sheet, subjectRow, homeroomColumn, detailRow, homeroomColumn, klass.homeroom || "", STYLE.ENTITY);
      merge(sheet, subjectRow, notesColumn, detailRow, notesColumn, "", STYLE.NOTE);
      setRowHeight(sheet, subjectRow, 20);
      setRowHeight(sheet, detailRow, 20);
    });

    const lastRow = Math.max(4, 4 + classes.length * 2);
    sheet.repeatRows = "$1:$4";
    sheet.printArea = `$A$1:$${columnName(notesColumn)}$${lastRow}`;
    return sheet;
  }

  function cellXml(rowIndex, columnIndex, cell) {
    const reference = `${columnName(columnIndex)}${rowIndex}`;
    const style = Number(cell?.style) || 0;
    const styleAttribute = style ? ` s="${style}"` : "";
    const value = cell?.value ?? "";
    if (typeof value === "number" && Number.isFinite(value)) return `<c r="${reference}"${styleAttribute}><v>${value}</v></c>`;
    const text = String(value);
    const space = /^\s|\s$/.test(text) ? ' xml:space="preserve"' : "";
    return `<c r="${reference}" s="${style}" t="inlineStr"><is><t${space}>${xmlEscape(text)}</t></is></c>`;
  }

  function sheetXml(sheet) {
    const rowCount = Math.max(1, sheet.rows.length);
    const columnCount = Math.max(1, sheet.widths.length);
    const columns = sheet.widths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join("");
    const rows = sheet.rows.map((row, rowIndex) => {
      const cells = [];
      const lastCell = Math.max(row.cells.length, columnCount);
      for (let columnIndex = 1; columnIndex <= lastCell; columnIndex += 1) {
        const cell = row.cells[columnIndex - 1];
        if (cell) cells.push(cellXml(rowIndex + 1, columnIndex, cell));
      }
      return `<row r="${rowIndex + 1}" ht="${row.height || 20}" customHeight="1">${cells.join("")}</row>`;
    }).join("");
    const merges = sheet.merges.length ? `<mergeCells count="${sheet.merges.length}">${sheet.merges.map((ref) => `<mergeCell ref="${ref}"/>`).join("")}</mergeCells>` : "";
    const breaks = sheet.rowBreaks.length ? `<rowBreaks count="${sheet.rowBreaks.length}" manualBreakCount="${sheet.rowBreaks.length}">${sheet.rowBreaks.map((id) => `<brk id="${id}" min="0" max="16383" man="1"/>`).join("")}</rowBreaks>` : "";
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>
  <dimension ref="A1:${columnName(columnCount)}${rowCount}"/>
  <sheetViews><sheetView workbookViewId="0" showGridLines="0"/></sheetViews>
  <sheetFormatPr defaultRowHeight="20"/>
  <cols>${columns}</cols>
  <sheetData>${rows}</sheetData>
  ${merges}
  <printOptions horizontalCentered="1"/>
  <pageMargins left="0.25" right="0.25" top="0.35" bottom="0.35" header="0.2" footer="0.2"/>
  <pageSetup paperSize="9" orientation="${sheet.orientation}" fitToWidth="1" fitToHeight="0"/>
  ${breaks}
</worksheet>`;
  }

  function stylesXml() {
    const border = `<border><left style="thin"><color rgb="FFB8C6D9"/></left><right style="thin"><color rgb="FFB8C6D9"/></right><top style="thin"><color rgb="FFB8C6D9"/></top><bottom style="thin"><color rgb="FFB8C6D9"/></bottom><diagonal/></border>`;
    const xf = (fontId, fillId, borderId, align, extra) => `<xf numFmtId="0" fontId="${fontId}" fillId="${fillId}" borderId="${borderId}" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"${extra || ""}><alignment horizontal="${align.horizontal}" vertical="center"${align.wrap ? ' wrapText="1"' : ""}/></xf>`;
    const styles = [
      `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>`,
      xf(1, 2, 1, { horizontal: "center", wrap: false }),
      xf(2, 3, 1, { horizontal: "center", wrap: true }),
      xf(3, 4, 1, { horizontal: "center", wrap: true }),
      xf(2, 5, 1, { horizontal: "center", wrap: false }),
      xf(4, 0, 1, { horizontal: "center", wrap: true }),
      xf(0, 6, 1, { horizontal: "center", wrap: true }),
      xf(0, 0, 0, { horizontal: "center", wrap: false }),
      xf(2, 3, 1, { horizontal: "center", wrap: true }),
      xf(4, 0, 1, { horizontal: "center", wrap: true }),
      xf(0, 6, 1, { horizontal: "center", wrap: true }),
      xf(0, 6, 1, { horizontal: "left", wrap: true }),
      xf(2, 3, 1, { horizontal: "center", wrap: false }),
      xf(0, 0, 1, { horizontal: "center", wrap: true }),
    ];
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="5">
    <font><sz val="9"/><name val="맑은 고딕"/><family val="2"/><charset val="129"/><color rgb="FF556277"/></font>
    <font><b/><sz val="15"/><name val="맑은 고딕"/><family val="2"/><charset val="129"/><color rgb="FFFFFFFF"/></font>
    <font><b/><sz val="10"/><name val="맑은 고딕"/><family val="2"/><charset val="129"/><color rgb="FF17375E"/></font>
    <font><b/><sz val="10"/><name val="맑은 고딕"/><family val="2"/><charset val="129"/><color rgb="FFFFFFFF"/></font>
    <font><b/><sz val="9"/><name val="맑은 고딕"/><family val="2"/><charset val="129"/><color rgb="FF23354D"/></font>
  </fonts>
  <fills count="7">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF17375E"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFDCE6F1"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF4F81BD"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFEAF2F8"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF7F9FC"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>${border}</borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="${styles.length}">${styles.join("")}</cellXfs>
  <cellStyles count="1"><cellStyle name="표준" xfId="0" builtinId="0"/></cellStyles>
  <dxfs count="0"/>
  <tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/>
</styleSheet>`;
  }

  function workbookXml(sheets) {
    const sheetNodes = sheets.map((sheet, index) => `<sheet name="${xmlEscape(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("");
    const definedNames = [];
    sheets.forEach((sheet, index) => {
      const escapedName = `'${String(sheet.name).replaceAll("'", "''")}'`;
      if (sheet.printArea) definedNames.push(`<definedName name="_xlnm.Print_Area" localSheetId="${index}">${escapedName}!${sheet.printArea}</definedName>`);
      if (sheet.repeatRows) definedNames.push(`<definedName name="_xlnm.Print_Titles" localSheetId="${index}">${escapedName}!${sheet.repeatRows}</definedName>`);
    });
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <fileVersion appName="xl" lastEdited="7" lowestEdited="7" rupBuild="0"/>
  <workbookPr defaultThemeVersion="164011"/>
  <bookViews><workbookView xWindow="0" yWindow="0" windowWidth="24000" windowHeight="12000" activeTab="2"/></bookViews>
  <sheets>${sheetNodes}</sheets>
  <definedNames>${definedNames.join("")}</definedNames>
  <calcPr calcId="191029" fullCalcOnLoad="1"/>
</workbook>`;
  }

  function workbookRelationshipsXml(sheets) {
    const sheetRelations = sheets.map((sheet, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join("");
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheetRelations}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
  }

  function contentTypesXml(sheets) {
    const sheetTypes = sheets.map((sheet, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("");
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheetTypes}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`;
  }

  function themeXml() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Office"><a:themeElements><a:clrScheme name="Office"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="17375E"/></a:dk2><a:lt2><a:srgbClr val="EAF2F8"/></a:lt2><a:accent1><a:srgbClr val="4F81BD"/></a:accent1><a:accent2><a:srgbClr val="C0504D"/></a:accent2><a:accent3><a:srgbClr val="9BBB59"/></a:accent3><a:accent4><a:srgbClr val="8064A2"/></a:accent4><a:accent5><a:srgbClr val="4BACC6"/></a:accent5><a:accent6><a:srgbClr val="F79646"/></a:accent6><a:hlink><a:srgbClr val="0000FF"/></a:hlink><a:folHlink><a:srgbClr val="800080"/></a:folHlink></a:clrScheme><a:fontScheme name="Office"><a:majorFont><a:latin typeface="맑은 고딕"/><a:ea typeface="맑은 고딕"/><a:cs typeface="Arial"/></a:majorFont><a:minorFont><a:latin typeface="맑은 고딕"/><a:ea typeface="맑은 고딕"/><a:cs typeface="Arial"/></a:minorFont></a:fontScheme><a:fmtScheme name="Office"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`;
  }

  function rootRelationshipsXml() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`;
  }

  function corePropertiesXml() {
    const timestamp = new Date().toISOString();
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:creator>시간표 공방</dc:creator><cp:lastModifiedBy>시간표 공방</cp:lastModifiedBy><dc:title>학교 시간표 전체 결과</dc:title><dc:description>교과교실 배정을 제외한 4개 시간표 시트</dc:description><dcterms:created xsi:type="dcterms:W3CDTF">${timestamp}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${timestamp}</dcterms:modified></cp:coreProperties>`;
  }

  function appPropertiesXml(sheets) {
    const titles = sheets.map((sheet) => `<vt:lpstr>${xmlEscape(sheet.name)}</vt:lpstr>`).join("");
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>시간표 공방</Application><DocSecurity>0</DocSecurity><ScaleCrop>false</ScaleCrop><HeadingPairs><vt:vector size="2" baseType="variant"><vt:variant><vt:lpstr>워크시트</vt:lpstr></vt:variant><vt:variant><vt:i4>${sheets.length}</vt:i4></vt:variant></vt:vector></HeadingPairs><TitlesOfParts><vt:vector size="${sheets.length}" baseType="lpstr">${titles}</vt:vector></TitlesOfParts><Company></Company><LinksUpToDate>false</LinksUpToDate><SharedDoc>false</SharedDoc><HyperlinksChanged>false</HyperlinksChanged><AppVersion>1.0</AppVersion></Properties>`;
  }

  const crcTable = (() => {
    const table = new Uint32Array(256);
    for (let index = 0; index < 256; index += 1) {
      let value = index;
      for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
      table[index] = value >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    let value = 0xffffffff;
    for (const byte of bytes) value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
    return (value ^ 0xffffffff) >>> 0;
  }

  function u16(value) {
    return new Uint8Array([value & 0xff, (value >>> 8) & 0xff]);
  }

  function u32(value) {
    return new Uint8Array([value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff]);
  }

  function concatBytes(parts) {
    const length = parts.reduce((sum, part) => sum + part.length, 0);
    const result = new Uint8Array(length);
    let offset = 0;
    for (const part of parts) {
      result.set(part, offset);
      offset += part.length;
    }
    return result;
  }

  function dosTimestamp(date) {
    const year = Math.max(1980, date.getFullYear());
    return {
      time: ((date.getHours() & 31) << 11) | ((date.getMinutes() & 63) << 5) | ((Math.floor(date.getSeconds() / 2)) & 31),
      date: (((year - 1980) & 127) << 9) | (((date.getMonth() + 1) & 15) << 5) | (date.getDate() & 31),
    };
  }

  function createZip(files) {
    const localParts = [];
    const centralParts = [];
    const now = dosTimestamp(new Date());
    let offset = 0;
    files.forEach((file) => {
      const name = encoder.encode(file.name);
      const data = typeof file.content === "string" ? encoder.encode(file.content) : file.content;
      const checksum = crc32(data);
      const localHeader = concatBytes([
        u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(now.time), u16(now.date),
        u32(checksum), u32(data.length), u32(data.length), u16(name.length), u16(0), name,
      ]);
      localParts.push(localHeader, data);
      const centralHeader = concatBytes([
        u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(now.time), u16(now.date),
        u32(checksum), u32(data.length), u32(data.length), u16(name.length), u16(0), u16(0),
        u16(0), u16(0), u32(0), u32(offset), name,
      ]);
      centralParts.push(centralHeader);
      offset += localHeader.length + data.length;
    });
    const centralDirectory = concatBytes(centralParts);
    const end = concatBytes([
      u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length),
      u32(centralDirectory.length), u32(offset), u16(0),
    ]);
    return concatBytes([...localParts, centralDirectory, end]);
  }

  function buildWorkbook(project) {
    const sheets = [
      buildIndividualSheet(project, "teacher"),
      buildWholeTeacherSheet(project),
      buildIndividualSheet(project, "class"),
      buildWholeClassSheet(project),
    ];
    const files = [
      { name: "[Content_Types].xml", content: contentTypesXml(sheets) },
      { name: "_rels/.rels", content: rootRelationshipsXml() },
      { name: "docProps/core.xml", content: corePropertiesXml() },
      { name: "docProps/app.xml", content: appPropertiesXml(sheets) },
      { name: "xl/workbook.xml", content: workbookXml(sheets) },
      { name: "xl/_rels/workbook.xml.rels", content: workbookRelationshipsXml(sheets) },
      { name: "xl/styles.xml", content: stylesXml() },
    ];
    sheets.forEach((sheet, index) => files.push({ name: `xl/worksheets/sheet${index + 1}.xml`, content: sheetXml(sheet) }));
    return createZip(files);
  }

  function downloadWorkbook(project, filename) {
    const bytes = buildWorkbook(project);
    const blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename || "학교시간표_전체.xlsx";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  global.TimetableXlsxExporter = {
    buildWorkbook,
    downloadWorkbook,
    sheetNames: ["교사별 시간표", "전체교사 시간표", "학반별 시간표", "전체학반시간표"],
  };
})(window);
