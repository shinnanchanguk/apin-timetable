// Pure parsing + week math. No network. Also proves EUC-KR decoding on real bytes.
import assert from "node:assert/strict";
import test from "node:test";
import {
  apinWeekNo,
  fetchStatic,
  gridToDayStrings,
  gridToEntries,
  normalizeRegion,
  parseCell,
  parseDaysToGrid,
  parseElementList,
  parseGrid,
  parseLookupResponse,
  parsePeriodTimes,
  resolveWeekStart,
  weekNoFromDate,
} from "../dist/index.js";

test("normalizes Apin region names", () => {
  assert.equal(normalizeRegion("대구광역시"), "대구");
  assert.equal(normalizeRegion("의정부시"), "의정부");
  assert.equal(normalizeRegion("담양군"), "담양");
  assert.equal(normalizeRegion(" 세종특별자치시 "), "세종");
});

test("parses lookup and element-list responses", () => {
  assert.deepEqual(parseLookupResponse("1&0650&75&20270220&1"), { webdir: "0650", date: "20270220" });
  assert.equal(parseLookupResponse("1&nothing"), null);
  assert.deepEqual(parseElementList("2&1-1,1-2&1,2,3&정보실&34&"), {
    classLabels: ["1-1", "1-2"],
    teacherNumbers: ["1", "2", "3"],
    roomLabels: ["정보실"],
    version: "34",
  });
});

test("parses one cell, keeping raw and flagging special markers", () => {
  assert.equal(parseCell(""), null);
  assert.deepEqual(parseCell("국어"), { subject: "국어", ref: null, raw: "국어", marked: false });
  assert.deepEqual(parseCell("공통국어1/1-7"), { subject: "공통국어1", ref: "1-7", raw: "공통국어1/1-7", marked: false });
  assert.equal(parseCell("@B동아@K").subject, "동아");
  assert.equal(parseCell("@B동아@K").marked, true);
  assert.equal(parseCell("*진로").subject, "진로");
  assert.equal(parseCell("수학*").marked, true);
});

test("parses a static grid: comma = weekday, caret = period", () => {
  const rows = parseGrid("국어^^수학,^체육^^,");
  assert.equal(rows.length, 1);
  const [week] = rows;
  assert.equal(week.length, 2, "trailing empty weekday dropped");
  assert.equal(week[0][0].subject, "국어");
  assert.equal(week[0][1], null);
  assert.equal(week[0][2].subject, "수학");
  assert.equal(week[1][1].subject, "체육");

  const multi = parseGrid("국어,수학\n영어,과학");
  assert.equal(multi.length, 2);
  assert.equal(multi[1][0][0].subject, "영어");
});

test("dynamic day strings and static grid land on the same shape", () => {
  const dyn = parseDaysToGrid("MATH^ENG,SCI^,".split(","));
  const sta = parseGrid("MATH^ENG,SCI^,,")[0];
  assert.deepEqual(gridToDayStrings(dyn), ["MATH^ENG", "SCI"]);
  assert.deepEqual(gridToDayStrings(dyn), gridToDayStrings(sta));
});

test("flattens a grid into entries with ref and period", () => {
  const grid = parseDaysToGrid("국어^수학,체육/1-2^".split(","));
  const entries = gridToEntries(grid);
  assert.deepEqual(entries, [
    { weekday: 0, day: "mon", period: 1, subject: "국어", ref: null, marked: false },
    { weekday: 0, day: "mon", period: 2, subject: "수학", ref: null, marked: false },
    { weekday: 1, day: "tue", period: 1, subject: "체육", ref: "1-2", marked: false },
  ]);
});

test("parses period start times from an s-file string", () => {
  assert.deepEqual(parsePeriodTimes("0830093010301130132014201520        0830093010301130132014201520"), [
    "08:30",
    "09:30",
    "10:30",
    "11:30",
    "13:20",
    "14:20",
    "15:20",
  ]);
  assert.deepEqual(parsePeriodTimes(""), []);
});

test("computes Apin week number (timezone-safe; weekNoFromDate is the same)", () => {
  assert.equal(resolveWeekStart("2026-07-07"), "2026-07-06");
  assert.equal(apinWeekNo("2026-07-06"), 20);
  assert.equal(weekNoFromDate("2026-07-06"), 20);
  assert.equal(weekNoFromDate("2026-06-29"), 19);
});

test("week 1 is the week containing March 1 and stays continuous", () => {
  assert.equal(apinWeekNo("2026-02-23"), 1); // Monday of the week containing Mar 1
  assert.equal(apinWeekNo("2026-03-01"), 1); // Sunday in that same week
  assert.equal(apinWeekNo("2026-03-02"), 2); // the next Monday
  assert.equal(apinWeekNo("2026-02-16"), 52); // prior week = last week of the previous school year
});

test("fetchStatic decodes real EUC-KR bytes (가각) into Korean", async () => {
  // 0xB0A1 = '가', 0xB0A2 = '각' in EUC-KR/CP949. No encoder needed to prove decode.
  const bytes = Uint8Array.from([0xb0, 0xa1, 0xb0, 0xa2]);
  const text = await fetchStatic("0000", "h1.txt", {
    fetch: async () => ({ ok: true, status: 200, arrayBuffer: async () => bytes.buffer }),
  });
  assert.equal(text, "가각");
});
