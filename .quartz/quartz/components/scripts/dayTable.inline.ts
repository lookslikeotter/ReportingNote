// 봉누도2 — 일지 표의 큰 사건/하위 사건 행. 원본은 볼트의 .quartz/quartz/components/scripts/dayTable.inline.ts.
// DayTable.tsx가 afterDOMLoaded로 싣는다.
//   하위 사건 행: 사건 칸(2번째 칸, 사건 기록 표는 3번째)이 "↳"로 시작. 바로 위의 하위가 아닌 행이 큰 사건.
//   큰 사건이 하나라도 있는 표에는 맨 왼쪽에 좁은 '앞 칸'(bn-lead)을 한 줄씩 더한다.
//     큰 사건·단독 행: 앞 칸이 표의 일부(테두리·배경)이고, 큰 사건 행은 여기에 ▸ 버튼이 들어간다.
//     하위 행: 앞 칸이 투명해서(custom.scss) 표가 한 칸 안쪽에서 시작하는 것처럼 보인다.
//   일지 표(article 안)에서는 하위 행을 접었다 펴고, 그래프 선 창·사건 기록 표(.bn-case-table)에서는 접지 않는다.
//   나중에 만들어지는 표(그래프 선 창·사건 기록 표)도 같은 함수로 표시한다 (bn-table-ready 이벤트).

const SUB_MARK = "↳"

type Group = { parent: HTMLTableRowElement; kids: HTMLTableRowElement[] }

// 사건 칸: 사건 기록 표(.bn-has-day)는 앞에 일차 칸이 하나 더 있다
function eventCell(tr: HTMLTableRowElement, hasDay: boolean): HTMLTableCellElement | null {
  const cells = tr.querySelectorAll("td")
  return cells[hasDay ? 2 : 1] ?? null
}

function markTable(table: HTMLTableElement, collapsible: boolean) {
  if (table.dataset.bnMarked) return
  table.dataset.bnMarked = "1"
  const hasDay = !!table.closest(".bn-has-day")
  const rows = [...table.querySelectorAll<HTMLTableRowElement>("tbody > tr")]
  const groups: Group[] = []
  let current: Group | null = null

  for (const tr of rows) {
    const cell = eventCell(tr, hasDay)
    const text = (cell?.textContent ?? "").trimStart()
    if (cell && text.startsWith(SUB_MARK)) {
      tr.classList.add("bn-sub")
      // "↳" 글자는 지우고 들여쓰기(앞 칸)로 대신한다
      for (const node of [...cell.childNodes]) {
        if (node.nodeType === Node.TEXT_NODE && (node.textContent ?? "").includes(SUB_MARK)) {
          node.textContent = (node.textContent ?? "").replace(SUB_MARK, "").replace(/^\s+/, "")
          break
        }
      }
      if (current) current.kids.push(tr)
    } else {
      current = { parent: tr, kids: [] }
      groups.push(current)
    }
  }
  const withKids = groups.filter((g) => g.kids.length > 0)
  if (withKids.length === 0) return

  // 앞 칸 더하기 (머리줄 + 모든 행)
  table.classList.add("bn-has-lead")
  for (const htr of table.querySelectorAll<HTMLTableRowElement>("thead > tr")) {
    const th = document.createElement("th")
    th.className = "bn-lead"
    htr.prepend(th)
  }
  for (const tr of rows) {
    const td = document.createElement("td")
    td.className = "bn-lead"
    tr.prepend(td)
  }

  for (const g of withKids) {
    g.parent.classList.add("bn-parent")
    g.kids[g.kids.length - 1].classList.add("bn-last")
    // 앞 칸을 더했으니 사건 칸은 한 칸 뒤
    const evCell = g.parent.querySelectorAll("td")[(hasDay ? 2 : 1) + 1]
    const count = document.createElement("span")
    count.className = "bn-count"
    count.textContent = `${g.kids.length}건`
    evCell?.append(count)
    if (!collapsible) continue
    const lead = g.parent.querySelector<HTMLTableCellElement>("td.bn-lead")
    if (!lead) continue
    const btn = document.createElement("button")
    btn.type = "button"
    btn.className = "bn-toggle"
    btn.setAttribute("aria-expanded", "false")
    btn.title = `하위 사건 ${g.kids.length}건 펼치기`
    btn.textContent = "▸"
    const kids = g.kids
    for (const k of kids) k.classList.add("bn-collapsed")
    btn.addEventListener("click", (e) => {
      e.preventDefault()
      e.stopPropagation()
      const open = btn.getAttribute("aria-expanded") !== "true"
      btn.setAttribute("aria-expanded", open ? "true" : "false")
      btn.textContent = open ? "▾" : "▸"
      btn.title = open ? "하위 사건 접기" : `하위 사건 ${kids.length}건 펼치기`
      for (const k of kids) k.classList.toggle("bn-collapsed", !open)
    })
    lead.append(btn)
  }
}

function markAll(root: ParentNode) {
  for (const t of root.querySelectorAll<HTMLTableElement>("article table")) markTable(t, true)
  for (const t of root.querySelectorAll<HTMLTableElement>(".bn-case-table table")) markTable(t, false)
}

document.addEventListener("nav", () => markAll(document))
// 그래프 선 창·사건 기록 표가 만들어진 뒤 (bongnudo.ts·entityEvents.inline.ts가 띄운다)
document.addEventListener("bn-table-ready", (e) => {
  const el = (e as CustomEvent<HTMLElement>).detail
  if (el) for (const t of el.querySelectorAll<HTMLTableElement>("table")) markTable(t, false)
})
