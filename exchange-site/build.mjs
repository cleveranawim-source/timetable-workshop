/* template.html + 시간표 데이터 + 신고서 양식 → index.html
   실행: node exchange-site/build.mjs */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(dir);

/* 본 앱의 시간표에서 수업 교체에 필요한 부분만 뽑는다.
   requirements·settings·weights는 쓰지 않으므로 제외한다. */
function slimData() {
  const sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, "sample-data.js"), "utf8"), sandbox);
  const p = sandbox.window.TIMETABLE_SAMPLE;
  return JSON.stringify({
    name: p.name,
    days: p.days.map(d => ({ id: d.id, label: d.label, periods: d.periods })),
    teachers: p.teachers.map(t => ({
      id: t.id, name: t.name, kind: t.kind, subjects: t.subjects,
      allowedDays: t.allowedDays, slotStates: t.slotStates,
      maxDaily: t.maxDaily, maxConsecutive: t.maxConsecutive,
    })),
    classes: p.classes.map(c => ({ id: c.id, name: c.name, grade: c.grade, homeroom: c.homeroom })),
    schedule: p.schedule.map(a => ({
      id: a.id, classId: a.classId, teacherId: a.teacherId, subject: a.subject,
      day: a.day, period: a.period,
      blockId: a.blockId || undefined, locked: a.locked || undefined, type: a.type,
    })),
  });
}

const tpl = fs.readFileSync(path.join(dir, "template.html"), "utf8");
const parts = {
  "/*__DATA__*/": slimData(),
  "/*__HWPXFILL__*/": fs.readFileSync(path.join(dir, "hwpx-fill.js"), "utf8"),
  "/*__HWPX_TPL__*/": fs.readFileSync(path.join(dir, "form-template.hwpx")).toString("base64"),
};
let out = tpl;
for (const [mark, value] of Object.entries(parts)) {
  if (!out.includes(mark)) throw new Error(`자리표시자를 찾지 못했습니다: ${mark}`);
  out = out.replace(mark, value);
}
fs.writeFileSync(path.join(dir, "index.html"), out);
console.log("index.html:", (Buffer.byteLength(out) / 1024 / 1024).toFixed(2) + "MB");
