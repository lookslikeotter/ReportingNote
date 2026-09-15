import { FullSlug, resolveRelative } from "../../util/path"
import { DayRow, linkResolver, loadContentData } from "./bongnudo"
import {
  PlaceNode,
  addPlaceMarkers,
  buildPlaceNodes,
  createMap,
  fitNodes,
  loadLeaflet,
  loadPostals,
  updateMarker,
} from "./bnMapLib"

// 봉누도2 — 지도 페이지(볼트 맨 위 `지도.md`)의 큰 지도. 원본은 볼트의 .quartz/quartz/components/scripts/bnMap.inline.ts.
// BnMap.tsx가 afterDOMLoaded로 싣는다. 지도 도구는 bnMapLib.ts.
//   - 위: 일차 고르기 (전체 · N일차). 고르면 점 크기가 그 일차의 사건 수로 바뀐다
//   - 점에 마우스를 올리면 오른쪽 사이드바의 사건 칸(MapPanel.tsx .bn-map-side)에 그곳에서 있었던 사건 목록이 채워진다.
//     일차별로 묶고, 하위 사건은 큰 사건 제목 아래 들여 쓴다 (큰 사건 자체는 장소가 하위의 합이라 세지 않는다).
//     지도 페이지에는 그래프·작은 지도가 없어서 그 자리를 이 칸이 쓴다. 다른 점에 올리기 전까지 그대로 남는다
//   - 점을 누르면 그 장소·세력 페이지로 간다 (노트가 없는 곳은 목록만)
//   - 아래 '위치를 모르는 장소': 일지 표 '장소' 칸에 있지만 좌표·우편번호를 몰라 못 찍은 곳

async function setup(section: HTMLElement, fullSlug: FullSlug) {
  const status = section.querySelector<HTMLElement>(".bn-map-status")
  const canvas = section.querySelector<HTMLElement>(".bn-map-canvas")
  const daysBar = section.querySelector<HTMLElement>(".bn-map-days")
  const unplacedBox = section.querySelector<HTMLElement>(".bn-map-unplaced")
  // 오른쪽 사이드바의 사건 칸 (MapPanel.tsx가 지도 페이지에만 만든다). 안쪽 함수들이 쓰므로 null이 아닌 값으로 잡아 둔다
  const panel = document.querySelector<HTMLElement>(".bn-map-side")!
  if (!canvas || !panel || !daysBar) return

  let L: any
  let graph: Awaited<ReturnType<typeof buildPlaceNodes>>
  try {
    const [leaflet, postals, data] = await Promise.all([loadLeaflet(), loadPostals(), loadContentData()])
    if (!section.isConnected) return
    L = leaflet
    const dark = getComputedStyle(document.documentElement).getPropertyValue("--dark").trim()
    graph = await buildPlaceNodes(fullSlug, data, linkResolver(data), postals, dark)
    if (!section.isConnected) return
    status?.remove()
    const map = createMap(L, canvas)
    window.addCleanup(() => map.remove())

    // ── 일차 고르기 ──
    let day: number | null = null
    const countOf = (n: PlaceNode) =>
      day === null ? n.rows.length : n.rows.filter((r) => r.dayN === day).length
    const rowsOf = (n: PlaceNode) => (day === null ? n.rows : n.rows.filter((r) => r.dayN === day))

    // ── 사건 칸 ──
    let shown: PlaceNode | null = null
    const dayLabel = () => (day === null ? "전체" : `${day}일차`)
    function renderPanel(n: PlaceNode) {
      shown = n
      panel.replaceChildren()
      const title = document.createElement("div")
      title.className = "bn-map-panel-title"
      if (n.slug) {
        const a = document.createElement("a")
        a.className = "internal"
        a.dataset.slug = n.slug
        a.href = new URL(resolveRelative(fullSlug, n.slug), location.toString()).toString()
        a.textContent = n.name
        title.append(a)
      } else {
        title.textContent = n.name
      }
      const rows = rowsOf(n)
      const sub = document.createElement("div")
      sub.className = "bn-map-panel-sub"
      sub.textContent = `${dayLabel()} · 사건 ${rows.length}건`
      panel.append(title, sub)
      if (rows.length === 0) {
        const p = document.createElement("p")
        p.className = "bn-map-empty"
        p.textContent = "여기서 있었던 사건이 아직 없다."
        panel.append(p)
        return
      }
      // 일차별로 묶고(전체일 때), 그 안에서 하위 사건은 큰 사건 제목 아래 들여 쓴다
      let list: HTMLUListElement | null = null
      let lastDay = -1
      let lastParent: string | undefined
      for (const r of rows) {
        if (day === null && r.dayN !== lastDay) {
          const h = document.createElement("h4")
          h.textContent = `${r.dayN}일차`
          list = document.createElement("ul")
          panel.append(h, list)
          lastDay = r.dayN
          lastParent = undefined
        } else if (!list) {
          list = document.createElement("ul")
          panel.append(list)
        }
        if (r.parent !== lastParent) {
          const parent = r.parent ? graph.parents.get(r.parent) : undefined
          if (parent) list.append(eventItem(parent, "bn-map-ev-parent"))
          lastParent = r.parent
        }
        list.append(eventItem(r, r.parent ? "bn-map-ev-sub" : ""))
      }
    }
    function eventItem(r: DayRow, extra = ""): HTMLLIElement {
      const li = document.createElement("li")
      li.className = `bn-map-ev bn-map-ev-${r.kind} ${extra}`.trim()
      const time = document.createElement("span")
      time.className = "bn-map-time"
      time.textContent = r.time
      const a = document.createElement("a")
      a.className = "internal"
      a.href = r.href
      a.dataset.slug = r.id
      a.textContent = r.title
      li.append(time, a)
      return li
    }

    // ── 점 ──
    const markers = addPlaceMarkers(L, map, graph.nodes, {
      count: countOf,
      labels: "always",
      over: (n) => renderPanel(n),
      click: (n) => {
        if (n.slug) {
          window.spaNavigate(new URL(resolveRelative(fullSlug, n.slug), location.toString()))
        } else {
          renderPanel(n)
        }
      },
    })
    fitNodes(L, map, graph.nodes)

    // ── 일차 단추 ──
    const chips: HTMLButtonElement[] = []
    const addChip = (label: string, value: number | null) => {
      const b = document.createElement("button")
      b.type = "button"
      b.textContent = label
      b.setAttribute("aria-pressed", String(value === day))
      b.addEventListener("click", () => {
        day = value
        for (const c of chips) c.setAttribute("aria-pressed", String(c === b))
        for (const n of graph.nodes) updateMarker(markers.get(n.key), countOf(n))
        if (shown) renderPanel(shown)
      })
      chips.push(b)
      daysBar.append(b)
    }
    addChip("전체", null)
    for (const d of graph.days) addChip(`${d}일차`, d)

    // ── 위치를 모르는 장소 ──
    if (unplacedBox && graph.unplaced.length > 0) {
      const total = graph.unplaced.reduce((s, u) => s + u.count, 0)
      unplacedBox.querySelector("summary")!.textContent =
        `위치를 모르는 장소 ${graph.unplaced.length}곳 (사건 ${total}건)`
      const ul = unplacedBox.querySelector("ul")!
      for (const u of graph.unplaced) {
        const li = document.createElement("li")
        if (u.slug) {
          const a = document.createElement("a")
          a.className = "internal"
          a.dataset.slug = u.slug
          a.href = new URL(resolveRelative(fullSlug, u.slug), location.toString()).toString()
          a.textContent = u.text
          li.append(a)
        } else {
          li.append(u.text)
        }
        li.append(` (${u.count}건)`)
        ul.append(li)
      }
      unplacedBox.hidden = false
    }
  } catch (e) {
    console.warn("[bn-map]", e)
    if (status) status.textContent = "지도를 불러오지 못했다."
  }
}

document.addEventListener("nav", (e: CustomEventMap["nav"]) => {
  const section = document.querySelector<HTMLElement>(".bn-map")
  if (!section) return
  void setup(section, e.detail.url)
})
