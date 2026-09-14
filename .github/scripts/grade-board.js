// 봉누도2 — 등급 체크 보드 만들기. 쓰는 법: node .github/scripts/grade-board.js (볼트 루트에서)
// private/등급 체크.md를 다시 만든다 (사이트에는 안 나온다). 플러그인 없이 옵시디언 기본 체크박스만 쓴다.
//   사건마다: 링크 · 시간 — 요약, 그 아래 ☕ 일상 / 📰 사건 / 🔥 특종 체크박스 3개 (현재 값에 체크).
//   사용자가 체크를 바꾼 뒤 커밋을 부탁하면 sync-grades.js가 체크된 값을 사건 노트의 취재가치에 옮기고 태그·일지 표를 맞춘다.
const fs = require("fs"), path = require("path")
const ROOT = "01 일지/사건"
const GRADES = ["☕ 일상", "📰 사건", "🔥 특종"]
function walk(d, o = []) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); e.isDirectory() ? walk(p, o) : p.endsWith(".md") && o.push(p) } return o }
const fm = (t, k) => { const m = t.match(new RegExp("^" + k + ": (.*)$", "m")); return m ? m[1].trim().replace(/^"|"$/g, "") : "" }

const byDay = {}
for (const f of walk(ROOT)) {
  const t = fs.readFileSync(f, "utf8"); const name = path.basename(f, ".md")
  const m = name.match(/^(\d+)일차-(\d+)(?:-(\d+))? (.*)$/); if (!m) continue
  ;(byDay[+m[1]] ??= []).push({
    name, title: m[4], key: [+m[2], m[3] === undefined ? 0 : +m[3]], sub: m[3] !== undefined,
    isParent: /^하위사건:/m.test(t), isEvent: /^tags: \[.*이벤트.*\]/m.test(t),
    grade: fm(t, "취재가치"), time: fm(t, "시간"), sum: fm(t, "요약"),
  })
}
let out = `---
type: 보드
tags: [보류]
---
> [!info] 사이트에 올라가지 않는 노트
> 사건마다 **취재가치**를 체크한다. 세 개 중 **하나만** 체크 (여러 개나 없음이면 그 사건은 건너뛴다).
> 다 고른 뒤 Claude에게 "커밋해 줘"라고 하면 체크된 값을 사건 노트의 \`취재가치\`에 옮기고, 태그(\`사건\`·\`특종\`)와 일지 표의 띠를 맞춰서 올린다.
> 큰 사건은 하위 등급과 상관없이 흐름 전체를 보고 매긴다. 📅 = 이벤트 태그가 붙은 큰 사건 (표에서는 보라 띠, 취재가치 값은 따로 둔다).

`
for (const day of Object.keys(byDay).map(Number).sort((a, b) => a - b)) {
  out += `## ${day}일차\n\n`
  for (const r of byDay[day].sort((a, b) => a.key[0] - b.key[0] || a.key[1] - b.key[1])) {
    const mark = r.isParent ? " **(큰 사건" + (r.isEvent ? " · 📅 이벤트" : "") + ")**" : ""
    const indent = r.sub ? "\t" : ""
    out += `${indent}- [[${r.name}|${r.title}]] · ${r.time}${mark} — ${r.sum}\n`
    for (const g of GRADES) out += `${indent}\t- [${r.grade === g ? "x" : " "}] ${g}\n`
  }
  out += "\n"
}
fs.mkdirSync("private", { recursive: true })
fs.writeFileSync("private/등급 체크.md", out)
console.log("보드: 사건", Object.values(byDay).reduce((a, b) => a + b.length, 0), "개")
