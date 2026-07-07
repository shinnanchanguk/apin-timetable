import assert from "node:assert/strict";
import {
  countWebdirs,
  getClassTimetable,
  getTeacherTimetable,
  listTeachers,
  lookupSchool,
} from "../dist/index.js";

const city = "대구";
const schoolName = "학남고등학교";
const weekStart = "2026-07-06";

const count = await countWebdirs();
assert.ok(count.webdirCount >= 600, `expected at least 600 webdirs, got ${count.webdirCount}`);

const profile = await lookupSchool({ city, schoolName });
assert.equal(profile.webPath, "0650");
assert.equal(profile.classLabels.length, 27);
assert.equal(profile.teacherOptions.length, 54);

const classWeek = await getClassTimetable({ city, schoolName, grade: 1, classNo: 1, weekStart });
assert.equal(classWeek.source, "apin");
assert.equal(classWeek.weekStart, weekStart);
assert.ok(classWeek.entries.length >= 30, `expected class entries, got ${classWeek.entries.length}`);
assert.equal(classWeek.entries[0].subject, "과학탐구실험1");

const teachers = await listTeachers({ city, schoolName });
assert.equal(teachers.length, 54);

const teacherWeek = await getTeacherTimetable({ city, schoolName, teacherNo: 1, weekStart });
assert.ok(teacherWeek.entries.length > 0, "expected teacher timetable entries");

console.log(
  JSON.stringify(
    {
      webdirCount: count.webdirCount,
      school: {
        webPath: profile.webPath,
        classes: profile.classLabels.length,
        teachers: profile.teacherOptions.length,
      },
      classTimetableEntries: classWeek.entries.length,
      firstClassEntry: classWeek.entries[0],
      teacherTimetableEntries: teacherWeek.entries.length,
      firstTeacherEntry: teacherWeek.entries[0],
    },
    null,
    2,
  ),
);
