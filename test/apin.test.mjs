import assert from "node:assert/strict";
import test from "node:test";
import {
  apinWeekNo,
  countWebdirs,
  getClassTimetable,
  getTeacherTimetable,
  listTeachers,
  lookupSchool,
  normalizeRegion,
  parseListResponse,
  parseLookupResponse,
  parseTimetableResponse,
  resolveWeekStart,
} from "../dist/index.js";

function response(text, ok = true, status = 200) {
  return {
    ok,
    status,
    text: async () => text,
  };
}

function mockFetch(handler) {
  return async (input, init) => handler(String(input), init);
}

test("normalizes Apin region names", () => {
  assert.equal(normalizeRegion("대구광역시"), "대구");
  assert.equal(normalizeRegion("의정부시"), "의정부");
  assert.equal(normalizeRegion("담양군"), "담양");
});

test("parses lookup and list responses", () => {
  assert.deepEqual(parseLookupResponse("1&0650&75&20270220&1"), {
    webPath: "0650",
    expiresAt: "20270220",
  });
  assert.deepEqual(parseListResponse("2&1-1,1-2&1,2,3&정보실&34&"), {
    classLabels: ["1-1", "1-2"],
    teacherLabels: ["1", "2", "3"],
    roomLabels: ["정보실"],
    version: "34",
  });
});

test("computes Apin week number from a week date", () => {
  assert.equal(resolveWeekStart("2026-07-07"), "2026-07-06");
  assert.equal(apinWeekNo("2026-07-06"), 20);
});

test("parses class timetable payload", () => {
  const parsed = parseTimetableResponse(
    "3&7.07 10:29&공통국어1^공통수학1,통합사회1^미술&083009301030        &34&",
    "1-1",
  );
  assert.deepEqual(parsed.periodTimes.slice(0, 3), ["08:30", "09:30", "10:30"]);
  assert.deepEqual(parsed.entries, [
    { weekday: 0, day: "mon", period: 1, subject: "공통국어1", changed: false, classLabel: "1-1" },
    { weekday: 0, day: "mon", period: 2, subject: "공통수학1", changed: false, classLabel: "1-1" },
    { weekday: 1, day: "tue", period: 1, subject: "통합사회1", changed: false, classLabel: "1-1" },
    { weekday: 1, day: "tue", period: 2, subject: "미술", changed: false, classLabel: "1-1" },
  ]);
});

test("parses teacher timetable embedded class labels", () => {
  const parsed = parseTimetableResponse("3&7.07 10:29&공통국어1/1-7^공통수학1/1-2&08300930        &34&");
  assert.deepEqual(parsed.entries.map((entry) => ({ subject: entry.subject, classLabel: entry.classLabel })), [
    { subject: "공통국어1", classLabel: "1-7" },
    { subject: "공통수학1", classLabel: "1-2" },
  ]);
});

test("looks up school and fetches class timetable", async () => {
  const seen = [];
  const fetch = mockFetch((url, init) => {
    seen.push({ url, body: init?.body?.toString() ?? "" });
    if (url.endsWith("/getupdir.php/")) return response("1&0650&75&20270220&1");
    if (url.endsWith("/dnele.php")) return response("2&1-1,1-2&1,2,3&정보실&34&");
    if (url.endsWith("/hbtime.php")) {
      assert.match(init.body.toString(), /webdir=0650/);
      assert.match(init.body.toString(), /hbno=0/);
      assert.match(init.body.toString(), /wkno=20/);
      return response("3&7.07 10:29&공통국어1^공통수학1&08300930        &34&");
    }
    throw new Error(`Unexpected URL ${url}`);
  });

  const week = await getClassTimetable({
    city: "대구",
    schoolName: "학남고등학교",
    grade: 1,
    classNo: 1,
    weekStart: "2026-07-06",
    fetch,
  });

  assert.equal(seen[0].body, "hgsj=%EB%8C%80%EA%B5%AC&hgm=%ED%95%99%EB%82%A8%EA%B3%A0%EB%93%B1%ED%95%99%EA%B5%90");
  assert.equal(week.source, "apin");
  assert.equal(week.entries[0].subject, "공통국어1");
});

test("lists teachers and fetches teacher timetable", async () => {
  const fetch = mockFetch((url, init) => {
    if (url.endsWith("/getupdir.php/")) return response("1&0660&75&20270220&1");
    if (url.endsWith("/dnele.php")) return response("2&1-1,1-2&1,2,3&정보실&34&");
    if (url.endsWith("/gstime.php")) {
      assert.match(init.body.toString(), /gsno=1/);
      return response("3&7.07 10:29&교사국어/1-1^교사수학/1-2&08300930        &34&");
    }
    throw new Error(`Unexpected URL ${url}`);
  });

  const teachers = await listTeachers({ city: "대구", schoolName: "교사테스트고등학교", fetch });
  assert.deepEqual(teachers, [
    { no: 1, label: "1" },
    { no: 2, label: "2" },
    { no: 3, label: "3" },
  ]);

  const week = await getTeacherTimetable({
    city: "대구",
    schoolName: "교사테스트고등학교",
    teacherNo: 2,
    weekStart: "2026-07-06",
    fetch,
  });
  assert.equal(week.teacherNo, 2);
  assert.equal(week.entries[0].classLabel, "1-1");
});

test("counts numeric webdirs", async () => {
  const counted = await countWebdirs({
    fetch: mockFetch(() => response('<a href="0001/">0001/</a><a href="0650/">0650/</a>')),
  });
  assert.equal(counted.webdirCount, 2);
});

test("fallbacks from slash lookup path to plain lookup path", async () => {
  const seen = [];
  const profile = await lookupSchool({
    city: "대구",
    schoolName: "폴백고등학교",
    fetch: mockFetch((url) => {
      seen.push(url);
      if (url.endsWith("/getupdir.php/")) throw new Error("slash path down");
      if (url.endsWith("/getupdir.php")) return response("1&0650&75&20270220&1");
      if (url.endsWith("/dnele.php")) return response("2&1-1&1&정보실&34&");
      throw new Error(`Unexpected URL ${url}`);
    }),
  });
  assert.equal(profile.webPath, "0650");
  assert.deepEqual(seen.slice(0, 2).map((url) => url.split("/").at(-1)), ["", "getupdir.php"]);
});
