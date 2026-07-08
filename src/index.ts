// apin-timetable — unified client for the Apin (YWTek) school timetable server.
//
// Two layers, one package:
//   - dynamic: the app API flow (getupdir/dnele/hbtime/gstime), the default.
//   - static:  the published school files (h/g/t/s<week>.txt), for rooms,
//              period times, and offline-style reads.
// Plus crossVerify() to confirm the two agree. See docs/병합-이야기.md for the
// story of how this was merged from two teachers' projects.

export * from "./core.js";
export * from "./dynamic.js";
export * from "./static.js";
export * from "./verify.js";

import type { Timetable } from "./core.js";
import {
  type ClassTimetableInput,
  type TeacherTimetableInput,
  getClassTimetableDynamic,
  getTeacherTimetableDynamic,
} from "./dynamic.js";
import { getClassTimetableStatic, getTeacherTimetableStatic } from "./static.js";

export type TimetableMode = "dynamic" | "static";

/**
 * Fetch a class timetable. Defaults to the dynamic app API; pass
 * `mode: "static"` to read the published h-file instead. Both return the same
 * unified Timetable (grid + entries), so callers can switch transports freely.
 */
export async function getClassTimetable(input: ClassTimetableInput & { mode?: TimetableMode }): Promise<Timetable> {
  return input.mode === "static" ? getClassTimetableStatic(input) : getClassTimetableDynamic(input);
}

/**
 * Fetch a teacher timetable. Defaults to the dynamic app API; pass
 * `mode: "static"` to read the published g-file instead.
 */
export async function getTeacherTimetable(input: TeacherTimetableInput & { mode?: TimetableMode }): Promise<Timetable> {
  return input.mode === "static" ? getTeacherTimetableStatic(input) : getTeacherTimetableDynamic(input);
}
