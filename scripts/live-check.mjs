// Live check against the real Apin server (network required).
//   npm run live
// Proves the dynamic path, the static path, and that crossVerify() sees them
// agree on a real school. Default target: 대구 학남고등학교, this week.
import assert from "node:assert/strict";
import {
  countWebdirs,
  crossVerify,
  currentWeekByUpdate,
  getClassTimetable,
  getRoomTimetable,
  getStaticPeriodTimes,
  listTeachers,
  lookupSchool,
} from "../dist/index.js";

const city = process.env.APIN_CITY || "대구";
const schoolName = process.env.APIN_SCHOOL || "학남고등학교";
const weekStart = process.env.APIN_WEEK || "2026-07-06";

const count = await countWebdirs();
assert.ok(count.webdirCount >= 500, `expected many webdirs, got ${count.webdirCount}`);

const profile = await lookupSchool({ city, schoolName });
assert.ok(profile.webdir, "expected a webdir");
assert.ok(profile.classLabels.length > 0, "expected class labels");
assert.ok(profile.teacherNumbers.length > 0, "expected teacher numbers");

const classDyn = await getClassTimetable({ city, schoolName, grade: 1, classNo: 1, weekStart });
assert.equal(classDyn.source, "dynamic");
assert.ok(classDyn.entries.length >= 20, `expected class entries, got ${classDyn.entries.length}`);

const classStatic = await getClassTimetable({ city, schoolName, grade: 1, classNo: 1, weekStart, mode: "static" });
assert.equal(classStatic.source, "static");

const teachers = await listTeachers({ city, schoolName });
assert.equal(teachers.length, profile.teacherNumbers.length);

const room = await getRoomTimetable({ city, schoolName, weekStart }).catch((e) => ({ error: e.message }));
const periodTimes = await getStaticPeriodTimes(profile.webdir, classDyn.week).catch(() => []);
const weekByUpdate = await currentWeekByUpdate(profile.webdir).catch(() => null);

// The flagship: dynamic vs static must agree end-to-end on the real server.
const verified = await crossVerify({ city, schoolName, weekStart });
assert.equal(verified.allMatch, true, `crossVerify mismatch: ${JSON.stringify(verified.checks)}`);

console.log(
  JSON.stringify(
    {
      webdirCount: count.webdirCount,
      school: { webdir: profile.webdir, classes: profile.classLabels.length, teachers: profile.teacherNumbers.length, rooms: profile.roomLabels },
      week: classDyn.week,
      weekByUpdate,
      classFirstEntry: classDyn.entries[0],
      classDynamicVsStaticFirstMatch: classDyn.entries[0]?.subject === classStatic.entries[0]?.subject,
      room: room.error ? room : { target: room.target, entries: room.entries.length },
      periodTimes,
      crossVerify: { allMatch: verified.allMatch, checks: verified.checks.map((c) => ({ label: c.label, match: c.match })) },
    },
    null,
    2,
  ),
);
console.log("\nlive cross-check passed ✓");
