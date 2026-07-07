#!/usr/bin/env node
import {
  countWebdirs,
  getClassTimetable,
  getTeacherTimetable,
  listTeachers,
  lookupSchool,
} from "./index.js";

type Flags = Record<string, string | boolean>;

function parseFlags(argv: string[]): { command: string; flags: Flags } {
  const [command = "help", ...rest] = argv;
  const flags: Flags = {};
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (!arg.startsWith("--")) continue;
    const eq = arg.indexOf("=");
    if (eq >= 0) {
      flags[arg.slice(2, eq)] = arg.slice(eq + 1);
    } else {
      const key = arg.slice(2);
      const next = rest[i + 1];
      if (next && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    }
  }
  return { command, flags };
}

function stringFlag(flags: Flags, key: string): string {
  const value = flags[key];
  if (typeof value !== "string" || !value.trim()) throw new Error(`Missing --${key}`);
  return value;
}

function optionalStringFlag(flags: Flags, key: string): string | undefined {
  const value = flags[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function intFlag(flags: Flags, key: string): number {
  const raw = stringFlag(flags, key);
  const n = Number(raw);
  if (!Number.isInteger(n)) throw new Error(`--${key} must be an integer`);
  return n;
}

function schoolArgs(flags: Flags): { city: string; schoolName: string } {
  return {
    city: stringFlag(flags, "city"),
    schoolName: stringFlag(flags, "school"),
  };
}

function printHelp(): void {
  process.stdout.write(`apin-timetable

Commands:
  lookup   --city <region> --school <schoolName>
  class    --city <region> --school <schoolName> --grade <n> --class <n> [--week YYYY-MM-DD]
  teachers --city <region> --school <schoolName>
  teacher  --city <region> --school <schoolName> --teacher <n> [--week YYYY-MM-DD]
  count

Examples:
  apin-timetable lookup --city 대구 --school 학남고등학교
  apin-timetable class --city 대구 --school 학남고등학교 --grade 1 --class 1 --week 2026-07-06
`);
}

async function main(): Promise<void> {
  const { command, flags } = parseFlags(process.argv.slice(2));
  let result: unknown;

  if (command === "help" || flags.help === true || flags.h === true) {
    printHelp();
    return;
  }

  if (command === "count") {
    result = await countWebdirs();
  } else if (command === "lookup") {
    result = await lookupSchool(schoolArgs(flags));
  } else if (command === "teachers") {
    result = await listTeachers(schoolArgs(flags));
  } else if (command === "class") {
    result = await getClassTimetable({
      ...schoolArgs(flags),
      grade: intFlag(flags, "grade"),
      classNo: intFlag(flags, "class"),
      weekStart: optionalStringFlag(flags, "week"),
    });
  } else if (command === "teacher") {
    result = await getTeacherTimetable({
      ...schoolArgs(flags),
      teacherNo: intFlag(flags, "teacher"),
      weekStart: optionalStringFlag(flags, "week"),
    });
  } else {
    throw new Error(`Unknown command: ${command}`);
  }

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((e) => {
  process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
  process.exitCode = 1;
});
