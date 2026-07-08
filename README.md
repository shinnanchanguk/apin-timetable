# apin-timetable

압핀(유원테크, YWTek) 시간표 서버(`sgpap.com`)에서 학교 시간표를 가져와 다루기 쉬운 형태로 돌려주는 **의존성 없는** Node.js 라이브러리이자 CLI입니다.

압핀은 국내 일부 중·고등학교가 쓰는 시간표 프로그램으로, 학교가 만든 시간표를 유원테크의 인터넷 서버로 올리면 앱(iOS/Android/PC)이 받아서 보여줍니다. 이 패키지는 그 공개 서버가 실제로 주고받는 형식을 분석해, 앱 없이도 시간표를 프로그램으로 읽게 해줍니다. (컴시간알리미용 파서가 여럿 공개돼 있는 것과 같은 결의, 압핀용 상호운용 라이브러리입니다.)

> **비공식 프로젝트입니다.** 유원테크와 아무런 관련이 없고, 리버스 엔지니어링으로 파악한 규격이라 예고 없이 바뀌면 동작하지 않을 수 있습니다.

이 패키지는 교사 두 명이 각자 만든 두 프로젝트를 하나로 합친 결과물입니다. 어떻게, 왜 합쳤는지는 [docs/병합-이야기.md](docs/병합-이야기.md)에 개발을 모르는 분도 읽을 수 있게 정리해 두었습니다.

## 두 가지 길, 그리고 교차 검증

같은 시간표를 보는 길이 두 가지 있고, 이 패키지는 둘을 모두 제공합니다.

- **동적 앱 API (기본값)**: 압핀 앱이 실제로 쓰는 PHP 흐름(`getupdir`/`dnele`/`hbtime`/`gstime`)을 그대로 따라갑니다. "대구 학남고등학교 1학년 1반 이번 주 시간표" 식으로 물어보는 방식이라, 학교명만 알면 바로 시작할 수 있습니다.
- **정적 파일**: 학교 폴더(`/tm/<webdir>/`)에 올라와 있는 시간표 텍스트 파일(`h/g/t/s<주차>.txt`)을 직접 읽습니다. 앱 API가 잘 안 열어주는 **특별실(교실) 시간표**와 **교시 시작시각**을 얻을 수 있고, 앱 결과가 원본과 같은지 대조할 때 좋습니다.
- **교차 검증(`crossVerify`)**: 같은 대상을 두 길로 각각 가져와 서로 일치하는지 확인합니다. 규격이 바뀌었는지 감시하는 회귀 장치로 쓰기 좋습니다.

두 길은 같은 통합 결과 형태(`Timetable`)를 돌려줍니다. 한 결과 안에 **표 형태 격자(`grid[요일][교시]`)**와 **평평한 목록(`entries[]`)**이 모두 들어 있어, 화면에 표로 그리기도 저장·순회하기도 편합니다.

## 설치

```bash
# GitHub에서 바로
npm install github:shinnanchanguk/apin-timetable

# npm 발행 후
npm install apin-timetable
```

Node.js 18 이상이 필요합니다(내장 `fetch`와 EUC-KR 디코딩용 `TextDecoder`만 씁니다).

## 빠른 시작 (라이브러리)

```ts
import {
  lookupSchool,
  getClassTimetable,
  getTeacherTimetable,
  getRoomTimetable,
  listTeachers,
  crossVerify,
  apinWeekNo,
} from "apin-timetable";

// 1) 학교 찾기 (지역명 + 정확한 등록명)
const school = await lookupSchool({ city: "대구", schoolName: "학남고등학교" });
// → { webdir: "0650", classLabels: ["1-1", …], teacherNumbers: ["1", …], roomLabels: ["정보실"], version, date }

// 2) 학급 시간표 (기본: 동적 앱 API)
const classWeek = await getClassTimetable({
  city: "대구", schoolName: "학남고등학교",
  grade: 1, classNo: 1,
  weekStart: "2026-07-06",   // 그 주의 아무 날짜나. 없으면 오늘
});
console.log(classWeek.entries[0]);  // { weekday, day, period, subject, ref, marked }
console.log(classWeek.grid[0]);     // 월요일 [교시별 셀]
console.log(classWeek.periodTimes); // ["08:30","09:30", …]

// 같은 학급을 정적 파일로 (교차 확인·보강용)
const classStatic = await getClassTimetable({
  city: "대구", schoolName: "학남고등학교",
  grade: 1, classNo: 1, weekStart: "2026-07-06",
  mode: "static",
});

// 3) 교사 시간표 — 셀의 ref 는 학급 라벨
const teachers = await listTeachers({ city: "대구", schoolName: "학남고등학교" });
const teacherWeek = await getTeacherTimetable({
  city: "대구", schoolName: "학남고등학교",
  teacherNo: 1, weekStart: "2026-07-06",
});

// 4) 특별실(교실) 시간표 — 정적 파일 전용
const roomWeek = await getRoomTimetable({ city: "대구", schoolName: "학남고등학교", weekStart: "2026-07-06" });

// 5) 교차 검증 — 동적 vs 정적이 같은지 확인
const verified = await crossVerify({ city: "대구", schoolName: "학남고등학교", weekStart: "2026-07-06" });
console.log(verified.allMatch, verified.summary);
```

## CLI

```bash
npx apin-timetable lookup   --city 대구 --school 학남고등학교
npx apin-timetable class    --city 대구 --school 학남고등학교 --grade 1 --class 1 --week 2026-07-06
npx apin-timetable class    --city 대구 --school 학남고등학교 --grade 1 --class 1 --static   # 정적 파일로
npx apin-timetable teacher  --city 대구 --school 학남고등학교 --teacher 1
npx apin-timetable teachers --city 대구 --school 학남고등학교
npx apin-timetable rooms    --city 대구 --school 학남고등학교            # 특별실 목록
npx apin-timetable rooms    --city 대구 --school 학남고등학교 --room 0    # 특별실 시간표
npx apin-timetable periods  --city 대구 --school 학남고등학교            # 교시 시작시각
npx apin-timetable verify   --city 대구 --school 학남고등학교            # 동적 vs 정적 교차 검증
npx apin-timetable week     --date 2026-07-06                          # 주차만 계산(오프라인)
npx apin-timetable count
```

CLI는 결과를 JSON으로 출력합니다.

## 통합 결과 형태 (`Timetable`)

동적·정적 두 길이 모두 같은 형태를 돌려줍니다.

```ts
interface Timetable {
  source: "dynamic" | "static";      // 어느 길로 가져왔는지
  kind: "class" | "teacher" | "room";
  webdir: string;                    // 학교 코드
  week: number;                      // 압핀 주차(= h/g/t/s 파일 번호)
  weekStart?: string;                // 그 주 월요일(YYYY-MM-DD)
  city?: string; schoolName?: string;
  target: string;                    // 학급 라벨 / 교사 번호 / 특별실 이름
  periodTimes: string[];             // ["08:30", …]
  grid: (Cell | null)[][];           // grid[요일][교시] — 표로 그리기 좋음
  entries: TimetableEntry[];         // 평평한 목록 — 저장·순회 좋음
  fetchedAt: string;                 // ISO 시각
}

interface Cell { subject: string; ref: string | null; raw: string; marked: boolean; }
interface TimetableEntry { weekday: 0|1|2|3|4; day: "mon"|…|"fri"; period: number; subject: string; ref: string | null; marked: boolean; }
```

- `ref` = 셀의 `/` 뒤 값. 교사·특별실 파일에서는 **학급 라벨**(예: `1-7`)이고, 학급 파일에서는 대개 `null`입니다.
- `marked` = 셀에 특별 표시(`@`계열 마커, `&`, `*`)가 있었는지. 이 표시는 선택과목·분반·공강 등을 나타내는 것으로 **추정**되며 서버 근거로 확정되진 않았습니다(그래서 "변경됨"이 아니라 "표시 있음"으로 둡니다). 마커는 `subject`에서 제거하고 원본은 `raw`에 보존합니다. 실측(대구 학남고 2026-07-06 주)에서는 `*진로`·`**자율`처럼 `*` 접두만 관측됐습니다.

## 언제 어느 길을 쓰나

| 하고 싶은 일 | 권장 |
|---|---|
| 학교명으로 학급·교사 시간표 가져오기 | 동적(기본) |
| 특별실(교실) 시간표 | 정적(`getRoomTimetable`) |
| 교시 시작시각만 | 동적 결과의 `periodTimes` 또는 정적 `getStaticPeriodTimes` |
| 앱 결과가 원본 파일과 같은지 확인 | `crossVerify` |
| 앱 API가 비었을 때 대비 경로 | 정적(`mode: "static"`) |

## 서버·데이터 구조

리버스 엔지니어링 + 실측(2026-07-07 대구 학남고 `0650`, 두 프로젝트 교차 검증)으로 확인한 내용입니다.

### 서버

- 베이스: `http://www.sgpap.com` (평문 HTTP)
- PHP 엔드포인트: `POST`, `application/x-www-form-urlencoded`, **UTF-8**
- 시간표 원본: `http://www.sgpap.com/tm/<webdir>/` 폴더의 **정적 텍스트 파일**(로그인 불필요), **EUC-KR(CP949)**

| 경로 | 용도 | 파라미터 |
|---|---|---|
| `/tm/getupdir.php` | (시/군, 학교명) → 학교 코드(webdir) | `hgsj`, `hgm` |
| `/tm/dnele.php` | 기준 목록(학급/교사번호/교실/버전) | `webdir` |
| `/tm/hbtime.php` | 학급 시간표 | `webdir`, `hbno`, `wkno`, `dayno`, `elever` |
| `/tm/gstime.php` | 교사 시간표 | `webdir`, `gsno`, `wkno`, `dayno`, `elever` |

`getupdir`는 **정확한 등록명에만** 매칭합니다(부분 검색 없음). "○○고" vs "○○고등학교", 띄어쓰기까지 학교가 등록한 표기와 정확히 같아야 합니다. 한글은 **UTF-8**로 보내야 매칭됩니다(이 라이브러리가 처리).

### 학교 폴더 파일 (`/tm/<webdir>/`)

실측으로 파일 종류를 확정했습니다(학남고 0650 기준, 줄 수와 `dnele`·`hbtime`/`gstime` 응답 대조).

| 파일 | 내용 | 줄 수(대상) | 셀 형식 |
|---|---|---|---|
| `h<N>.txt` | **학급 시간표** (`hbtime.php`와 동일) | 학급 수(27) | `과목` |
| `g<N>.txt` | **교사 시간표** (`gstime.php`와 동일) | 교사 수(54) | `과목/학급` |
| `t<N>.txt` | **특별실/교실 시간표** | 교실 수(1=정보실) | `과목/학급` |
| `s<N>.txt` | **교시 시작시각** (`HHMM` 반복) | 1 | `HHMM` 연속 |
| `ele.txt`, `*.inx`, `*.cnt` | 이동수업 목록·줄 오프셋 색인·메타데이터 | — | — |

- `N` = 주차(week). `h20.txt` == `hbtime.php wkno=20` 임을 실측으로 확인.
- **줄 순서 = 목록 순서**: `h<주차>.txt`의 N번째 줄 = `classLabels`의 N번째 학급, `g<주차>.txt`의 N번째 줄 = `teacherNumbers`의 N번째 교사(= `gstime.php gsno`).

### 시간표 셀 문법

`h/g/t` 파일은 **한 줄 = 한 대상(학급·교사·교실)의 한 주간 시간표**입니다.

```
줄   = 요일1 , 요일2 , … , 요일5 ,
요일 = 교시1 ^ 교시2 ^ … ^ 교시N
교시 = "" (빈 시간) | "과목" | "과목/학급"
```

- 학급 파일(`h`): 대개 `과목`만. 예: `과학탐구실험1^통합과학1^…`
- 교사·교실 파일(`g`/`t`): `과목/학급`. 예: `공통국어1/1-7^공통국어1/1-2^…` — `/` 뒤는 **학급 라벨**(교실 번호가 아님)
- `@B…@K` 같은 `@`+영문자 마커, `A~D` 접두는 서식·분반·공강 등을 나타내는 것으로 **추정**(서버 근거로 확정되진 않음). 제거한 값이 `subject`, 원본이 `raw`.

### 인코딩

- 정적 파일(`h/g/t/s.txt`): **EUC-KR(CP949)** — 라이브러리가 자동 디코딩
- PHP 응답(`dnele` 등): **UTF-8**

## 현재 주차 알아내기

시간표 파일 번호(`h<N>`)가 곧 주차입니다.

- **`apinWeekNo(date?)` (권장, 순수 함수)**: 학교연도 3월 1일이 속한 주의 월요일을 1주차로 삼아 계산합니다. 결정론적이라 시간대 영향을 덜 받습니다. `weekNoFromDate`는 같은 함수의 별칭입니다. 실측: `apinWeekNo("2026-07-06") === 20`.
- **`currentWeekByUpdate(webdir)` (교차 확인용)**: 가장 최근 수정된 `h<N>.txt`를 고릅니다. 학교가 다음 주 파일을 먼저 갱신하면 미래 주차로 흔들릴 수 있어, 정확도가 중요하면 `apinWeekNo`를 기본으로 두고 이 값은 대조용으로 씁니다.
- `estimateCurrentWeek(city, schoolName)`는 둘 다와 총 주차 수를 함께 돌려줍니다.

## API

**학교·목록**
- `lookupSchool({ city, schoolName })` → `SchoolProfile` (webdir·classLabels·teacherNumbers·teacherOptions·roomLabels·version·date, 캐시 10분)
- `resolveSchool(city, schoolName)` → `{ webdir, date } | null`
- `getElements(webdir)` → `{ classLabels, teacherNumbers, roomLabels, version }`
- `listTeachers({ city, schoolName })` → `{ no, label }[]`

**시간표(통합, 기본 동적 · `mode:"static"`로 정적)**
- `getClassTimetable({ city, schoolName, grade, classNo, weekStart?/week?, mode? })` → `Timetable`
- `getTeacherTimetable({ city, schoolName, teacherNo, weekStart?/week?, mode? })` → `Timetable`
- `getRoomTimetable({ city, schoolName, roomIndex?/roomLabel?, weekStart?/week? })` → `Timetable` (정적 전용)

**교차 검증**
- `crossVerify({ city, schoolName, week?/weekStart?, classLabel?, teacherNo?, checkClass?, checkTeacher?, checkPeriodTimes? })` → `CrossVerifyResult` (`allMatch`, `checks[]`, `summary`)

**정적 저수준(원본 파일 직접)**
- `getStaticFile(webdir, filename)` → `{ filename, rows, text }`
- `getStaticClassRow / getStaticTeacherRow / getStaticRoomRow (webdir, week, index)` → `(Cell|null)[][] | null`
- `getStaticPeriodTimes(webdir, week)` → `string[]`
- `getClassTimetableStatic / getTeacherTimetableStatic (input)` → `Timetable`
- `listFiles(webdir)` / `listFilesDetailed(webdir)` → 파일명 / `{name, modified, size}[]`
- `fetchStatic(webdir, filename)` → EUC-KR 디코딩 원문

**주차·파싱**
- `apinWeekNo(date?)` / `weekNoFromDate(date?)` / `resolveWeekStart(date?)`
- `currentWeekByUpdate(webdir)` / `estimateCurrentWeek(city, schoolName)`
- `parseCell` / `parseGrid` / `parseDaysToGrid` / `gridToEntries` / `gridToDayStrings` / `parsePeriodTimes` / `normalizeRegion`

**기타**
- `countWebdirs()` → `{ webdirCount, checkedAt, note }` (서버 폴더 수, 공식 학교 수 아님)

모든 함수는 `{ fetch, timeoutMs, signal }` 옵션을 받습니다(테스트에서 `fetch` 주입 가능).

## 교차 검증 (2026-07-07, 대구 학남고 0650)

동적 PHP 방식과 정적 파일 방식을 같은 주차로 대조했고, 학급·교사·교시시각이 모두 일치했습니다.

| 항목 | 정적 | 동적 | 결과 |
|---|---|---|---|
| 학교 코드 | `0650` | `0650` | 일치 |
| 학급 시간표 | `h20.txt`[1-1] | `hbtime.php wkno=20` | 월~금 전 교시 일치 |
| 교사 시간표 | `g20.txt` | `gstime.php` | 교사 1·2·10·54번 일치 |
| 교시 시각 | `s20.txt` | 응답 시간대 필드 | 일치(`08:30`…) |

`crossVerify`가 이 대조를 코드로 수행합니다. 라이브 회귀 확인:

```bash
npm run live   # 실제 서버로 요청을 보냅니다(대구 학남고 기본, APIN_CITY/APIN_SCHOOL로 변경)
```

## 책임 있는 사용

- 이 도구는 **자신의 학교 시간표 조회** 같은 정당한 상호운용·학습 목적을 위한 것입니다.
- 남의 서버이므로 **대량 수집·과도한 요청을 하지 마세요.** 이 저장소는 전체 학교를 훑는 기능을 제공하지 않습니다.
- 저장소에는 **어떤 학교의 실제 시간표 데이터도 담지 않습니다.** 예제는 실행 시점에 직접 받아옵니다.
- 교사 이름 등 개인정보는 이 서버에 게시되지 않습니다(아래 한계 참고).

## 알려진 한계

- **교사 이름은 서버에 없습니다.** 교사 시간표는 **번호**로만 식별됩니다(`teacherNumbers` = `1`..`54`). 이름↔번호 매핑은 학교 내부 프로그램에만 있어, "교사 이름으로 검색"은 이 서버만으로는 불가능합니다.
- **파일 종류·줄 매핑**(h=학급, g=교사, t=교실, s=교시시각)은 학남고 1곳에서 실측 확정했습니다. 특별실이 여럿인 학교의 `t` 줄 수, 학년별 교시가 다른 학교의 `s` 구조 등은 표본을 더 확인해야 합니다.
- **`getupdir` 응답의 `yyyymmdd` 필드**(예 `20270220`)는 의미가 미확정입니다(구독 만료일 또는 주차 앵커로 추정). 값이 미래일 수 있어 이 라이브러리는 **하드 실패에 쓰지 않고 참고값(`date`)으로만** 노출합니다.
- **`/tm/`의 폴더 수 ≠ 실제 학교 수.** 빈·테스트·폐기 항목이 섞여 있습니다.
- **통신은 평문 HTTP입니다.** 압핀 서버가 `http://`만 제공해서 오가는 내용이 암호화되지 않습니다(같은 네트워크에서 값이 변조될 수 있음). 다만 오가는 것은 공개 정보(학교명 송신 · 공개 시간표 수신)뿐이라 자격증명·개인정보 노출은 없습니다.
- 규격은 유원테크가 단독으로 운영·변경합니다. 언제든 바뀔 수 있습니다.

## 함께 만든 사람들

- **박준일([pblsketch](https://github.com/pblsketch))** — 정적 파일 파서(`appin-timetable-parser`)와 서버 구조 리버스 엔지니어링
- **신찬([shinnanchanguk](https://github.com/shinnanchanguk))** — 동적 앱 API 클라이언트(TypeScript·CLI)와 통합

두 프로젝트를 어떻게, 왜 하나로 합쳤는지는 [docs/병합-이야기.md](docs/병합-이야기.md)에 정리했습니다. 변경 이력은 [CHANGELOG.md](CHANGELOG.md)를 보세요.

## 기여

이슈/PR 환영합니다. 특히 학교별 파일·줄 구성 매핑, `@`/`A~D` 마커 의미, `getupdir` 날짜 필드 의미에 대한 관찰을 공유해 주세요.

## 라이선스

[MIT](./LICENSE)
