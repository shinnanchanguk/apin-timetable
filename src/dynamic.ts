// Dynamic app-API layer.
//
// This mirrors what the official Apin mobile app does: POST form-urlencoded
// requests to the PHP endpoints and read UTF-8 replies. School resolution
// (getupdir/dnele) lives here because both the dynamic and static layers rely
// on it to turn a (region, school name) into a webdir plus class/teacher lists.

import {
  type ClientOptions,
  type SchoolProfileBase,
  type Timetable,
  type TimetableKind,
  PROFILE_CACHE_MS,
  apinWeekNo,
  fetchIndexHtml,
  gridToEntries,
  normalizeRegion,
  parseDaysToGrid,
  parseElementList,
  parseLookupResponse,
  parsePeriodTimes,
  postPhp,
  postPhpAny,
  resolveWeekStart,
} from "./core.js";

export interface TeacherOption {
  no: number;
  label: string;
}

export interface SchoolProfile extends SchoolProfileBase {
  city: string;
  schoolName: string;
  /** Teacher entries as {no, label}; label is the teacher number string. */
  teacherOptions: TeacherOption[];
}

export interface SchoolLookupInput extends ClientOptions {
  city: string;
  schoolName: string;
}

export interface TimetableInput extends SchoolLookupInput {
  /** Any date in the target week (YYYY-MM-DD). Defaults to today. */
  weekStart?: string;
  /** Apin week number directly, overriding weekStart. */
  week?: number;
}

export interface ClassTimetableInput extends TimetableInput {
  grade: number;
  classNo: number;
}

export interface TeacherTimetableInput extends TimetableInput {
  teacherNo: number;
}

const PROFILE_CACHE_MAX = 200;
const profileCache = new Map<string, { at: number; profile: SchoolProfile }>();

/** Resolve a school folder id (webdir) from region + exact registered name. */
export async function resolveSchool(
  city: string,
  schoolName: string,
  options: ClientOptions = {},
): Promise<{ webdir: string; date: string | null } | null> {
  const lookup = parseLookupResponse(
    await postPhpAny(
      ["getupdir.php/", "getupdir.php"],
      { hgsj: normalizeRegion(city), hgm: schoolName.trim() },
      options,
    ),
  );
  return lookup;
}

/** Read the base lists (classes, teacher numbers, rooms, version) via dnele.php. */
export async function getElements(webdir: string, options: ClientOptions = {}) {
  return parseElementList(await postPhp("dnele.php", { webdir }, options));
}

/**
 * Resolve a school and its base lists in one call, with a short-lived cache.
 * Note: the yyyymmdd `date` field is exposed as-is and never used to hard-fail,
 * because its meaning (subscription end vs week anchor) is unconfirmed.
 */
export async function lookupSchool(input: SchoolLookupInput): Promise<SchoolProfile> {
  const city = normalizeRegion(input.city);
  const schoolName = input.schoolName.trim();
  if (!city) throw new Error("city is required.");
  if (!schoolName) throw new Error("schoolName is required.");

  const cacheKey = `${city}:${schoolName}`;
  const cached = profileCache.get(cacheKey);
  if (cached && Date.now() - cached.at < PROFILE_CACHE_MS) return cached.profile;

  const lookup = await resolveSchool(city, schoolName, input);
  if (!lookup) throw new Error(`School was not found on Apin: ${city} ${schoolName}`);

  const list = await getElements(lookup.webdir, input);
  const profile: SchoolProfile = {
    city,
    schoolName,
    webdir: lookup.webdir,
    date: lookup.date,
    classLabels: list.classLabels,
    teacherNumbers: list.teacherNumbers,
    teacherOptions: list.teacherNumbers.map((label, idx) => ({ no: idx + 1, label: label || String(idx + 1) })),
    roomLabels: list.roomLabels,
    version: list.version,
  };
  if (profileCache.size >= PROFILE_CACHE_MAX) {
    const oldest = profileCache.keys().next().value;
    if (oldest !== undefined) profileCache.delete(oldest);
  }
  profileCache.set(cacheKey, { at: Date.now(), profile });
  return profile;
}

/** @internal exposed for tests. */
export function clearProfileCache(): void {
  profileCache.clear();
}

export async function listTeachers(input: SchoolLookupInput): Promise<TeacherOption[]> {
  return (await lookupSchool(input)).teacherOptions;
}

/** Parse an hbtime/gstime reply into day strings + period times. */
function parseTimetablePhp(text: string): { dayStrings: string[]; periodTimes: string[] } {
  const parts = text.trim().split("&");
  if (parts[1] === "nothing" || (parts[0] !== "3" && parts[0] !== "6")) {
    return { dayStrings: [], periodTimes: [] };
  }
  return {
    dayStrings: String(parts[2] ?? "").split(","),
    periodTimes: parsePeriodTimes(parts[3]),
  };
}

function weekOf(input: TimetableInput): { week: number; weekStart: string } {
  const weekStart = resolveWeekStart(input.weekStart);
  return { week: input.week ?? apinWeekNo(weekStart), weekStart };
}

async function fetchDynamic(input: ClassTimetableInput | TeacherTimetableInput): Promise<Timetable> {
  const profile = await lookupSchool(input);
  const { week, weekStart } = weekOf(input);
  const common = { webdir: profile.webdir, wkno: String(week), dayno: "1", elever: profile.version };

  let text: string;
  let target: string;
  let kind: TimetableKind;

  if ("teacherNo" in input) {
    const teacherNo = input.teacherNo;
    if (!Number.isInteger(teacherNo) || teacherNo < 1 || teacherNo > profile.teacherOptions.length) {
      throw new Error(`teacherNo must be between 1 and ${profile.teacherOptions.length}.`);
    }
    kind = "teacher";
    target = String(teacherNo);
    text = await postPhp("gstime.php", { ...common, gsno: String(teacherNo - 1) }, input);
  } else {
    if (!Number.isInteger(input.grade) || input.grade < 1) throw new Error("grade must be a positive integer.");
    if (!Number.isInteger(input.classNo) || input.classNo < 1) throw new Error("classNo must be a positive integer.");
    kind = "class";
    target = `${input.grade}-${input.classNo}`;
    const classIndex = profile.classLabels.indexOf(target);
    if (classIndex < 0) throw new Error(`Class was not found on Apin: ${target}`);
    text = await postPhp("hbtime.php", { ...common, hbno: String(classIndex) }, input);
  }

  const { dayStrings, periodTimes } = parseTimetablePhp(text);
  const grid = parseDaysToGrid(dayStrings);
  const entries = gridToEntries(grid);
  if (entries.length === 0) throw new Error("Apin returned no timetable entries.");

  return {
    source: "dynamic",
    kind,
    webdir: profile.webdir,
    week,
    weekStart,
    city: profile.city,
    schoolName: profile.schoolName,
    target,
    periodTimes,
    grid,
    entries,
    fetchedAt: new Date().toISOString(),
  };
}

/** Fetch a class timetable through the app API (hbtime.php). */
export async function getClassTimetableDynamic(input: ClassTimetableInput): Promise<Timetable> {
  return fetchDynamic(input);
}

/** Fetch a teacher timetable through the app API (gstime.php). */
export async function getTeacherTimetableDynamic(input: TeacherTimetableInput): Promise<Timetable> {
  return fetchDynamic(input);
}

/** Count numeric webdir folders on /tm/ (server folder count, not a school directory). */
export async function countWebdirs(
  options: ClientOptions = {},
): Promise<{ webdirCount: number; checkedAt: string; note: string }> {
  const html = await fetchIndexHtml("", options);
  const webdirs = new Set([...html.matchAll(/href="([0-9]{4})\/"/g)].map((m) => m[1]));
  return {
    webdirCount: webdirs.size,
    checkedAt: new Date().toISOString(),
    note: "Counts numeric webdir folders, not an official school-name directory.",
  };
}
