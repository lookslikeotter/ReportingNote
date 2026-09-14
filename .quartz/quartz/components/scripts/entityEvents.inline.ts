import { FullSlug, resolveRelative, simplifySlug } from "../../util/path"
import { decorateLinks, entityDayRows, linkResolver, loadContentData } from "./bongnudo"

// 봉누도2 — 인물·세력 페이지의 '사건 기록' 표를 채운다. 원본은 볼트의 .quartz/quartz/components/scripts/entityEvents.inline.ts.
// EntityEvents.tsx가 afterDOMLoaded로 싣는다. 행은 일지 표에서 그대로 가져오고(등급 색 띠 포함) 맨 앞에 일차 칸을 붙인다.
// 일지 표 읽기는 그래프 선 창과 같은 bongnudo.ts를 쓴다.

const DEFAULT_HEADS = ["시간", "사건", "요약", "관련 인물", "입수 경로"]

async function fillTable(section: HTMLElement, fullSlug: FullSlug) {
  const status = section.querySelector<HTMLElement>(".bn-entity-events-status")
  const data = await loadContentData()
  const resolveLink = linkResolver(data)
  const { thead, rows } = await entityDayRows(fullSlug, data, resolveLink, simplifySlug(fullSlug))
  // 읽는 사이에 다른 페이지로 옮겨 갔으면 그만둔다
  if (!section.isConnected) return
  if (rows.length === 0) {
    if (status) status.textContent = "일지 표에 아직 없다."
    return
  }

  const head = document.createElement("thead")
  const headRow = document.createElement("tr")
  const dayHead = document.createElement("th")
  dayHead.textContent = "일차"
  headRow.append(dayHead)
  const srcHeads = thead ? [...thead.querySelectorAll("th")] : []
  if (srcHeads.length > 0) {
    for (const th of srcHeads) headRow.append(document.importNode(th, true))
  } else {
    for (const h of DEFAULT_HEADS) {
      const th = document.createElement("th")
      th.textContent = h
      headRow.append(th)
    }
  }
  head.append(headRow)

  const body = document.createElement("tbody")
  for (const r of rows) {
    const tr = r.row.cloneNode(true) as HTMLElement
    const dayCell = document.createElement("td")
    const a = document.createElement("a")
    a.className = "internal"
    a.href = new URL(resolveRelative(fullSlug, r.day), window.location.toString()).toString()
    a.textContent = `${r.dayN}일차`
    dayCell.append(a)
    tr.prepend(dayCell)
    body.append(tr)
  }

  const table = document.createElement("table")
  table.append(head, body)
  const wrap = document.createElement("div")
  // bn-has-day: 맨 앞에 '일차' 칸이 하나 더 있다 (custom.scss가 칸 규칙을 한 칸씩 민다)
  wrap.className = "table-container bn-case-table bn-has-day"
  wrap.append(table)
  await decorateLinks(wrap, data, resolveLink, fullSlug)
  if (status) status.replaceWith(wrap)
  else section.append(wrap)
  document.dispatchEvent(new CustomEvent("bn-table-ready", { detail: wrap }))
}

document.addEventListener("nav", (e: CustomEventMap["nav"]) => {
  const section = document.querySelector<HTMLElement>(".bn-entity-events")
  if (!section) return
  void fillTable(section, e.detail.url)
})
