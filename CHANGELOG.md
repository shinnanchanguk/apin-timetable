# Changelog

## 0.2.0 (2026-07-08)

교사 두 명의 프로젝트를 하나로 병합했습니다. 신찬의 `apin-timetable`(동적 앱 API 클라이언트)과 박준일([pblsketch](https://github.com/pblsketch))의 `appin-timetable-parser`(정적 파일 파서)의 장점을 합쳤습니다. 배경은 [docs/병합-이야기.md](docs/병합-이야기.md)를 보세요.

### 추가

- 정적 파일 레이어: `h/g/t/s<주차>.txt`를 직접 읽습니다(EUC-KR 자동 디코딩).
  - 특별실(교실) 시간표 `getRoomTimetable` (정적 전용 신규 능력)
  - 교시 시작시각 `getStaticPeriodTimes`
  - 파일 목록 `listFiles`/`listFilesDetailed`, 파일 수정일 기반 주차 `currentWeekByUpdate`/`estimateCurrentWeek`
- `crossVerify()`: 같은 대상을 동적·정적 두 길로 가져와 일치 여부를 구조화해 돌려주는 교차 검증 API
- `getClassTimetable`/`getTeacherTimetable`에 `mode: "dynamic" | "static"` 스위치(기본 dynamic)
- 통합 `Timetable` 출력: `grid[요일][교시]`와 `entries[]`를 한 결과에 함께 담아, 표로 그리기도 순회·저장하기도 편함
- CLI 명령 추가: `rooms`, `periods`, `verify`, `week`; `class`/`teacher`에 `--static`/`--mode`

### 변경

- 애매한 `yyyymmdd` 필드로 하드 실패하던 동작 제거. `profile.date` 참고값으로만 노출(구독 만료일인지 불확실해 조회를 막지 않음)
- `SchoolProfile` 필드 정리: `webPath` → `webdir`, `expiresAt` → `date`, `teacherNumbers` 추가(`teacherOptions` 유지)
- 시간표 엔트리의 `classLabel` → `ref`로 통일(교사·교실 파일의 `/` 뒤 학급 라벨)
- 셀 파싱 통일: 동적·정적이 같은 `parseCell`/`parseGrid`를 쓰고, 원본을 `raw`로 보존하며 특별 표시를 `marked`로 노출(의미는 학교별·미확정이라 "변경됨" 대신 "표시 있음"으로 둠)
- 주차 계산을 시간대·서머타임에 안전하게 재작성하고 학교연도 경계(3월 1일 주 = 1주차)를 바로잡음
- 타임아웃 처리에서 호출자가 `signal`을 넘길 때 타이머·리스너가 누수되던 문제 수정

### 문서

- README를 통합본으로 재작성(두 레이어·교차 검증·서버 구조 리버스 엔지니어링·공동저자)
- `docs/병합-이야기.md`: 개발을 모르는 분을 위한 병합 설명 추가

## 0.1.0

- 초기 동적 앱 API 클라이언트(신찬): `lookupSchool`, `getClassTimetable`, `getTeacherTimetable`, `listTeachers`, `countWebdirs`
