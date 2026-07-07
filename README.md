# apin-timetable

Unofficial Node.js client for the Apin timetable mobile server used by some Korean schools.

It follows the same public mobile-app flow:

1. Find a school by region and official school name.
2. Read its class list, teacher number list, room list, and version.
3. Fetch class or teacher weekly timetables.

This package is independent from Jjongal. It is a small library and CLI that other projects can import directly.

## Install

Current GitHub install:

```bash
npm install github:shinnanchanguk/apin-timetable
```

After npm publication:

```bash
npm install apin-timetable
```

Node.js 18 or newer is required.

## Library

```ts
import {
  lookupSchool,
  getClassTimetable,
  listTeachers,
  getTeacherTimetable,
  countWebdirs,
} from "apin-timetable";

const school = await lookupSchool({ city: "대구", schoolName: "학남고등학교" });
console.log(school.webPath, school.classLabels.length, school.teacherOptions.length);

const classWeek = await getClassTimetable({
  city: "대구",
  schoolName: "학남고등학교",
  grade: 1,
  classNo: 1,
  weekStart: "2026-07-06",
});

const teachers = await listTeachers({ city: "대구", schoolName: "학남고등학교" });

const teacherWeek = await getTeacherTimetable({
  city: "대구",
  schoolName: "학남고등학교",
  teacherNo: teachers[0].no,
  weekStart: "2026-07-06",
});

const count = await countWebdirs();
```

## CLI

```bash
npx apin-timetable lookup --city 대구 --school 학남고등학교
npx apin-timetable class --city 대구 --school 학남고등학교 --grade 1 --class 1 --week 2026-07-06
npx apin-timetable teachers --city 대구 --school 학남고등학교
npx apin-timetable teacher --city 대구 --school 학남고등학교 --teacher 1 --week 2026-07-06
npx apin-timetable count
```

The CLI prints JSON.

## Notes

- Region values follow the Apin mobile app convention. Use values like `대구`, `서울`, `의정부`, or `담양`, without the `시` or `군` suffix.
- Apin public responses expose teacher numbers, not teacher names. Use `listTeachers()` first, then fetch a teacher timetable by number.
- `countWebdirs()` counts numeric webdir folders visible on `http://www.sgpap.com/tm/`. It is not an official school-name directory.
- This is an unofficial client for publicly reachable Apin mobile endpoints. Be considerate with request volume.

## License

MIT
