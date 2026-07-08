// crossVerify: the two transports must agree, and disagreement must be reported.
import assert from "node:assert/strict";
import test from "node:test";
import { clearProfileCache, crossVerify } from "../dist/index.js";
import { makeFetch } from "./apin-fixture.mjs";

const SCHOOL = { city: "대구", schoolName: "학남고등학교" };

test("crossVerify reports allMatch when dynamic and static agree", async () => {
  clearProfileCache();
  const result = await crossVerify({ ...SCHOOL, week: 20, fetch: makeFetch() });
  assert.equal(result.allMatch, true);
  assert.equal(result.webdir, "0650");
  const labels = result.checks.map((c) => c.label);
  assert.deepEqual(labels, ["class 1-1", "teacher 1", "periodTimes"]);
  for (const check of result.checks) assert.equal(check.match, true, `${check.label} should match`);
});

test("crossVerify surfaces a diff when the static file disagrees", async () => {
  clearProfileCache();
  // Bend only the static class file so Monday period 1 differs from the app API.
  const fetch = makeFetch({ static: { "h20.txt": "WRONG^ENG,SCI^,,\nART^PE,MUS^,,\n" } });
  const result = await crossVerify({ ...SCHOOL, week: 20, checkTeacher: false, fetch });
  assert.equal(result.allMatch, false);
  const classCheck = result.checks.find((c) => c.label === "class 1-1");
  assert.equal(classCheck.match, false);
  assert.equal(classCheck.diff[0].index, 0);
  assert.equal(classCheck.dynamic[0], "MATH^ENG");
  assert.equal(classCheck.static[0], "WRONG^ENG");
});

test("crossVerify honors classLabel and can skip checks", async () => {
  clearProfileCache();
  const result = await crossVerify({ ...SCHOOL, week: 20, classLabel: "1-2", checkTeacher: false, checkPeriodTimes: false, fetch: makeFetch() });
  assert.equal(result.checks.length, 1);
  assert.equal(result.checks[0].label, "class 1-2");
  assert.equal(result.allMatch, true);
});
