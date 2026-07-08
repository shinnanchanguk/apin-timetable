// Dynamic and static reads against the shared mock server.
import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import test from "node:test";
import {
  clearProfileCache,
  countWebdirs,
  currentWeekByUpdate,
  getClassTimetable,
  getRoomTimetable,
  getTeacherTimetable,
  listFilesDetailed,
  listTeachers,
  lookupSchool,
} from "../dist/index.js";
import { makeFetch } from "./apin-fixture.mjs";

const SCHOOL = { city: "대구", schoolName: "학남고등학교" };

test("lookupSchool resolves webdir, classes, teachers, rooms", async () => {
  clearProfileCache();
  const profile = await lookupSchool({ ...SCHOOL, fetch: makeFetch() });
  assert.equal(profile.webdir, "0650");
  assert.deepEqual(profile.classLabels, ["1-1", "1-2"]);
  assert.deepEqual(profile.teacherNumbers, ["1", "2", "3"]);
  assert.deepEqual(profile.roomLabels, ["정보실"]);
  assert.equal(profile.version, "34");
  assert.equal(profile.date, "20270220"); // exposed, never used to hard-fail
});

test("dynamic class timetable returns grid and entries", async () => {
  clearProfileCache();
  const week = await getClassTimetable({ ...SCHOOL, grade: 1, classNo: 1, week: 20, fetch: makeFetch() });
  assert.equal(week.source, "dynamic");
  assert.equal(week.kind, "class");
  assert.equal(week.target, "1-1");
  assert.equal(week.entries[0].subject, "MATH");
  assert.deepEqual(week.periodTimes, ["08:30", "09:30", "10:30", "11:30"]);
  assert.equal(week.grid[0][0].subject, "MATH");
});

test("static class timetable matches the dynamic shape", async () => {
  clearProfileCache();
  const week = await getClassTimetable({ ...SCHOOL, grade: 1, classNo: 1, week: 20, mode: "static", fetch: makeFetch() });
  assert.equal(week.source, "static");
  assert.equal(week.entries[0].subject, "MATH");
  assert.deepEqual(week.periodTimes, ["08:30", "09:30", "10:30", "11:30"]);
});

test("dynamic teacher timetable keeps ref as the class label", async () => {
  clearProfileCache();
  const week = await getTeacherTimetable({ ...SCHOOL, teacherNo: 1, week: 20, fetch: makeFetch() });
  assert.equal(week.kind, "teacher");
  assert.equal(week.entries[0].subject, "MATH");
  assert.equal(week.entries[0].ref, "1-1");
});

test("room timetable is available from the static t-file", async () => {
  clearProfileCache();
  const week = await getRoomTimetable({ ...SCHOOL, week: 20, fetch: makeFetch() });
  assert.equal(week.kind, "room");
  assert.equal(week.source, "static");
  assert.equal(week.target, "정보실");
  assert.equal(week.entries[0].subject, "INFO");
  assert.equal(week.entries[0].ref, "1-1");
});

test("listTeachers returns numbered options", async () => {
  clearProfileCache();
  const teachers = await listTeachers({ ...SCHOOL, fetch: makeFetch() });
  assert.deepEqual(teachers, [
    { no: 1, label: "1" },
    { no: 2, label: "2" },
    { no: 3, label: "3" },
  ]);
});

test("currentWeekByUpdate picks the newest h-file on or before asOf", async () => {
  const week = await currentWeekByUpdate("0650", { asOf: new Date("2026-07-08"), fetch: makeFetch() });
  assert.equal(week, 20);
  const files = await listFilesDetailed("0650", { fetch: makeFetch() });
  assert.ok(files.some((f) => f.name === "h20.txt" && f.modified));
});

test("counts numeric webdirs on the /tm/ root", async () => {
  const counted = await countWebdirs({ fetch: makeFetch() });
  assert.equal(counted.webdirCount, 3);
});

test("a shared abort signal is not leaked across requests", async () => {
  clearProfileCache();
  const ctrl = new AbortController();
  // lookupSchool makes two requests; both must detach their abort listener.
  await lookupSchool({ ...SCHOOL, fetch: makeFetch(), signal: ctrl.signal });
  assert.equal(getEventListeners(ctrl.signal, "abort").length, 0);
});

test("getupdir falls back from the slash path to the plain path", async () => {
  clearProfileCache();
  const seen = [];
  const base = makeFetch();
  const profile = await lookupSchool({
    ...SCHOOL,
    fetch: async (url, init) => {
      seen.push(String(url));
      if (String(url).endsWith("/getupdir.php/")) throw new Error("slash path down");
      return base(url, init);
    },
  });
  assert.equal(profile.webdir, "0650");
  assert.ok(seen.some((u) => u.endsWith("/getupdir.php/")));
  assert.ok(seen.some((u) => u.endsWith("/getupdir.php")));
});
