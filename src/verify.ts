// Cross-verification bridge.
//
// This is the merge's headline feature: fetch the same target two independent
// ways (dynamic app API and static file) and confirm they agree. It turns the
// comparison the two teachers did by hand into a first-class, structured API.

import { type ClientOptions, type Timetable, apinWeekNo, gridToDayStrings, resolveWeekStart } from "./core.js";
import {
  type ClassTimetableInput,
  type TeacherTimetableInput,
  getClassTimetableDynamic,
  getTeacherTimetableDynamic,
} from "./dynamic.js";
import { getClassTimetableStatic, getTeacherTimetableStatic } from "./static.js";

export interface CrossCheck {
  /** What was compared, e.g. "class 1-1", "teacher 1", "periodTimes". */
  label: string;
  match: boolean;
  dynamic: string[];
  static: string[];
  /** Per-day mismatches, present only when match is false. */
  diff?: { index: number; dynamic: string; static: string }[];
}

export interface CrossVerifyResult {
  city: string;
  schoolName: string;
  webdir: string;
  week: number;
  weekStart: string;
  checkedAt: string;
  allMatch: boolean;
  checks: CrossCheck[];
  summary: string;
}

export interface CrossVerifyInput extends ClientOptions {
  city: string;
  schoolName: string;
  weekStart?: string;
  week?: number;
  /** Class to compare, "grade-classNo" (default "1-1"). */
  classLabel?: string;
  /** Teacher number to compare (default 1). */
  teacherNo?: number;
  /** Compare class timetables (default true). */
  checkClass?: boolean;
  /** Compare teacher timetables (default true). */
  checkTeacher?: boolean;
  /** Compare period start times (default true). */
  checkPeriodTimes?: boolean;
}

function diffStrings(dynamic: string[], staticVals: string[]) {
  const len = Math.max(dynamic.length, staticVals.length);
  const diff: { index: number; dynamic: string; static: string }[] = [];
  for (let i = 0; i < len; i++) {
    const d = dynamic[i] ?? "";
    const s = staticVals[i] ?? "";
    if (d !== s) diff.push({ index: i, dynamic: d, static: s });
  }
  return diff;
}

function compare(label: string, dynamic: string[], staticVals: string[]): CrossCheck {
  const diff = diffStrings(dynamic, staticVals);
  return diff.length === 0
    ? { label, match: true, dynamic, static: staticVals }
    : { label, match: false, dynamic, static: staticVals, diff };
}

/**
 * Fetch a target through both transports and report whether they agree.
 * By default it checks class 1-1, teacher 1, and the period times for the
 * current week. Resolution is cached, so this is a handful of requests.
 */
export async function crossVerify(input: CrossVerifyInput): Promise<CrossVerifyResult> {
  const weekStart = resolveWeekStart(input.weekStart);
  const week = input.week ?? apinWeekNo(weekStart);
  const classLabel = input.classLabel ?? "1-1";
  const teacherNo = input.teacherNo ?? 1;
  const checkClass = input.checkClass ?? true;
  const checkTeacher = input.checkTeacher ?? true;
  const checkPeriodTimes = input.checkPeriodTimes ?? true;

  const [grade, classNo] = classLabel.split("-").map((n) => Number(n));
  const shared: ClientOptions = { fetch: input.fetch, timeoutMs: input.timeoutMs, signal: input.signal };
  const checks: CrossCheck[] = [];
  let webdir = "";
  let periodPair: { dyn: Timetable; sta: Timetable } | null = null;

  if (checkClass) {
    if (!Number.isInteger(grade) || !Number.isInteger(classNo)) {
      throw new Error(`classLabel must look like "1-1", got "${classLabel}".`);
    }
    const classInput: ClassTimetableInput = { ...shared, city: input.city, schoolName: input.schoolName, grade, classNo, week, weekStart };
    const [dyn, sta] = await Promise.all([
      getClassTimetableDynamic(classInput),
      getClassTimetableStatic(classInput),
    ]);
    webdir = dyn.webdir;
    periodPair = { dyn, sta };
    checks.push(compare(`class ${classLabel}`, gridToDayStrings(dyn.grid), gridToDayStrings(sta.grid)));
  }

  if (checkTeacher) {
    const teacherInput: TeacherTimetableInput = { ...shared, city: input.city, schoolName: input.schoolName, teacherNo, week };
    const [dyn, sta] = await Promise.all([
      getTeacherTimetableDynamic(teacherInput),
      getTeacherTimetableStatic(teacherInput),
    ]);
    webdir = webdir || dyn.webdir;
    if (!periodPair) periodPair = { dyn, sta };
    checks.push(compare(`teacher ${teacherNo}`, gridToDayStrings(dyn.grid), gridToDayStrings(sta.grid)));
  }

  if (checkPeriodTimes && periodPair) {
    checks.push(compare("periodTimes", periodPair.dyn.periodTimes, periodPair.sta.periodTimes));
  }

  const allMatch = checks.every((c) => c.match);
  const passed = checks.filter((c) => c.match).length;
  const summary = allMatch
    ? `동적 앱 API와 정적 파일이 ${checks.length}개 항목에서 모두 일치했습니다 (${input.city} ${input.schoolName}, ${week}주차).`
    : `${checks.length}개 중 ${passed}개 일치, ${checks.length - passed}개 불일치 (${input.city} ${input.schoolName}, ${week}주차). 불일치 항목의 diff를 확인하세요.`;

  return {
    city: input.city,
    schoolName: input.schoolName,
    webdir,
    week,
    weekStart,
    checkedAt: new Date().toISOString(),
    allMatch,
    checks,
    summary,
  };
}
