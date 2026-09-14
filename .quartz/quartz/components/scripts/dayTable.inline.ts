// 봉누도2 — 일지 표의 큰 사건/하위 사건 행. 원본은 볼트의 .quartz/quartz/components/scripts/dayTable.inline.ts.
// DayTable.tsx가 afterDOMLoaded로 싣는다.
//   하위 사건 행: 사건 칸(2번째 칸, 사건 기록 표는 3번째)이 "↳"로 시작. 바로 위의 하위가 아닌 행이 큰 사건.
//   행에 bn-sub / bn-parent 클래스를 붙이고, 일지 표(article 안)에서는 큰 사건 행에 ▸ 버튼을 달아 하위 행을 접었다 편다.
//   나중에 만들어지는 표(그래프 선 창·사건 기록 표)도 같은 함수로 표시한다 (bn-table-ready 이벤트).

const SUB_MARK = "↳"

// 사건 칸: 사건 기록 표(.bn-has-day)는 앞에 일차 칸이 하나 더 있다
function eventCell(tr: HTMLTableRowElement, hasDay: boolean): HTMLTableCellElement | null {
  const cells = tr.querySelectorAll("td")
  return cells[hasDay ? 2 : 1] ?? null
}

function markTable(table: HTMLTableElement, collapsible: boolean) {
  if (table.dataset.bnMarked) return
  table.dataset.bnMarked = "1"
  const hasDay = !!table.closest(".bn-has-day")
  let parent: HTMLTableRowElement | null = null
  let children: HTMLTableRowElement[] = []

  const finish = () => {
    if (!parent || children.length === 0) return
    parent.classList.add("bn-parent")
    if (!collapsible) return
    const cell = eventCell(parent, hasDay)
    if (!cell) return
    const btn = document.createElement("button")
    btn.type = "button"
    btn.className = "bn-toggle"
    btn.setAttribute("aria-expanded", "false")
    btn.title = `하위 사건 ${children.length}건 펼치기`
    btn.textContent = "▸"
    const kids = children
    for (const k of kids) k.classList.add("bn-collapsed")
    kids[kids.length - 1].classList.add("bn-last")
    btn.addEventListener("click", (e) => {
      e.preventDefault()
      e.stopPropagation()
      const open = btn.getAttribute("aria-expanded") !== "true"
      btn.setAttribute("aria-expanded", open ? "true" : "false")
      btn.textContent = open ? "▾" : "▸"
      btn.title = open ? "하위 사건 접기" : `하위 사건 ${kids.length}건 펼치기`
      for (const k of kids) k.classList.toggle("bn-collapsed", !open)
    })
    cell.prepend(btn)
    const count = document.createElement("span")
    count.className = "bn-count"
    count.textContent = `${children.length}건`
    cell.append(count)
  }

  for (const tr of table.querySelectorAll<HTMLTableRowElement>("tbody > tr")) {
    const cell = eventCell(tr, hasDay)
    const text = (cell?.textContent ?? "").trimStart()
    if (cell && text.startsWith(SUB_MARK)) {
      tr.classList.add("bn-sub")
      // "↳" 글자는 지우고 들여쓰기(custom.scss)로 대신한다
      for (const node of [...cell.childNodes]) {
        if (node.nodeType === Node.TEXT_NODE && (node.textContent ?? "").includes(SUB_MARK)) {
          node.textContent = (node.textContent ?? "").replace(SUB_MARK, "").replace(/^\s+/, "")
          break
        }
      }
      if (parent) children.push(tr)
    } else {
      finish()
      parent = tr
      children = []
    }
  }
  finish()
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
