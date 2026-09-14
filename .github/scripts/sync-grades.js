// 봉누도2 — 취재가치 동기화. 쓰는 법: node .github/scripts/sync-grades.js   (볼트 루트에서)
//   0) private/등급 체크.md가 있으면, 사건마다 체크된 등급(하나만 체크된 것)을 그 사건 노트의 `취재가치`에 옮긴다.
//   1) 사건 노트의 `취재가치`를 기준으로 tags의 `사건`·`특종`·`이벤트`를 맞춘다 (다른 태그는 그대로).
//   2) 일지 표(01 일지/N일차.md)에서 그 사건 행의 시간 칸 등급 이름표(bn-lv-*)를 맞춘다 (📅 이벤트 → bn-lv-event).
// 등급 체크 보드로 값을 바꾼 뒤 커밋 전에 돌린다. 끝나면 grade-board.js로 보드를 다시 만들어 두는 것이 좋다.
const fs = require("fs"), path = require("path")
const ROOT = "01 일지/사건"
const GRADES = ["☕ 일상", "📰 사건", "🔥 특종", "📅 이벤트"]   // 📅 이벤트는 큰 사건에만
const GRADE_TAG = { "☕ 일상": "", "📰 사건": "사건", "🔥 특종": "특종", "📅 이벤트": "이벤트" }
const GRADE_SPAN = { "☕ 일상": "", "📰 사건": "bn-lv-news", "🔥 특종": "bn-lv-scoop", "📅 이벤트": "bn-lv-event" }
function walk(d, o = []) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); e.isDirectory() ? walk(p, o) : p.endsWith(".md") && o.push(p) } return o }
const fm = (t, k) => { const m = t.match(new RegExp("^" + k + ": (.*)$", "m")); return m ? m[1].trim() : "" }
const files = walk(ROOT)
const byName = {}; for (const f of files) byName[path.basename(f, ".md")] = f

// 0) 보드에서 체크된 등급 읽기
const BOARD = "private/등급 체크.md"
let fromBoard = 0, skipped = 0
if (fs.existsSync(BOARD)) {
  const L = fs.readFileSync(BOARD, "utf8").split(/\r?\n/)
  for (let i = 0; i < L.length; i++) {
    const m = L[i].match(/^\t?- \[\[([^\]|]+)\|/); if (!m || !byName[m[1]]) continue
    const checked = []
    for (let j = i + 1; j < L.length; j++) {
      const c = L[j].match(/^\t{1,2}- \[( |x|X)\] (☕ 일상|📰 사건|🔥 특종|📅 이벤트)\s*$/); if (!c) break
      if (c[1] !== " ") checked.push(c[2])
    }
    if (checked[0] === "📅 이벤트" && !/^하위사건:/m.test(fs.readFileSync(byName[m[1]], "utf8"))) { console.warn("📅 이벤트는 큰 사건에만: 건너뜀", m[1]); skipped++; continue }
    if (checked.length !== 1) { if (checked.length > 1) { console.warn("체크가 여러 개라 건너뜀:", m[1]); skipped++ } continue }
    const f = byName[m[1]]; let t = fs.readFileSync(f, "utf8"); const crlf = t.includes("\r\n"); t = t.replace(/\r\n/g, "\n")
    const cur = fm(t, "취재가치").replace(/^"|"$/g, "")
    if (cur !== checked[0]) {
      t = t.replace(/^취재가치: .*$/m, () => '취재가치: "' + checked[0] + '"')
      fs.writeFileSync(f, crlf ? t.replace(/\n/g, "\r\n") : t)
      fromBoard++; console.log("취재가치:", m[1], cur, "→", checked[0])
    }
  }
}

// 1) 태그, 2) 일지 표
const byDay = {}
let tagFixes = 0
for (const f of files) {
  let t = fs.readFileSync(f, "utf8"); const crlf = t.includes("\r\n"); t = t.replace(/\r\n/g, "\n")
  const name = path.basename(f, ".md"); const m = name.match(/^(\d+)일차-/); if (!m) continue
  const grade = fm(t, "취재가치").replace(/^"|"$/g, "")
  if (!GRADES.includes(grade)) { console.error("모르는 취재가치:", name, grade); continue }
  const list = fm(t, "tags").replace(/^\[|\]$/g, "").split(",").map((x) => x.trim()).filter(Boolean)
  const kept = list.filter((x) => x !== "사건" && x !== "특종" && x !== "이벤트")
  const want = GRADE_TAG[grade] ? [GRADE_TAG[grade], ...kept] : kept
  if (want.join(",") !== list.join(",")) { t = t.replace(/^tags: .*$/m, () => "tags: [" + want.join(", ") + "]"); tagFixes++; fs.writeFileSync(f, crlf ? t.replace(/\n/g, "\r\n") : t) }
  ;(byDay[+m[1]] ??= {})[name] = GRADE_SPAN[grade]
}
let rowFixes = 0
for (const [day, spans] of Object.entries(byDay)) {
  const f = "01 일지/" + day + "일차.md"; if (!fs.existsSync(f)) continue
  let s = fs.readFileSync(f, "utf8"); const crlf = s.includes("\r\n"); s = s.replace(/\r\n/g, "\n")
  const L = s.split("\n"); let changed = false
  for (let i = 0; i < L.length; i++) {
    if (!L[i].startsWith("|")) continue
    const link = L[i].match(/\[\[(\d+일차-[^\]|\\]+)\\\|/); if (!link) continue
    const span = spans[link[1]]; if (span === undefined) continue
    const cur = (L[i].match(/^\|\s*(?:<span class="(bn-lv-\w+)">)?\d\d:\d\d/) || [])[1] || ""
    if (cur === span) continue
    L[i] = L[i].replace(/^\|\s*(?:<span class="bn-lv-\w+">)?(\d\d:\d\d)(?:<\/span>)?\s*\|/, (m0, time) => span ? '| <span class="' + span + '">' + time + "</span> |" : "| " + time + " |")
    rowFixes++; changed = true
  }
  if (changed) { s = L.join("\n"); fs.writeFileSync(f, crlf ? s.replace(/\n/g, "\r\n") : s) }
}
console.log("보드에서 옮긴 취재가치:", fromBoard, "· 건너뜀:", skipped, "· 태그 고침:", tagFixes, "· 일지 표 행 고침:", rowFixes)
