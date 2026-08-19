import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Core = require("./scheduler-core.js");
const sandbox = { window: {} };
vm.runInNewContext(fs.readFileSync(new URL("./sample-data.js", import.meta.url), "utf8"), sandbox);

const sample = Core.normalizeProject(sandbox.window.TIMETABLE_SAMPLE);
const sampleValidation = Core.validateProject(sample);
assert.equal(sampleValidation.errors.length, 0, "제공된 학교 샘플은 필수 오류가 없어야 합니다.");
assert.equal(sampleValidation.summary.assigned, 930, "정규수업 930시간을 읽어야 합니다.");

const repairInput = Core.clone(sample);
const repairLesson = repairInput.schedule.find((item) => item.type === "regular" && item.teacherId && !item.blockId);
const repairTeacher = repairInput.teachers.find((item) => item.id === repairLesson.teacherId);
repairTeacher.slotStates[Core.slotKey(repairLesson.day, repairLesson.period)] = "unavailable";
const repaired = Core.generateSchedule(repairInput, { attempts: 1, reuseExisting: true, seed: 42 });
assert.equal(repaired.unscheduled.length, 0, "불가 교시 추가 후 미배정 수업이 없어야 합니다.");
assert.equal(repaired.validation.errors.length, 0, "최소변경 재편성으로 필수 오류를 해결해야 합니다.");
assert.ok(repaired.changed > 0, "적어도 한 수업은 이동해야 합니다.");

const mini = Core.normalizeProject({
  name: "연강 테스트",
  days: [{ id: "월", label: "월요일", periods: 6 }, { id: "화", label: "화요일", periods: 6 }],
  teachers: [
    { id: "t1", name: "강사A", kind: "강사", subjects: ["예술"], targetHours: 4, maxDaily: 4, maxConsecutive: 4, preferredWorkDays: 1, allowedDays: ["월"], slotStates: { "월-1": "unavailable" }, preferConsecutive: true },
    { id: "t2", name: "교사B", kind: "교사", subjects: ["국어"], targetHours: 2, maxDaily: 3, maxConsecutive: 3, preferredWorkDays: 2, allowedDays: ["월", "화"], slotStates: {}, preferConsecutive: false },
  ],
  classes: [{ id: "c1", name: "1-1", grade: 1 }, { id: "c2", name: "1-2", grade: 1 }],
  requirements: [
    { id: "r1", classId: "c1", subject: "예술", teacherId: "t1", hours: 2, blockSize: 2 },
    { id: "r2", classId: "c2", subject: "예술", teacherId: "t1", hours: 2, blockSize: 2 },
    { id: "r3", classId: "c1", subject: "국어", teacherId: "t2", hours: 2, blockSize: 1 },
  ],
});
const generated = Core.generateSchedule(mini, { attempts: 20, reuseExisting: false, seed: 7 });
assert.equal(generated.unscheduled.length, 0, "미니 시간표를 모두 배정해야 합니다.");
assert.equal(generated.validation.errors.length, 0, "생성 결과에 필수 충돌이 없어야 합니다.");
assert.ok(generated.project.schedule.filter((item) => item.teacherId === "t1").every((item) => item.day === "월" && item.period !== 1), "강사는 월요일에만 배정되고 불가 1교시를 피해야 합니다.");
for (const requirementId of ["r1", "r2"]) {
  const lessons = generated.project.schedule.filter((item) => item.requirementId === requirementId).sort((a, b) => a.period - b.period);
  assert.equal(lessons.length, 2);
  assert.equal(lessons[0].day, lessons[1].day);
  assert.equal(lessons[1].period, lessons[0].period + 1, "연강은 같은 요일의 연속 교시여야 합니다.");
}

const conflicted = Core.clone(generated.project);
const first = conflicted.schedule[0];
const second = conflicted.schedule.find((item) => item.classId !== first.classId);
second.day = first.day;
second.period = first.period;
second.teacherId = first.teacherId;
const conflictValidation = Core.validateProject(conflicted);
assert.ok(conflictValidation.errors.some((item) => item.code === "TEACHER_CONFLICT"), "교사 중복을 찾아야 합니다.");

console.log("PASS: 학교 샘플 검증, 최소변경 재편성, 강사 요일 제한, 연강, 충돌 검사가 모두 정상입니다.");
