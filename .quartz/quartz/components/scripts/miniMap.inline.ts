import { FullSlug, SimpleSlug, resolveRelative, simplifySlug } from "../../util/path"
import { removeAllChildren } from "./util"
import { linkResolver, loadContentData } from "./bongnudo"
import {
  MAP_PAGE,
  PlaceNode,
  addPlaceMarkers,
  buildPlaceNodes,
  createMap,
  fitNodes,
  loadLeaflet,
  loadPostals,
} from "./bnMapLib"

// 봉누도2 — 오른쪽 위 작은 지도. 원본은 볼트의 .quartz/quartz/components/scripts/miniMap.inline.ts.
// MiniMap.tsx가 afterDOMLoaded로 싣는다. 지도 도구는 bnMapLib.ts.
//   - 장소 노드 전부를 점으로 (크기는 사건 수). 이름표는 마우스를 올렸을 때만
//   - 지금 페이지가 그 장소·세력이면, 또는 사건 페이지면 그 사건이 있었던 곳을 강조하고 그쪽으로 옮긴다
//   - 점을 누르면 그 장소·세력 페이지로, 노트가 없는 곳이면 지도 페이지로. 휠로 확대·축소
//   - 한 번 만든 지도는 페이지를 옮겨도 그대로 쓴다 (인물 그래프와 같은 방식). 새 기록이 오면 버린다

type Kept = {
  L: any
  root: HTMLElement
  map: any
  nodes: PlaceNode[]
  markers: Map<string, any>
  fullSlug: FullSlug
}
let kept: Kept | null = null
let building: Promise<void> | null = null

document.addEventListener("bn-content-updated", () => {
  kept?.map.remove()
  kept = null
})

async function build(container: HTMLElement, fullSlug: FullSlug) {
  const [L, postals, data] = await Promise.all([loadLeaflet(), loadPostals(), loadContentData()])
  const dark = getComputedStyle(document.documentElement).getPropertyValue("--dark").trim()
  const graph = await buildPlaceNodes(fullSlug, data, linkResolver(data), postals, dark)
  if (!container.isConnected) return
  const root = document.createElement("div")
  root.className = "bn-minimap-root"
  removeAllChildren(container)
  container.append(root)
  // 확대·축소는 휠·핀치로 (단추 없음)
  const map = createMap(L, root, { zoomControl: false })
  const markers = addPlaceMarkers(L, map, graph.nodes, {
    count: (n) => n.rows.length,
    labels: "hover",
    click: (n) => {
      const target = n.slug ?? MAP_PAGE
      window.spaNavigate(new URL(resolveRelative(kept?.fullSlug ?? fullSlug, target), location.toString()))
    },
  })
  kept = { L, root, map, nodes: graph.nodes, markers, fullSlug }
}

// 지금 페이지와 관계있는 노드: 그 장소·세력 자신, 또는 사건 페이지면 그 사건(하위 사건 포함)이 있었던 곳
function related(slug: SimpleSlug, nodes: PlaceNode[]): PlaceNode[] {
  const self = nodes.filter((n) => n.slug === slug)
  if (self.length > 0) return self
  return nodes.filter((n) => n.rows.some((r) => r.id === slug || r.parent === slug))
}

function highlight(k: Kept, slug: SimpleSlug) {
  const targets = new Set(related(slug, k.nodes))
  for (const n of k.nodes) {
    const m = k.markers.get(n.key)
    const on = targets.has(n)
    m.setStyle({ color: on ? "#f0a020" : "#ffffff", weight: on ? 3 : 2 })
    const tip = m.getTooltip()
    if (tip && tip.options.permanent !== on) {
      m.unbindTooltip().bindTooltip(n.name, { ...tip.options, permanent: on })
    }
    if (on) m.bringToFront()
  }
  if (targets.size > 0) {
    const pts = [...targets].map((n) => [n.y, n.x])
    if (pts.length === 1) k.map.setView(pts[0], Math.max(k.map.getZoom(), 4), { animate: true })
    else k.map.fitBounds(k.L.latLngBounds(pts), { padding: [30, 30], maxZoom: 4.5 })
  } else {
    fitNodes(k.L, k.map, k.nodes, 3.5)
  }
}

async function render(fullSlug: FullSlug) {
  const container = document.querySelector<HTMLElement>(".bn-minimap-container")
  // 숨겨진 상태(휴대폰에서 접혀 있음)면 펼칠 때 다시 온다 (bn-graph-mode)
  if (!container || container.offsetWidth === 0) return
  if (!kept) {
    if (!building) building = build(container, fullSlug).finally(() => (building = null))
    await building
    if (!kept) return
  } else if (kept.root.parentElement !== container) {
    removeAllChildren(container)
    container.append(kept.root)
    kept.map.invalidateSize({ animate: false })
  }
  kept.fullSlug = fullSlug
  highlight(kept, simplifySlug(fullSlug))
}

document.addEventListener("nav", (e: CustomEventMap["nav"]) => {
  const fullSlug = e.detail.url
  void render(fullSlug)
  const onMode = () => void render(fullSlug)
  document.addEventListener("bn-graph-mode", onMode)
  window.addCleanup(() => document.removeEventListener("bn-graph-mode", onMode))
})
