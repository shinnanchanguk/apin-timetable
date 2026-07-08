// Shared core for the Apin timetable client.
//
// Apin (YWTek, 유원테크) exposes school timetables two ways on the same public
// server (http://www.sgpap.com):
//
//   1. Dynamic app-API flow: POST to PHP endpoints (getupdir/dnele/hbtime/gstime),
//      responses are UTF-8. This is what the official mobile app uses.
//   2. Static files: the school folder /tm/<webdir>/ holds plain text files
//      (h/g/t/s<week>.txt) encoded in EUC-KR (CP949), readable without login.
//
// Both paths speak the same timetable cell grammar, so this module keeps a single
// cell parser and a single week-number calculation that both layers share. The
// dynamic layer lives in `dynamic.ts`, the static layer in `static.ts`, and the
// bridge that compares them in `verify.ts`.

export const APIN_BASE = "http://www.sgpap.com";
export const APIN_TM_BASE = `${APIN_BASE}/tm/`;
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024; // guard against an oversized upstream body
export const PROFILE_CACHE_MS = 10 * 60 * 1000;

// ---------------------------------------------------------------------------
// Fetch plumbing (injectable for tests, timeout-aware, encoding-aware)
// ---------------------------------------------------------------------------

export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface ClientOptions {
  /** Inject a fetch implementation (used in tests). Defaults to global fetch. */
  fetch?: FetchLike;
  /** Abort the request if it outlives this budget. Defaults to 10s. */
  timeoutMs?: number;
  /** Caller-provided abort signal, honored alongside the timeout. */
  signal?: AbortSignal;
}

function defaultFetch(): FetchLike {
  if (typeof fetch !== "function") {
    throw new Error("global fetch is not available. Use Node.js 18+ or pass options.fetch.");
  }
  return fetch;
}

async function run(url: string, init: RequestInit, options: ClientOptions): Promise<Response> {
  const fetcher = options.fetch ?? defaultFetch();
  const parent = options.signal;

  // Own the timeout lifecycle here so the timer and the parent-abort listener are
  // always cleaned up in finally, even when the caller passes options.signal.
  // (Otherwise the timer keeps the event loop alive and listeners pile up on a
  // long-lived shared parent signal.)
  let signal = init.signal;
  const controller = signal ? null : new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const onParentAbort = () => controller?.abort(parent?.reason);
  if (controller) {
    signal = controller.signal;
    timer = setTimeout(() => controller.abort(new Error("Apin request timed out")), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    if (parent) {
      if (parent.aborted) controller.abort(parent.reason);
      else parent.addEventListener("abort", onParentAbort, { once: true });
    }
  }

  try {
    const res = await fetcher(url, { ...init, signal });
    if (!res.ok) throw new Error(`Apin HTTP ${res.status} for ${url}`);
    const declared = Number(res.headers?.get?.("content-length") ?? "");
    if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
      throw new Error(`Apin response too large: ${declared} bytes`);
    }
    return res;
  } finally {
    if (timer) clearTimeout(timer);
    if (parent) parent.removeEventListener("abort", onParentAbort);
  }
}

// Keep every request on the Apin origin. `path` is a hardcoded endpoint today,
// but new URL() would silently follow an absolute URL to another host, so pin it.
function tmUrl(path: string): string {
  const u = new URL(path, APIN_TM_BASE);
  if (u.origin !== new URL(APIN_BASE).origin) {
    throw new Error(`Refusing to request a non-Apin origin: ${u.origin}`);
  }
  return u.toString();
}

/** POST a PHP endpoint under /tm/ as form-urlencoded, decode the reply as UTF-8. */
export async function postPhp(
  path: string,
  body: Record<string, string>,
  options: ClientOptions = {},
): Promise<string> {
  const res = await run(
    tmUrl(path),
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
      body: new URLSearchParams(body).toString(),
    },
    options,
  );
  // Korean school names must go out as UTF-8, and PHP replies come back UTF-8.
  return await res.text();
}

/** Try several PHP paths in order, returning the first non-empty reply. */
export async function postPhpAny(
  paths: string[],
  body: Record<string, string>,
  options: ClientOptions = {},
): Promise<string> {
  let lastError: unknown = null;
  for (const path of paths) {
    try {
      const text = await postPhp(path, body, options);
      if (text.trim()) return text;
    } catch (e) {
      lastError = e;
    }
  }
  if (lastError instanceof Error) throw lastError;
  throw new Error("Apin server returned an empty response.");
}

/** Fetch a static school file and decode it from EUC-KR (CP949). */
export async function fetchStatic(
  webdir: string,
  filename: string,
  options: ClientOptions = {},
): Promise<string> {
  const res = await run(
    `${APIN_TM_BASE}${encodeURIComponent(webdir)}/${encodeURIComponent(filename)}`,
    { headers: { "User-Agent": "apin-timetable" } },
    options,
  );
  const buf = Buffer.from(await res.arrayBuffer());
  return new TextDecoder("euc-kr").decode(buf);
}

/** Fetch the raw directory-index HTML for a school folder (or /tm/ root). */
export async function fetchIndexHtml(webdir: string, options: ClientOptions = {}): Promise<string> {
  const path = webdir ? `${encodeURIComponent(webdir)}/` : "";
  const res = await run(`${APIN_TM_BASE}${path}`, { headers: { "User-Agent": "apin-timetable" } }, options);
  return await res.text();
}

// ---------------------------------------------------------------------------
// Shared timetable types (both grid and flat entries, so callers get either)
// ---------------------------------------------------------------------------

export type Weekday = 0 | 1 | 2 | 3 | 4;
export type DayCode = "mon" | "tue" | "wed" | "thu" | "fri";
export const DAY_CODES: DayCode[] = ["mon", "tue", "wed", "thu", "fri"];

/** One timetable slot. `ref` is the class label after "/" in teacher/room files. */
export interface Cell {
  /** Subject with format markers stripped. */
  subject: string;
  /** Linked target after "/": a class label in g/t files, null in class (h) files. */
  ref: string | null;
  /** Original token with markers preserved. */
  raw: string;
  /** True when the slot carried a special marker (`@X`, `&`, `*`). The exact
   * meaning is school-defined and unconfirmed (elective / 분반 / 공강 등으로 추정),
   * so this flags "marked", not necessarily "substituted". */
  marked: boolean;
}

/** A flattened timetable slot, convenient for storage and iteration. */
export interface TimetableEntry {
  weekday: Weekday;
  day: DayCode;
  /** 1-based period number. */
  period: number;
  subject: string;
  ref: string | null;
  marked: boolean;
}

export type TimetableKind = "class" | "teacher" | "room";
export type TimetableSource = "dynamic" | "static";

/**
 * A one-week timetable for a single target. Carries BOTH representations:
 * `grid[day][period]` (good for rendering a table) and `entries[]` (good for
 * iteration and storage). This is the unified shape the dynamic and static
 * layers both produce.
 */
export interface Timetable {
  source: TimetableSource;
  kind: TimetableKind;
  webdir: string;
  /** Apin week number, which is also the h/g/t/s file number. */
  week: number;
  /** The Monday (YYYY-MM-DD) the week starts on, when derived from a date. */
  weekStart?: string;
  city?: string;
  schoolName?: string;
  /** Class label ("1-1"), teacher number ("1"), or room label. */
  target: string;
  periodTimes: string[];
  grid: (Cell | null)[][];
  entries: TimetableEntry[];
  fetchedAt: string;
}

// ---------------------------------------------------------------------------
// Week-number calculation (shared; the dynamic and static layers agree here)
// ---------------------------------------------------------------------------

export function parseDate(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error("Date must use YYYY-MM-DD format.");
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid date: ${value}`);
  return date;
}

/** Normalize a date to the Monday of its week (local midnight). */
export function mondayOf(date: Date): Date {
  const out = new Date(date);
  const day = out.getDay() || 7; // Sunday(0) -> 7
  out.setDate(out.getDate() + 1 - day);
  out.setHours(0, 0, 0, 0);
  return out;
}

export function formatDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** The Monday (YYYY-MM-DD) for a given date string, or today when omitted. */
export function resolveWeekStart(value?: string): string {
  return formatDate(mondayOf(value ? parseDate(value) : new Date()));
}

/** Whole-day difference between two local dates, computed via UTC so a DST
 * transition between them can never add or drop a day (or a week). */
function daysBetween(from: Date, to: Date): number {
  const a = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const b = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((b - a) / 86_400_000);
}

/**
 * Apin week number (= the h/g/t/s file number) for a date.
 *
 * The school year starts in March, and week 1 is the week containing March 1.
 * We pick the school year by comparing the date's Monday to this calendar year's
 * week-1 Monday (whole-day arithmetic, so it is timezone/DST-independent and the
 * week-1 boundary stays continuous even when March 1 is not a Monday).
 * Verified: apinWeekNo("2026-07-06") === 20, and h20.txt === hbtime.php wkno=20.
 */
export function apinWeekNo(dateOrWeekStart: string | Date = new Date()): number {
  const monday = mondayOf(typeof dateOrWeekStart === "string" ? parseDate(dateOrWeekStart) : dateOrWeekStart);
  let base = mondayOf(new Date(monday.getFullYear(), 2, 1)); // March = month index 2
  if (daysBetween(base, monday) < 0) base = mondayOf(new Date(monday.getFullYear() - 1, 2, 1));
  return Math.floor(daysBetween(base, monday) / 7) + 1;
}

/** Alias matching the colleague parser's name. Same calculation as apinWeekNo. */
export const weekNoFromDate = apinWeekNo;

// ---------------------------------------------------------------------------
// Response + cell parsing (shared cell grammar for both transports)
// ---------------------------------------------------------------------------

/** Strip region suffixes so "대구광역시" and "담양군" match the app convention. */
export function normalizeRegion(input: string): string {
  return input
    .trim()
    .replace(/\s+/g, "")
    .replace(/특별자치시$/, "")
    .replace(/특별시$/, "")
    .replace(/광역시$/, "")
    .replace(/특례시$/, "")
    .replace(/[시군]$/, "");
}

function splitCsv(value: string | undefined): string[] {
  return String(value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export interface LookupResult {
  webdir: string;
  /** yyyymmdd field; meaning unconfirmed (subscription end or week anchor). */
  date: string | null;
}

/**
 * Parse a getupdir.php reply.
 *   miss : "1&nothing"
 *   hit  : "1&<webdir>&<num>&<yyyymmdd>&1"   e.g. "1&0650&75&20270220&1"
 * Returns null on a miss.
 */
export function parseLookupResponse(text: string): LookupResult | null {
  const parts = text.trim().split("&");
  if (parts[0] !== "1" || parts[1] === "nothing" || !parts[1]) return null;
  return { webdir: parts[1], date: parts[3] || null };
}

export interface ElementList {
  classLabels: string[];
  teacherNumbers: string[];
  roomLabels: string[];
  version: string;
}

/** Base school profile shared by the dynamic and static layers. */
export interface SchoolProfileBase extends ElementList {
  webdir: string;
  /** yyyymmdd field from getupdir; meaning unconfirmed, kept for reference only. */
  date: string | null;
}

/**
 * Parse a dnele.php reply.
 *   "2&<classes>&<teacherNumbers>&<rooms>&<version>&"
 * Fields verified on 학남고 0650: 27 classes, 54 teacher NUMBERS (not names),
 * rooms, then version.
 */
export function parseElementList(text: string): ElementList {
  const parts = text.trim().split("&");
  if (parts[0] !== "2" || parts[1] === "nothing") {
    throw new Error("Apin has no timetable list for this school.");
  }
  return {
    classLabels: splitCsv(parts[1]),
    teacherNumbers: splitCsv(parts[2]),
    roomLabels: splitCsv(parts[3]),
    version: parts[4] ?? "",
  };
}

const MARKER = /@[A-Za-z]|[*&]/;

/** Remove format markers but note that the slot carried one. */
function cleanSubject(raw: string): string {
  return raw
    .replace(/@[A-Za-z]/g, "")
    .replace(/[*&]/g, "")
    .trim();
}

/**
 * Parse one timetable cell.
 *   ""            -> null (free period)
 *   "과목"        -> { subject, ref: null }
 *   "과목/1-7"    -> { subject, ref: "1-7" }   (ref is a class label in g/t files)
 *   "@B동아@K"    -> { subject: "동아", marked: true }
 * `raw` keeps the original token; `marked` is true when a marker was present
 * (its meaning is school-defined and unconfirmed, not necessarily a substitution).
 */
export function parseCell(raw: string): Cell | null {
  if (raw == null || raw === "") return null;
  const cleaned = cleanSubject(raw);
  if (!cleaned) return null;
  const slash = cleaned.indexOf("/");
  const subject = slash >= 0 ? cleaned.slice(0, slash).trim() : cleaned;
  const ref = slash >= 0 ? cleaned.slice(slash + 1).trim() || null : null;
  if (!subject) return null;
  return { subject, ref, raw, marked: MARKER.test(raw) };
}

/** Build a [day][period] grid from an array of day strings ("^"-separated). */
export function parseDaysToGrid(dayStrings: string[]): (Cell | null)[][] {
  return dayStrings.slice(0, 5).map((day) => day.split("^").map(parseCell));
}

/**
 * Parse a static timetable file body (h/g/t) into rows[target][day][period].
 * Each non-empty line is one target's full week.
 */
export function parseGrid(text: string, opts: { dropTrailingEmptyDay?: boolean } = {}): (Cell | null)[][][] {
  const { dropTrailingEmptyDay = true } = opts;
  return text
    .split(/\r?\n/)
    .filter((line) => line.length > 0)
    .map((line) => {
      let days = line.split(",");
      if (dropTrailingEmptyDay) {
        while (days.length > 1 && days[days.length - 1] === "") days.pop();
      }
      return days.map((day) => day.split("^").map(parseCell));
    });
}

/** Flatten a [day][period] grid into entries, dropping free periods. */
export function gridToEntries(grid: (Cell | null)[][]): TimetableEntry[] {
  const entries: TimetableEntry[] = [];
  grid.slice(0, 5).forEach((day, weekday) => {
    day.forEach((cell, idx) => {
      if (!cell) return;
      entries.push({
        weekday: weekday as Weekday,
        day: DAY_CODES[weekday],
        period: idx + 1,
        subject: cell.subject,
        ref: cell.ref,
        marked: cell.marked,
      });
    });
  });
  return entries;
}

/**
 * Parse a period-start-times string (s<N>.txt, or the app time field).
 * Format: "HHMM" chunks repeated per weekday, separated by whitespace.
 *   "0830093010301130132014201520   0830..." -> ["08:30","09:30",...]
 */
export function parsePeriodTimes(text: string | undefined): string[] {
  const firstDay = String(text ?? "").trim().split(/\s+/)[0] || "";
  const chunks = firstDay.match(/\d{4}/g) ?? [];
  return chunks.map((c) => `${c.slice(0, 2)}:${c.slice(2)}`);
}

/** Convert a grid to per-day "^"-joined raw strings, trimmed of trailing blanks.
 * Capped at 5 weekdays to match the dynamic layer (which slices to Mon–Fri), so
 * a stray 6th column in a static file can't cause a spurious crossVerify diff. */
export function gridToDayStrings(grid: (Cell | null)[][]): string[] {
  const days = grid.slice(0, 5).map((day) => {
    const tokens = day.map((c) => (c ? c.raw : ""));
    while (tokens.length > 1 && tokens[tokens.length - 1] === "") tokens.pop();
    return tokens.join("^");
  });
  while (days.length > 1 && days[days.length - 1] === "") days.pop();
  return days;
}
