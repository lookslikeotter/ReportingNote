// 봉누도2 — 일지 표의 큰 사건/하위 사건 행. 원본은 볼트의 .quartz/quartz/components/scripts/dayTable.inline.ts.
// DayTable.tsx가 afterDOMLoaded로 싣는다.
//   하위 사건 행: 사건 칸(2번째 칸, 사건 기록 표는 3번째)이 "↳"로 시작. 바로 위의 하위가 아닌 행이 큰 사건.
//   큰 사건 행(bn-parent)은 그룹 머리처럼 칠하고 ▸ 버튼을 단다.
//   하위 행들은 큰 사건 행 바로 아래의 한 칸짜리 행(bn-subwrap) 안에 **작은 표(bn-subtable)**로 옮겨 넣는다.
//   그 작은 표가 안쪽으로 들여쓰여 카드처럼 보인다 (custom.scss). 열 이름은 바깥 표의 머리줄을 복사한다.
//   일지 표(article 안)와 인물·세력·장소 페이지의 사건 기록 표(.bn-entity-events)에서는 접었다 펴고,
//   그래프 선 창(.bn-case-table)에서는 항상 펼쳐 둔다.
//   나중에 만들어지는 표(그래프 선 창·사건 기록 표)도 같은 함수로 표시한다 (bn-table-ready 이벤트).
//   펼친 큰 사건과 스크롤 위치는 페이지(slug)마다 브라우저 세션에 남겨서, 다른 페이지에 갔다 돌아오면 그대로 되살린다
//   (자동 갱신으로 페이지가 제자리에서 다시 그려질 때도 같다).

const SUB_MARK = "↳"

type Group = { parent: HTMLTableRowElement; kids: HTMLTableRowElement[] }

// ── 페이지별 상태 (펼친 큰 사건 · 스크롤) ──
const STATE_PREFIX = "bn-day-state:"
type SavedState = { open: string[]; y: number }
function pageKey(): string {
  return STATE_PREFIX + (document.body.dataset.slug ?? location.pathname)
}
function loadState(): SavedState {
  try {
    const s = JSON.parse(sessionStorage.getItem(pageKey()) ?? "null")
    if (s && Array.isArray(s.open)) return { open: s.open, y: Number(s.y) || 0 }
  } catch {}
  return { open: [], y: 0 }
}
function saveState(patch: Partial<SavedState>) {
  try {
    sessionStorage.setItem(pageKey(), JSON.stringify({ ...loadState(), ...patch }))
  } catch {}
}
function rememberOpen(id: string, open: boolean) {
  if (!id) return
  const set = new Set(loadState().open)
  open ? set.add(id) : set.delete(id)
  saveState({ open: [...set] })
}

// 사건 칸: 사건 기록 표(.bn-has-day)는 앞에 일차 칸이 하나 더 있다
function eventCell(tr: HTMLTableRowElement, hasDay: boolean): HTMLTableCellElement | null {
  const cells = tr.querySelectorAll("td")
  return cells[hasDay ? 2 : 1] ?? null
}

function markTable(table: HTMLTableElement, collapsible: boolean) {
  if (table.dataset.bnMarked || table.classList.contains("bn-subtable-table")) return
  table.dataset.bnMarked = "1"
  const hasDay = !!table.closest(".bn-has-day")
  const rows = [...table.querySelectorAll<HTMLTableRowElement>(":scope > tbody > tr")]
  const groups: Group[] = []
  let current: Group | null = null

  for (const tr of rows) {
    const cell = eventCell(tr, hasDay)
    const text = (cell?.textContent ?? "").trimStart()
    if (cell && text.startsWith(SUB_MARK)) {
      tr.classList.add("bn-sub")
      // "↳" 글자는 지운다 (들여쓰기는 작은 표가 대신한다)
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
  const colCount = Math.max(1, ...rows.map((r) => r.querySelectorAll("td").length))
  const thead = table.querySelector(":scope > thead")
  const remembered = new Set(collapsible ? loadState().open : [])

  for (const g of groups) {
    if (g.kids.length === 0) continue
    g.parent.classList.add("bn-parent")

    // 하위 행을 담을 작은 표
    const wrap = document.createElement("tr")
    wrap.className = "bn-subwrap"
    const cell = document.createElement("td")
    cell.colSpan = colCount
    const box = document.createElement("div")
    box.className = "bn-subtable"
    const inner = document.createElement("table")
    inner.className = "bn-subtable-table"
    if (thead) inner.append(document.importNode(thead, true))
    const tbody = document.createElement("tbody")
    for (const k of g.kids) tbody.append(k)
    inner.append(tbody)
    box.append(inner)
    cell.append(box)
    wrap.append(cell)
    g.parent.after(wrap)

    // 건수 배지
    const evCell = eventCell(g.parent, hasDay)
    const count = document.createElement("span")
    count.className = "bn-count"
    count.textContent = `${g.kids.length}건`
    evCell?.append(count)

    if (!collapsible) {
      g.parent.classList.add("bn-open")
      continue
    }
    wrap.classList.add("bn-collapsed")
    const btn = document.createElement("button")
    btn.type = "button"
    btn.className = "bn-toggle"
    btn.setAttribute("aria-expanded", "false")
    btn.title = `하위 사건 ${g.kids.length}건 펼치기`
    btn.innerHTML =
      '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
    // 큰 사건의 사건 노트 주소 = 기억할 때 쓰는 이름
    const id = evCell?.querySelector<HTMLElement>("a[data-slug]")?.dataset.slug ?? ""
    const toggle = (remember = true) => {
      const open = btn.getAttribute("aria-expanded") !== "true"
      btn.setAttribute("aria-expanded", open ? "true" : "false")
      btn.title = open ? "하위 사건 접기" : `하위 사건 ${g.kids.length}건 펼치기`
      wrap.classList.toggle("bn-collapsed", !open)
      g.parent.classList.toggle("bn-open", open)
      if (remember) rememberOpen(id, open)
    }
    btn.addEventListener("click", (e) => {
      e.preventDefault()
      e.stopPropagation()
      toggle()
    })
    // 큰 사건 행 어디를 눌러도 펼쳐진다 (링크는 빼고)
    g.parent.classList.add("bn-clickable")
    g.parent.addEventListener("click", (e) => {
      if ((e.target as Element).closest("a, button")) return
      toggle()
    })
    // 맨 왼쪽 칸(시간 또는 일차) 앞에
    g.parent.querySelector("td")?.prepend(btn)
    // 이 페이지에서 전에 펼쳐 둔 것이면 그대로 펼친다
    if (remembered.has(id)) toggle(false)
  }
}

// 스크롤 위치를 페이지마다 남긴다 (nav 때 붙이고, 다음 이동 전에 뗀다)
function trackScroll() {
  let raf = 0
  const onScroll = () => {
    if (raf) return
    raf = requestAnimationFrame(() => {
      raf = 0
      saveState({ y: window.scrollY })
    })
  }
  window.addEventListener("scroll", onScroll, { passive: true })
  window.addCleanup(() => {
    window.removeEventListener("scroll", onScroll)
    cancelAnimationFrame(raf)
  })
}

// 전에 남긴 스크롤 위치로 (표를 표시한 뒤, 화면이 잡힌 다음 프레임에)
function restoreScroll() {
  const { y } = loadState()
  if (y <= 0) return
  requestAnimationFrame(() => window.scrollTo({ top: y }))
}

function markAll(root: ParentNode) {
  for (const t of root.querySelectorAll<HTMLTableElement>("article table")) markTable(t, true)
  for (const t of root.querySelectorAll<HTMLTableElement>(".bn-case-table table")) markTable(t, false)
}

document.addEventListener("nav", () => {
  markAll(document.body)
  restoreScroll()
  trackScroll()
})
// 그래프 선 창·사건 기록 표가 만들어진 뒤 (bongnudo.ts·entityEvents.inline.ts가 띄운다)
document.addEventListener("bn-table-ready", (e) => {
  const el = (e as CustomEvent<HTMLElement>).detail
  if (!el) return
  // 사건 기록 표는 길어지므로 접어 두고, 선 창의 표는 펼쳐 둔다
  const collapsible = !!el.closest(".bn-entity-events")
  for (const t of el.querySelectorAll<HTMLTableElement>("table")) markTable(t, collapsible)
})
