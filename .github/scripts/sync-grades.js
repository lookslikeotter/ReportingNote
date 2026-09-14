// 봉누도2 — 취재가치 동기화. 사건 노트의 `취재가치` 값을 기준으로
//   1) tags의 `사건`·`특종`을 맞추고 (다른 태그는 그대로)
//   2) 일지 표(01 일지/N일차.md)에서 그 사건 행의 시간 칸 등급 이름표(bn-lv-*)를 맞춘다.
//      이벤트 태그가 붙은 큰 사건 행은 📅(bn-lv-event)를 유지한다.
// 쓰는 법: node .github/scripts/sync-grades.js   (볼트 루트에서)
// 등급 체크 보드(private/등급 체크.md, .github/scripts/grade-board.js)로 값을 바꾼 뒤 커밋 전에 돌린다.
const fs = require("fs"), path = require("path")
const ROOT = "01 일지/사건"
const bs = String.fromCharCode(92)
const GRADE_TAG = { "☕ 일상": "", "📰 사건": "사건", "🔥 특종": "특종" }
const GRADE_SPAN = { "☕ 일상": "", "📰 사건": "bn-lv-news", "🔥 특종": "bn-lv-scoop" }
function walk(d, o = []) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); e.isDirectory() ? walk(p, o) : p.endsWith(".md") && o.push(p) } return o }
const fm = (t, k) => { const m = t.match(new RegExp("^" + k + ": (.*)$", "m")); return m ? m[1].trim() : "" }

const byDay = {}
let tagFixes = 0
for (const f of walk(ROOT)) {
  let t = fs.readFileSync(f, "utf8"); const crlf = t.includes("\r\n"); t = t.replace(/\r\n/g, "\n")
  const name = path.basename(f, ".md"); const m = name.match(/^(\d+)일차-/); if (!m) continue
  const grade = fm(t, "취재가치").replace(/^"|"$/g, "")
  if (!(grade in GRADE_TAG)) { console.error("모르는 취재가치:", name, grade); continue }
  const tagsLine = fm(t, "tags"); const list = tagsLine.replace(/^\[|\]$/g, "").split(",").map((x) => x.trim()).filter(Boolean)
  const kept = list.filter((x) => x !== "사건" && x !== "특종")
  const want = GRADE_TAG[grade] ? [GRADE_TAG[grade], ...kept] : kept
  if (want.join(",") !== list.join(",")) {
    t = t.replace(/^tags: .*$/m, () => "tags: [" + want.join(", ") + "]")
    tagFixes++
  }
  const isEvent = want.includes("이벤트")
  ;(byDay[+m[1]] ??= {})[name] = isEvent ? "bn-lv-event" : GRADE_SPAN[grade]
  fs.writeFileSync(f, crlf ? t.replace(/\n/g, "\r\n") : t)
}

let rowFixes = 0
for (const [day, spans] of Object.entries(byDay)) {
  const f = "01 일지/" + day + "일차.md"; if (!fs.existsSync(f)) continue
  let s = fs.readFileSync(f, "utf8"); const crlf = s.includes("\r\n"); s = s.replace(/\r\n/g, "\n")
  const L = s.split("\n")
  for (let i = 0; i < L.length; i++) {
    if (!L[i].startsWith("|")) continue
    const link = L[i].match(/\[\[(\d+일차-[^\]|\\]+)\\\|/); if (!link) continue
    const span = spans[link[1]]; if (span === undefined) continue
    const r = L[i].replace(/^\|\s*(?:<span class="bn-lv-\w+">)?(\d\d:\d\d)(?:<\/span>)?\s*\|/, (m0, time) =>
      span ? '| <span class="' + span + '">' + time + "</span> |" : "| " + time + " |")
    if (r !== L[i]) { L[i] = r; rowFixes++ }
  }
  s = L.join("\n"); fs.writeFileSync(f, crlf ? s.replace(/\n/g, "\r\n") : s)
}
console.log("태그 고침:", tagFixes, "· 일지 표 행 고침:", rowFixes)
