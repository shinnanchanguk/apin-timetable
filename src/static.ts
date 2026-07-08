// Static-file layer (ported from 박준일 pblsketch's appin-timetable-parser).
//
// Instead of asking the PHP endpoints, this reads the plain text files the
// school folder publishes under /tm/<webdir>/:
//   h<week>.txt = class timetables    (one line per class,   like hbtime.php)
//   g<week>.txt = teacher timetables  (one line per teacher, like gstime.php)
//   t<week>.txt = special-room timetables (one line per room)
//   s<week>.txt = period start times  ("HHMM" repeated per weekday)
// File mapping verified 2026-07-07 on 대구 학남고 0650 and cross-checked against
// the dynamic app API. These files are EUC-KR; core.fetchStatic decodes them.
//
// Rooms (t) and period times (s) are things the dynamic app API does not surface
// cleanly, so the static layer is the source of truth for those.

import {
  type ClientOptions,
  type Cell,
  type Timetable,
  type TimetableKind,
  apinWeekNo,
  fetchIndexHtml,
  fetchStatic,
  gridToEntries,
  parseGrid,
  parsePeriodTimes,
  resolveWeekStart,
} from "./core.js";
import { type SchoolProfile, lookupSchool } from "./dynamic.js";

export interface FileEntry {
  name: string;
  modified: Date | null;
  size: string;
}

/** Find a label's line index (class labels like "2-3", teacher numbers like "1"). */
export function indexOfLabel(labels: string[], label: string): number {
  return labels.indexOf(label);
}

/** Fetch and parse a whole static timetable file into rows[target][day][period]. */
export async function getStaticFile(
  webdir: string,
  filename: string,
  options: ClientOptions = {},
): Promise<{ filename: string; rows: (Cell | null)[][][]; text: string }> {
  const text = await fetchStatic(webdir, filename, options);
  return { filename, rows: parseGrid(text), text };
}

/** One class's week from h<week>.txt (low-level; row grid [day][period]). */
export async function getStaticClassRow(
  webdir: string,
  week: number | string,
  classIndex: number,
  options: ClientOptions = {},
): Promise<(Cell | null)[][] | null> {
  const { rows } = await getStaticFile(webdir, `h${week}.txt`, options);
  return rows[classIndex] || null;
}

/** One teacher's week from g<week>.txt (low-level; cell.ref is the class label). */
export async function getStaticTeacherRow(
  webdir: string,
  week: number | string,
  teacherIndex: number,
  options: ClientOptions = {},
): Promise<(Cell | null)[][] | null> {
  const { rows } = await getStaticFile(webdir, `g${week}.txt`, options);
  return rows[teacherIndex] || null;
}

/** One room's week from t<week>.txt (low-level; cell.ref is the class label). */
export async function getStaticRoomRow(
  webdir: string,
  week: number | string,
  roomIndex = 0,
  options: ClientOptions = {},
): Promise<(Cell | null)[][] | null> {
  const { rows } = await getStaticFile(webdir, `t${week}.txt`, options);
  return rows[roomIndex] || null;
}

/** Period start times from s<week>.txt, e.g. ["08:30","09:30",...]. */
export async function getStaticPeriodTimes(
  webdir: string,
  week: number | string,
  options: ClientOptions = {},
): Promise<string[]> {
  return parsePeriodTimes(await fetchStatic(webdir, `s${week}.txt`, options));
}

/** Parse the school folder directory index with modified date + size. */
export async function listFilesDetailed(webdir: string, options: ClientOptions = {}): Promise<FileEntry[]> {
  const html = await fetchIndexHtml(webdir, options);
  const out: FileEntry[] = [];
  const re =
    /<a href="([^"?/][^"]*\.[a-zA-Z0-9]+)">[^<]*<\/a>\s*<\/td>\s*<td[^>]*>\s*(\d{4}-\d{2}-\d{2} \d{2}:\d{2})?\s*<\/td>\s*<td[^>]*>\s*([\d.kKMGB-]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    out.push({
      name: m[1],
      modified: m[2] ? new Date(m[2].replace(" ", "T") + ":00") : null,
      size: m[3],
    });
  }
  return out;
}

/** File names only, e.g. ["ele.txt","h20.txt","g20.txt","s20.txt", ...]. */
export async function listFiles(webdir: string, options: ClientOptions = {}): Promise<string[]> {
  return (await listFilesDetailed(webdir, options)).map((e) => e.name);
}

function pickWeekByUpdate(entries: FileEntry[], asOf: Date): number | null {
  const hs = entries
    .filter((e) => /^h\d+\.txt$/.test(e.name) && e.modified && e.modified <= asOf)
    .map((e) => ({ n: Number(e.name.slice(1, e.name.indexOf("."))), modified: e.modified as Date }));
  if (!hs.length) return null;
  hs.sort((a, b) => b.modified.getTime() - a.modified.getTime() || b.n - a.n);
  return hs[0].n;
}

/**
 * Current week from the newest h<N>.txt modified date (cross-check only).
 * Can wobble to a future week if the school updates next week's file early, so
 * prefer apinWeekNo (date math) as the default and use this to double-check.
 */
export async function currentWeekByUpdate(
  webdir: string,
  options: ClientOptions & { asOf?: Date } = {},
): Promise<number | null> {
  return pickWeekByUpdate(await listFilesDetailed(webdir, options), options.asOf ?? new Date());
}

/**
 * Resolve current-week estimates for a school: the date-math default plus the
 * file-modified cross-check, and how many weekly files exist.
 */
export async function estimateCurrentWeek(
  city: string,
  schoolName: string,
  options: ClientOptions & { asOf?: Date } = {},
): Promise<{ webdir: string; week: number; weekByUpdate: number | null; totalWeeks: number; date: string | null } | null> {
  const profile = await lookupSchool({ ...options, city, schoolName });
  const files = await listFilesDetailed(profile.webdir, options);
  const asOf = options.asOf ?? new Date();
  return {
    webdir: profile.webdir,
    week: apinWeekNo(asOf),
    weekByUpdate: pickWeekByUpdate(files, asOf),
    totalWeeks: files.filter((f) => /^h\d+\.txt$/.test(f.name)).length,
    date: profile.date,
  };
}

// ---------------------------------------------------------------------------
// High-level static reads that return the unified Timetable (grid + entries)
// ---------------------------------------------------------------------------

function buildTimetable(args: {
  kind: TimetableKind;
  profile: SchoolProfile;
  week: number;
  weekStart?: string;
  target: string;
  grid: (Cell | null)[][];
  periodTimes: string[];
}): Timetable {
  return {
    source: "static",
    kind: args.kind,
    webdir: args.profile.webdir,
    week: args.week,
    weekStart: args.weekStart,
    city: args.profile.city,
    schoolName: args.profile.schoolName,
    target: args.target,
    periodTimes: args.periodTimes,
    grid: args.grid,
    entries: gridToEntries(args.grid),
    fetchedAt: new Date().toISOString(),
  };
}

export interface StaticClassInput extends ClientOptions {
  city: string;
  schoolName: string;
  grade: number;
  classNo: number;
  weekStart?: string;
  week?: number;
}

export interface StaticTeacherInput extends ClientOptions {
  city: string;
  schoolName: string;
  teacherNo: number;
  weekStart?: string;
  week?: number;
}

export interface StaticRoomInput extends ClientOptions {
  city: string;
  schoolName: string;
  /** 0-based room index (default 0); or a room label from profile.roomLabels. */
  roomIndex?: number;
  roomLabel?: string;
  weekStart?: string;
  week?: number;
}

function resolveWeek(input: { week?: number; weekStart?: string }): { week: number; weekStart: string } {
  // Resolve to a concrete Monday string, matching the dynamic layer's weekOf(),
  // so the unified Timetable's weekStart field is consistent across both sources.
  const weekStart = resolveWeekStart(input.weekStart);
  return { week: input.week ?? apinWeekNo(weekStart), weekStart };
}

/** Class timetable via the static h-file, returned as a unified Timetable. */
export async function getClassTimetableStatic(input: StaticClassInput): Promise<Timetable> {
  const profile = await lookupSchool(input);
  const target = `${input.grade}-${input.classNo}`;
  const classIndex = profile.classLabels.indexOf(target);
  if (classIndex < 0) throw new Error(`Class was not found on Apin: ${target}`);
  const { week, weekStart } = resolveWeek(input);
  const grid = await getStaticClassRow(profile.webdir, week, classIndex, input);
  if (!grid) throw new Error(`No static class timetable for ${target} in h${week}.txt`);
  const periodTimes = await getStaticPeriodTimes(profile.webdir, week, input).catch(() => []);
  return buildTimetable({ kind: "class", profile, week, weekStart, target, grid, periodTimes });
}

/** Teacher timetable via the static g-file, returned as a unified Timetable. */
export async function getTeacherTimetableStatic(input: StaticTeacherInput): Promise<Timetable> {
  const profile = await lookupSchool(input);
  if (!Number.isInteger(input.teacherNo) || input.teacherNo < 1 || input.teacherNo > profile.teacherNumbers.length) {
    throw new Error(`teacherNo must be between 1 and ${profile.teacherNumbers.length}.`);
  }
  const { week, weekStart } = resolveWeek(input);
  const grid = await getStaticTeacherRow(profile.webdir, week, input.teacherNo - 1, input);
  if (!grid) throw new Error(`No static teacher timetable for teacher ${input.teacherNo} in g${week}.txt`);
  const periodTimes = await getStaticPeriodTimes(profile.webdir, week, input).catch(() => []);
  return buildTimetable({ kind: "teacher", profile, week, weekStart, target: String(input.teacherNo), grid, periodTimes });
}

/** Room (special-room) timetable via the static t-file. Static-only capability. */
export async function getRoomTimetable(input: StaticRoomInput): Promise<Timetable> {
  const profile = await lookupSchool(input);
  let roomIndex = input.roomIndex ?? 0;
  if (input.roomLabel) {
    const found = profile.roomLabels.indexOf(input.roomLabel);
    if (found < 0) throw new Error(`Room was not found on Apin: ${input.roomLabel}`);
    roomIndex = found;
  }
  const { week, weekStart } = resolveWeek(input);
  const grid = await getStaticRoomRow(profile.webdir, week, roomIndex, input);
  if (!grid) throw new Error(`No static room timetable at index ${roomIndex} in t${week}.txt`);
  const periodTimes = await getStaticPeriodTimes(profile.webdir, week, input).catch(() => []);
  const target = profile.roomLabels[roomIndex] || String(roomIndex);
  return buildTimetable({ kind: "room", profile, week, weekStart, target, grid, periodTimes });
}
