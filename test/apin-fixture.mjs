// Shared mock Apin server for unit tests. Serves the SAME data through both the
// dynamic PHP endpoints and the static files, so crossVerify() sees them agree.
// Subjects are ASCII on purpose: EUC-KR decoding of ASCII bytes is identical, so
// the static path is exercised without needing an EUC-KR encoder (Korean EUC-KR
// decoding is proven separately in parse.test.mjs and by the live check).

const encoder = new TextEncoder();

function resp(text) {
  return {
    ok: true,
    status: 200,
    text: async () => text,
    arrayBuffer: async () => encoder.encode(text).buffer,
  };
}

// One school: 대구 학남고등학교, webdir 0650, week 20, version 34.
// The dynamic day strings (indexed by hbno/gsno) and the static file lines are
// defined independently but describe the same data, so the two paths agree by
// default. A test can override one static file to force a mismatch.
const TIMES = "0830093010301130        ";
const CLASS_DAYS = ["MATH^ENG,SCI^,", "ART^PE,MUS^,"]; // index = hbno
const TEACHER_DAYS = ["MATH/1-1^ENG/1-2,SCI/1-1^,", "HIST/2-1^,", "BIO/3-1^,"]; // index = gsno

const STATIC = {
  "h20.txt": "MATH^ENG,SCI^,,\nART^PE,MUS^,,\n",
  "g20.txt": "MATH/1-1^ENG/1-2,SCI/1-1^,,\nHIST/2-1^,,\nBIO/3-1^,,\n",
  "t20.txt": "INFO/1-1^,,,\n",
  "s20.txt": "0830093010301130        0830093010301130",
};

const INDEX_HTML = `
<table>
<tr><td><a href="ele.txt">ele.txt</a></td><td align="right">2026-07-07 09:00 </td><td align="right">2.0K</td></tr>
<tr><td><a href="h19.txt">h19.txt</a></td><td align="right">2026-06-30 09:00 </td><td align="right">1.2K</td></tr>
<tr><td><a href="h20.txt">h20.txt</a></td><td align="right">2026-07-07 09:00 </td><td align="right">1.2K</td></tr>
<tr><td><a href="g20.txt">g20.txt</a></td><td align="right">2026-07-07 09:00 </td><td align="right">1.5K</td></tr>
</table>`;

const ROOT_HTML = `<a href="0001/">0001/</a><a href="0650/">0650/</a><a href="9999/">9999/</a>`;

// Optional overrides let a single test bend one response (e.g. force a mismatch).
//   overrides.static["h20.txt"] = "..."  bends a static file
//   overrides.classDays[hbno]  / overrides.teacherDays[gsno]  bends a dynamic reply
export function makeFetch(overrides = {}) {
  const classDays = overrides.classDays ?? CLASS_DAYS;
  const teacherDays = overrides.teacherDays ?? TEACHER_DAYS;
  const stat = { ...STATIC, ...overrides.static };
  const bodyOf = (init) => new URLSearchParams(init?.body ?? "");

  return async function mockFetch(input, init) {
    const url = String(input);
    const method = init?.method ?? "GET";

    if (method === "POST") {
      if (url.endsWith("/getupdir.php/") || url.endsWith("/getupdir.php")) return resp("1&0650&75&20270220&1");
      if (url.endsWith("/dnele.php")) return resp("2&1-1,1-2&1,2,3&정보실&34&");
      if (url.endsWith("/hbtime.php")) {
        const days = classDays[Number(bodyOf(init).get("hbno")) || 0] ?? "";
        return resp(`3&7.07 10:29&${days}&${TIMES}&34&`);
      }
      if (url.endsWith("/gstime.php")) {
        const days = teacherDays[Number(bodyOf(init).get("gsno")) || 0] ?? "";
        return resp(`3&7.07 10:29&${days}&${TIMES}&34&`);
      }
      throw new Error(`mock: unexpected POST ${url}`);
    }

    if (url.endsWith("/tm/")) return resp(ROOT_HTML);
    if (url.endsWith("/tm/0650/")) return resp(INDEX_HTML);
    const file = url.split("/").at(-1);
    if (file in stat) return resp(stat[file]);
    throw new Error(`mock: unexpected GET ${url}`);
  };
}
