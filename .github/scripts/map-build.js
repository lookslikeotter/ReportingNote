// 봉누도2 — 거점 약도 만들기. 쓰는 법 (볼트 루트에서):
//   node .github/scripts/map-build.js --fetch   봉누도 따라가기 사이트(https://bnd2-fanwiki.app/map)에서 거점·기관 본부 데이터를 받아
//                                             .github/data/map.json에 저장한 뒤 약도와 노트를 다시 만든다
//   node .github/scripts/map-build.js           저장된 map.json으로 약도(봉누도 지도.svg)와 노트(봉누도 지도.md의 표)만 다시 만든다
// 사이트를 알아서 확인하지는 않는다 — 사용자가 "지도 갱신해 줘"라고 할 때만 --fetch.
// 약도는 게임 좌표(x 동쪽, y 북쪽)를 그대로 써서 상대 위치·거리만 맞고, 도로·지형은 없다.
const fs = require("fs")
const https = require("https")

const SITE = "https://bnd2-fanwiki.app/map"
const DATA = ".github/data/map.json"
const SVG = "private/봉누도 지도.svg"
const NOTE = "private/봉누도 지도.md"

// 사이트의 기관 이름 → 볼트 세력 노트
const ORG_NOTE = { EMS: "병원", 언론: "봉누도방송국", 교통정비공사: "교통정비공사", 경찰: "경찰", 시청: "시청" }
// 분류별 색 (볼트의 링크 칩·그래프와 같은 계열)
const CAT_COLOR = {
  "시민 직업": "#1aae39",
  차량: "#dfab01",
  여가: "#d6409f",
  운동: "#f0a020",
  범죄: "#e03131",
  "기관 본부": "#0075de",
}
const CAT_ORDER = ["기관 본부", "시민 직업", "차량", "여가", "운동", "범죄"]

function get(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { "User-Agent": "Mozilla/5.0" } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) return resolve(get(new URL(res.headers.location, url).toString()))
        let s = ""
        res.setEncoding("utf8")
        res.on("data", (d) => (s += d))
        res.on("end", () => (res.statusCode === 200 ? resolve(s) : reject(new Error("HTTP " + res.statusCode))))
      })
      .on("error", reject)
  })
}

// Next.js 페이지에 실린 데이터(self.__next_f)에서 거점(label·x·y)과 기관(category·hq_x·hq_y)을 뽑는다
function parse(html) {
  let rsc = [...html.matchAll(/self\.__next_f\.push\(\[1,"([\s\S]*?)"\]\)/g)].map((m) => m[1]).join("")
  rsc = rsc.replace(/\\"/g, '"').replace(/\\n/g, "\n").replace(/\\\\/g, "\\")
  const objs = (re) =>
    [...rsc.matchAll(re)].map((m) => {
      try {
        return JSON.parse(m[0])
      } catch {
        return null
      }
    }).filter(Boolean)
  const points = objs(/\{[^{}]*"label":[^{}]*"x":[^{}]*\}/g).map((p) => ({
    name: p.name,
    category: p.label,
    x: Math.round(p.x),
    y: Math.round(p.y),
    description: p.description ?? null,
  }))
  const orgs = objs(/\{[^{}]*"category":[^{}]*"hq_x":[^{}]*\}/g)
    .filter((o) => typeof o.hq_x === "number" && typeof o.hq_y === "number")
    .map((o) => ({ name: o.name, x: Math.round(o.hq_x), y: Math.round(o.hq_y), description: o.description ?? null }))
  return { points, orgs }
}

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

// 이름표 자리: 오른쪽 → 왼쪽 → 위 → 아래 순으로 시도해서 다른 이름표·점과 겹치지 않는 자리에 둔다
function placeLabels(items, r) {
  const boxes = items.map((it) => ({ x: it.sx - r - 2, y: it.sy - r - 2, w: 2 * r + 4, h: 2 * r + 4 }))
  const hit = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
  const FS = 14
  const out = []
  for (const it of items) {
    const w = [...it.text].reduce((s, ch) => s + (/[ㄱ-힝]/.test(ch) ? FS : FS * 0.6), 0) + 4
    const h = FS + 4
    const cands = [
      { x: it.sx + r + 5, y: it.sy - h / 2, anchor: "start", tx: it.sx + r + 6, ty: it.sy + FS * 0.35 },
      { x: it.sx - r - 5 - w, y: it.sy - h / 2, anchor: "end", tx: it.sx - r - 6, ty: it.sy + FS * 0.35 },
      { x: it.sx - w / 2, y: it.sy - r - 4 - h, anchor: "middle", tx: it.sx, ty: it.sy - r - 6 },
      { x: it.sx - w / 2, y: it.sy + r + 4, anchor: "middle", tx: it.sx, ty: it.sy + r + 4 + FS },
    ]
    let pick = cands[0]
    for (const c of cands) {
      const box = { x: c.x, y: c.y, w, h }
      if (!boxes.some((b) => hit(box, b))) {
        pick = c
        break
      }
    }
    boxes.push({ x: pick.x, y: pick.y, w, h })
    out.push({ ...it, anchor: pick.anchor, tx: pick.tx, ty: pick.ty })
  }
  return out
}

function renderSvg({ points, orgs }) {
  const all = [
    ...orgs.map((o) => ({ text: (ORG_NOTE[o.name] ?? o.name) + " 본부", category: "기관 본부", x: o.x, y: o.y, org: true })),
    ...points.map((p) => ({ text: p.name, category: p.category, x: p.x, y: p.y, org: false })),
  ]
  const PAD = 350
  const minX = Math.min(...all.map((a) => a.x)) - PAD
  const maxX = Math.max(...all.map((a) => a.x)) + PAD
  const minY = Math.min(...all.map((a) => a.y)) - PAD
  const maxY = Math.max(...all.map((a) => a.y)) + PAD
  const W = 900
  const k = W / (maxX - minX)
  const H = Math.round((maxY - minY) * k) + 120 // 아래에 범례 자리
  const sx = (x) => (x - minX) * k
  const sy = (y) => (maxY - y) * k // 게임 y는 북쪽이 +, 화면은 아래가 +
  const R = 6
  const items = placeLabels(
    all.map((a) => ({ ...a, sx: sx(a.x), sy: sy(a.y) })).sort((a, b) => a.sy - b.sy),
    R,
  )
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Pretendard Variable, Pretendard, Apple SD Gothic Neo, Malgun Gothic, sans-serif">
<rect width="${W}" height="${H}" rx="12" fill="#ffffff" stroke="#e5e3df"/>
<text x="20" y="32" font-size="18" font-weight="700" fill="#1a1a1a">봉누도 거점 약도</text>
<text x="20" y="52" font-size="12" fill="#7d7a75">봉누도 따라가기 지도 데이터 기준 · 상대 위치만 맞고 도로·지형은 없음</text>
<text x="${W - 20}" y="32" text-anchor="end" font-size="14" font-weight="700" fill="#7d7a75">N ↑</text>
`
  // 1 km 축척 (게임 좌표 1000 단위)
  const bar = 1000 * k
  s += `<line x1="${W - 20 - bar}" y1="${H - 70}" x2="${W - 20}" y2="${H - 70}" stroke="#37352f" stroke-width="2"/>
<text x="${W - 20 - bar / 2}" y="${H - 76}" text-anchor="middle" font-size="11" fill="#37352f">1 km</text>
`
  for (const it of items) {
    const c = CAT_COLOR[it.category] ?? "#7d7a75"
    if (it.org) s += `<rect x="${(it.sx - R).toFixed(1)}" y="${(it.sy - R).toFixed(1)}" width="${2 * R}" height="${2 * R}" rx="2" fill="${c}" stroke="#ffffff" stroke-width="1.5"/>\n`
    else s += `<circle cx="${it.sx.toFixed(1)}" cy="${it.sy.toFixed(1)}" r="${R}" fill="${c}" stroke="#ffffff" stroke-width="1.5"/>\n`
    s += `<text x="${it.tx.toFixed(1)}" y="${it.ty.toFixed(1)}" text-anchor="${it.anchor}" font-size="14" font-weight="${it.org ? 700 : 500}" fill="#1a1a1a" stroke="#ffffff" stroke-width="3" paint-order="stroke" stroke-linejoin="round">${esc(it.text)}</text>\n`
  }
  // 범례
  let lx = 20
  const ly = H - 40
  for (const cat of CAT_ORDER) {
    const c = CAT_COLOR[cat]
    if (cat === "기관 본부") s += `<rect x="${lx}" y="${ly - 6}" width="12" height="12" rx="2" fill="${c}"/>`
    else s += `<circle cx="${lx + 6}" cy="${ly}" r="6" fill="${c}"/>`
    s += `<text x="${lx + 18}" y="${ly + 4}" font-size="12" fill="#37352f">${esc(cat)}</text>\n`
    lx += 18 + [...cat].length * 12 + 18
  }
  s += "</svg>\n"
  return s
}

function renderTables({ points, orgs }) {
  let s = "## 거점\n\n| 분류 | 거점 | 위치 (x, y) |\n|---|---|---|\n"
  const byCat = {}
  for (const p of points) (byCat[p.category] ??= []).push(p)
  for (const cat of CAT_ORDER.filter((c) => byCat[c])) {
    for (const p of byCat[cat].sort((a, b) => a.name.localeCompare(b.name, "ko"))) s += `| ${cat} | ${p.name} | ${p.x}, ${p.y} |\n`
  }
  s += "\n## 기관 본부\n\n| 기관 | 위치 (x, y) |\n|---|---|\n"
  for (const o of orgs) {
    const note = ORG_NOTE[o.name]
    s += `| ${note ? `[[${note}]]` + (note !== o.name ? ` (${o.name})` : "") : o.name} | ${o.x}, ${o.y} |\n`
  }
  return s
}

async function main() {
  if (process.argv.includes("--fetch")) {
    const html = await get(SITE)
    const data = parse(html)
    if (data.points.length === 0) throw new Error("거점 데이터를 찾지 못함 (페이지 구조가 바뀌었나?)")
    fs.mkdirSync(".github/data", { recursive: true })
    fs.writeFileSync(DATA, JSON.stringify(data, null, 2) + "\n")
    console.log("받음: 거점", data.points.length, "· 기관 본부", data.orgs.length)
  }
  const data = JSON.parse(fs.readFileSync(DATA, "utf8"))
  fs.writeFileSync(SVG, renderSvg(data))
  const START = "<!-- map:start -->", END = "<!-- map:end -->"
  let note = fs.existsSync(NOTE)
    ? fs.readFileSync(NOTE, "utf8")
    : `---
type: 지도
tags: []
---
> [!info] 봉누도 따라가기 사이트의 거점 지도 데이터로 그린 약도. 상대 위치와 거리만 맞고 도로·지형은 없다. 명총희가 아직 가 보지 않은 곳도 들어 있다 (봉누도 주민이면 누구나 아는 공개 정보). 좌표는 게임 좌표(x 동쪽, y 북쪽).

![[${SVG}]]

${START}
${END}
`
  const a = note.indexOf(START), b = note.indexOf(END)
  if (a < 0 || b < 0) throw new Error(NOTE + "에 map:start/map:end 표시가 없음")
  note = note.slice(0, a + START.length) + "\n" + renderTables(data) + note.slice(b)
  fs.writeFileSync(NOTE, note)
  console.log("만듦:", SVG, "·", NOTE, "(거점", data.points.length, "· 기관 본부", data.orgs.length + ")")
}
main().catch((e) => {
  console.error(e.message)
  process.exit(1)
})
