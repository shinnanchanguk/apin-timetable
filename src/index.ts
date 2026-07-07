const APIN_BASE_URL = "http://www.sgpap.com/tm/";
const PROFILE_CACHE_MS = 10 * 60 * 1000;

export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface ClientOptions {
  fetch?: FetchLike;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface SchoolLookupInput extends ClientOptions {
  city: string;
  schoolName: string;
}

export interface TeacherOption {
  no: number;
  label: string;
}

export interface SchoolProfile {
  city: string;
  schoolName: string;
  webPath: string;
  expiresAt: string | null;
  classLabels: string[];
  teacherOptions: TeacherOption[];
  roomLabels: string[];
  version: string;
}

export interface TimetableInput extends SchoolLookupInput {
  weekStart?: string;
}

export interface ClassTimetableInput extends TimetableInput {
  grade: number;
  classNo: number;
}

export interface TeacherTimetableInput extends TimetableInput {
  teacherNo: number;
}

export interface TimetableEntry {
  weekday: number;
  day: "mon" | "tue" | "wed" | "thu" | "fri";
  period: number;
  subject: string;
  changed: boolean;
  classLabel?: string;
}

export interface TimetableWeek {
  source: "apin";
  city: string;
  schoolName: string;
  webPath: string;
  weekStart: string;
  classLabel?: string;
  teacherNo?: number;
  periodTimes: string[];
  entries: TimetableEntry[];
  syncedAt: string;
}

interface ApinList {
  classLabels: string[];
  teacherLabels: string[];
  roomLabels: string[];
  version: string;
}

const profileCache = new Map<string, { at: number; profile: SchoolProfile }>();
const DAYS: TimetableEntry["day"][] = ["mon", "tue", "wed", "thu", "fri"];

function apinUrl(path: string): string {
  return new URL(path, APIN_BASE_URL).toString();
}

function defaultFetch(): FetchLike {
  if (typeof fetch !== "function") {
    throw new Error("global fetch is not available. Use Node.js 18+ or pass options.fetch.");
  }
  return fetch;
}

function timeoutSignal(timeoutMs: number, parent?: AbortSignal): AbortSignal {
  if (!parent) return AbortSignal.timeout(timeoutMs);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  parent.addEventListener(
    "abort",
    () => {
      clearTimeout(timer);
      controller.abort(parent.reason);
    },
    { once: true },
  );
  return controller.signal;
}

async function fetchText(path: string, options: ClientOptions = {}, init: RequestInit = {}): Promise<string> {
  const fetcher = options.fetch ?? defaultFetch();
  const res = await fetcher(apinUrl(path), {
    ...init,
    signal: init.signal ?? timeoutSignal(options.timeoutMs ?? 10_000, options.signal),
  });
  if (!res.ok) throw new Error(`Apin HTTP ${res.status}`);
  return await res.text();
}

async function postApin(path: string, body: Record<string, string>, options: ClientOptions = {}): Promise<string> {
  return await fetchText(path, options, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
    body: new URLSearchParams(body),
  });
}

async function postApinAny(paths: string[], body: Record<string, string>, options: ClientOptions = {}): Promise<string> {
  let lastError: unknown = null;
  for (const path of paths) {
    try {
      const text = await postApin(path, body, options);
      if (text.trim()) return text;
    } catch (e) {
      lastError = e;
    }
  }
  if (lastError instanceof Error) throw lastError;
  throw new Error("Apin server returned an empty response.");
}

export function normalizeRegion(input: string): string {
  const compact = input.trim().replace(/\s+/g, "");
  return compact
    .replace(/특별자치시$/, "")
    .replace(/특별시$/, "")
    .replace(/광역시$/, "")
    .replace(/특례시$/, "")
    .replace(/[시군]$/, "");
}

function splitApinList(value: string | undefined): string[] {
  return String(value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function parseLookupResponse(text: string): { webPath: string; expiresAt: string | null } | null {
  const parts = text.trim().split("&");
  if (parts[0] !== "1" || parts[1] === "nothing") return null;
  const expiresAt = parts[3] || null;
  if (expiresAt && /^\d{8}$/.test(expiresAt)) {
    const today = new Date();
    const ymd = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`;
    if (Number(ymd) > Number(expiresAt)) {
      throw new Error(`Apin subscription expired on ${expiresAt}.`);
    }
  }
  return { webPath: parts[1], expiresAt };
}

export function parseListResponse(text: string): ApinList {
  const parts = text.trim().split("&");
  if (parts[0] !== "2" || parts[1] === "nothing") {
    throw new Error("Apin has no timetable data for this school.");
  }
  return {
    classLabels: splitApinList(parts[1]),
    teacherLabels: splitApinList(parts[2]),
    roomLabels: splitApinList(parts[3]),
    version: parts[4] ?? "",
  };
}

export async function lookupSchool(input: SchoolLookupInput): Promise<SchoolProfile> {
  const city = normalizeRegion(input.city);
  const schoolName = input.schoolName.trim();
  if (!city) throw new Error("city is required.");
  if (!schoolName) throw new Error("schoolName is required.");

  const cacheKey = `${city}:${schoolName}`;
  const cached = profileCache.get(cacheKey);
  if (cached && Date.now() - cached.at < PROFILE_CACHE_MS) return cached.profile;

  const lookup = parseLookupResponse(
    await postApinAny(
      ["getupdir.php/", "getupdir.php"],
      {
        hgsj: city,
        hgm: schoolName,
      },
      input,
    ),
  );
  if (!lookup) throw new Error(`School was not found on Apin: ${city} ${schoolName}`);

  const list = parseListResponse(await postApin("dnele.php", { webdir: lookup.webPath }, input));
  const profile: SchoolProfile = {
    city,
    schoolName,
    webPath: lookup.webPath,
    expiresAt: lookup.expiresAt,
    classLabels: list.classLabels,
    teacherOptions: list.teacherLabels.map((label, idx) => ({ no: idx + 1, label: label || String(idx + 1) })),
    roomLabels: list.roomLabels,
    version: list.version,
  };
  profileCache.set(cacheKey, { at: Date.now(), profile });
  return profile;
}

export async function listTeachers(input: SchoolLookupInput): Promise<TeacherOption[]> {
  return (await lookupSchool(input)).teacherOptions;
}

function parseDate(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error("Date must use YYYY-MM-DD format.");
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid date: ${value}`);
  return date;
}

function mondayOf(date: Date): Date {
  const out = new Date(date);
  const day = out.getDay() || 7;
  out.setDate(out.getDate() + 1 - day);
  out.setHours(0, 0, 0, 0);
  return out;
}

function formatDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function resolveWeekStart(value?: string): string {
  return formatDate(mondayOf(value ? parseDate(value) : new Date()));
}

export function apinWeekNo(weekStart: string): number {
  const monday = mondayOf(parseDate(weekStart));
  const schoolYear = monday.getMonth() < 2 ? monday.getFullYear() - 1 : monday.getFullYear();
  const base = mondayOf(new Date(schoolYear, 2, 1));
  return Math.floor((monday.getTime() - base.getTime()) / 604_800_000) + 1;
}

function parsePeriodTimes(raw: string | undefined): string[] {
  const chunks = String(raw ?? "").match(/\d{4}/g) ?? [];
  return chunks.map((chunk) => `${chunk.slice(0, 2)}:${chunk.slice(2)}`);
}

function cleanSubject(raw: string): string {
  return raw
    .replace(/@[A-Z]/g, "")
    .replace(/[*&]/g, "")
    .replace(/\|/g, " / ")
    .trim()
    .slice(0, 80);
}

function parseSubject(rawSubject: string, classLabel?: string): { subject: string; classLabel?: string } | null {
  let subject = cleanSubject(rawSubject);
  let label = classLabel;
  const embeddedClass = /^(.*)\/(\d+-\d+)$/.exec(subject);
  if (embeddedClass) {
    subject = embeddedClass[1].trim();
    label = embeddedClass[2];
  }
  if (!subject) return null;
  return { subject, classLabel: label };
}

export function parseTimetableResponse(text: string, fallbackClassLabel?: string): Pick<TimetableWeek, "periodTimes" | "entries"> {
  const parts = text.trim().split("&");
  if (parts[1] === "nothing") return { periodTimes: [], entries: [] };
  if (parts[0] !== "3" && parts[0] !== "6") return { periodTimes: [], entries: [] };

  const entries: TimetableEntry[] = [];
  String(parts[2] ?? "")
    .split(",")
    .slice(0, 5)
    .forEach((dayRaw, weekday) => {
      dayRaw.split("^").forEach((rawSubject, idx) => {
        const parsed = parseSubject(rawSubject, fallbackClassLabel);
        if (!parsed) return;
        entries.push({
          weekday,
          day: DAYS[weekday],
          period: idx + 1,
          subject: parsed.subject,
          changed: /@[A-Z]|[&*]/.test(rawSubject),
          classLabel: parsed.classLabel,
        });
      });
    });

  return {
    periodTimes: parsePeriodTimes(parts[3]),
    entries,
  };
}

async function fetchTimetable(input: ClassTimetableInput | TeacherTimetableInput): Promise<TimetableWeek> {
  const profile = await lookupSchool(input);
  const weekStart = resolveWeekStart(input.weekStart);
  const common = {
    webdir: profile.webPath,
    wkno: String(apinWeekNo(weekStart)),
    dayno: "1",
    elever: profile.version,
  };

  let text: string;
  let classLabel: string | undefined;
  let teacherNo: number | undefined;

  if ("teacherNo" in input) {
    teacherNo = input.teacherNo;
    if (!Number.isInteger(teacherNo) || teacherNo < 1 || teacherNo > profile.teacherOptions.length) {
      throw new Error(`teacherNo must be between 1 and ${profile.teacherOptions.length}.`);
    }
    text = await postApin("gstime.php", { ...common, gsno: String(teacherNo - 1) }, input);
  } else {
    if (!Number.isInteger(input.grade) || input.grade < 1) throw new Error("grade must be a positive integer.");
    if (!Number.isInteger(input.classNo) || input.classNo < 1) throw new Error("classNo must be a positive integer.");
    classLabel = `${input.grade}-${input.classNo}`;
    const classIndex = profile.classLabels.findIndex((label) => label === classLabel);
    if (classIndex < 0) throw new Error(`Class was not found on Apin: ${classLabel}`);
    text = await postApin("hbtime.php", { ...common, hbno: String(classIndex) }, input);
  }

  const parsed = parseTimetableResponse(text, classLabel);
  if (parsed.entries.length === 0) throw new Error("Apin returned no timetable entries.");
  return {
    source: "apin",
    city: profile.city,
    schoolName: profile.schoolName,
    webPath: profile.webPath,
    weekStart,
    classLabel,
    teacherNo,
    periodTimes: parsed.periodTimes,
    entries: parsed.entries,
    syncedAt: new Date().toISOString(),
  };
}

export async function getClassTimetable(input: ClassTimetableInput): Promise<TimetableWeek> {
  return await fetchTimetable(input);
}

export async function getTeacherTimetable(input: TeacherTimetableInput): Promise<TimetableWeek> {
  return await fetchTimetable(input);
}

export async function countWebdirs(options: ClientOptions = {}): Promise<{ webdirCount: number; checkedAt: string; note: string }> {
  const html = await fetchText("", options);
  const webdirs = new Set([...html.matchAll(/href="([0-9]{4})\/"/g)].map((match) => match[1]));
  return {
    webdirCount: webdirs.size,
    checkedAt: new Date().toISOString(),
    note: "This counts numeric webdir folders, not an official school-name directory.",
  };
}
