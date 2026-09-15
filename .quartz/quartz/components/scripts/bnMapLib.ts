import { FullSlug, SimpleSlug } from "../../util/path"
import {
  ContentData,
  DayRow,
  factionColors,
  fetchDays,
  nodeLabel,
  normalizeName,
  readDayTables,
} from "./bongnudo"

// 봉누도2 — 지도 페이지(bnMap.inline.ts)와 오른쪽 작은 지도(miniMap.inline.ts)가 함께 쓰는 지도 도구.
// 원본은 볼트의 .quartz/quartz/components/scripts/bnMapLib.ts.
//   - 바탕 지도: static/map/tiles/{z}/{x}/{y}.webp (GTA V Atlas 스타일 조각, .github/scripts/map-tiles.js가 받아 둔 것)
//   - 좌표계: gta-v-map-leaflet 방식 — 게임 좌표를 그대로 Leaflet 좌표([y, x])로 쓰고, 조각 픽셀로 바꾸는 식은
//     px = x·0.02072 + 117.3, py = −y·0.0205 + 172.8 (확대 0단계 256px 기준, 단계마다 2배)
//   - 우편번호: static/map/postals.json ({ "8032": [x, y] }) — 우편번호를 게임 좌표로 바꾸는 표.
//     노트의 `우편번호`와 일지 표 '장소' 칸에 우편번호가 적힌 사건("미션로우 8032")이 이걸로 자리를 찾는다 (지도에 번호를 그리지는 않는다)
//   - 장소 노드: 세력·장소 노트의 `좌표`·`우편번호`(bn-days.json places). 일지 표 '장소' 칸의 링크·글자를
//     노트 이름·별칭·`포함장소`로 찾아 그 노드에 사건을 모은다. 찾지 못한 장소는 '위치를 모르는 장소'로 돌려준다
// Leaflet은 Quartz에 없어서 static/map/leaflet.js를 페이지에 끼워 넣어 쓴다 (전역 L)

export const MAP_PAGE = "지도" as SimpleSlug

// 지도 세계의 범위 [[y, x], [y, x]] (gta-v-map-leaflet의 maxBounds)
const MAP_BOUNDS: [[number, number], [number, number]] = [
  [-4000, -5500],
  [8000, 6000],
]
const TILE_MAX_ZOOM = 5

// ── 사이트 파일 ──

// static/map/ 주소 (postscript.js가 있는 곳이 사이트 맨 위)
export function mapBase(): URL {
  const s = [...document.querySelectorAll<HTMLScriptElement>("script[src]")].find((el) =>
    el.src.includes("postscript.js"),
  )
  return new URL("static/map/", new URL(".", s?.src ?? location.href))
}

// Leaflet 스타일은 사이트 안 이동(SPA) 때 <head>에서 지워지지 않게 spa-preserve를 붙이고, 그래도 없으면 다시 넣는다
// (스타일이 빠지면 조각이 제자리에 놓이지 않고 흩어져 보인다)
function ensureLeafletCss() {
  if (document.head.querySelector('link[data-bn-leaflet]')) return
  const css = document.createElement("link")
  css.rel = "stylesheet"
  css.href = new URL("leaflet.css", mapBase()).toString()
  css.setAttribute("spa-preserve", "")
  css.setAttribute("data-bn-leaflet", "")
  document.head.append(css)
}

let leafletPromise: Promise<any> | null = null
export function loadLeaflet(): Promise<any> {
  const w = window as any
  ensureLeafletCss()
  if (w.L) return Promise.resolve(w.L)
  if (!leafletPromise) {
    const base = mapBase()
    leafletPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script")
      script.src = new URL("leaflet.js", base).toString()
      script.setAttribute("spa-preserve", "")
      script.onload = () => resolve(w.L)
      script.onerror = () => {
        leafletPromise = null
        reject(new Error("leaflet.js를 불러오지 못함"))
      }
      document.head.append(script)
    })
  }
  return leafletPromise
}

export type Postals = Record<string, [number, number]>
let postalsPromise: Promise<Postals> | null = null
export function loadPostals(): Promise<Postals> {
  if (!postalsPromise) {
    postalsPromise = fetch(new URL("postals.json", mapBase()))
      .then((r) => (r.ok ? (r.json() as Promise<Postals>) : Promise.reject(new Error("postals"))))
      .catch((e) => {
        postalsPromise = null
        throw e
      })
  }
  return postalsPromise
}

// ── 지도 만들기 ──

export function createMap(
  L: any,
  el: HTMLElement,
  opts: { zoomControl?: boolean; scrollWheelZoom?: boolean } = {},
): any {
  const crs = L.extend({}, L.CRS.Simple, {
    projection: L.Projection.LonLat,
    transformation: new L.Transformation(0.02072, 117.3, -0.0205, 172.8),
    infinite: true,
  })
  const map = L.map(el, {
    crs,
    minZoom: 2,
    maxZoom: 7,
    zoomSnap: 0.5,
    zoomDelta: 0.5,
    wheelPxPerZoomLevel: 90,
    attributionControl: false,
    zoomControl: opts.zoomControl ?? true,
    scrollWheelZoom: opts.scrollWheelZoom ?? true,
    maxBounds: MAP_BOUNDS,
    maxBoundsViscosity: 1,
    center: [0, 0],
    zoom: 3,
  })
  L.tileLayer(mapBase().toString() + "tiles/{z}/{x}/{y}.webp", {
    minZoom: 0,
    maxZoom: 7,
    maxNativeZoom: TILE_MAX_ZOOM,
    tileSize: 256,
    noWrap: true,
    bounds: MAP_BOUNDS,
    keepBuffer: 2,
  }).addTo(map)
  return map
}

// ── 장소 노드 ──

export type PlaceNode = {
  key: string
  // 노트가 있으면 그 주소 (우편번호만으로 찍힌 곳은 없음)
  slug?: SimpleSlug
  name: string
  x: number
  y: number
  color: string
  // 이곳에서 있었던 사건 행 (하위·단독 행만, 일지 순서)
  rows: DayRow[]
}
export type Unplaced = { key: string; text: string; slug?: SimpleSlug; count: number }
export type PlaceGraph = {
  nodes: PlaceNode[]
  unplaced: Unplaced[]
  days: number[]
  // 큰 사건 행 (사건 주소 → 행). 하위 행의 parent로 찾아 목록에 묶음 제목으로 쓴다
  parents: Map<SimpleSlug, DayRow>
}

const POSTAL_IN_TEXT = /(?<!\d)(\d{4,5})(?!\d)/

export async function buildPlaceNodes(
  currentSlug: FullSlug,
  data: ContentData,
  resolveLink: (dest: SimpleSlug) => SimpleSlug,
  postals: Postals,
  defaultColor: string,
): Promise<PlaceGraph> {
  const dayData = await fetchDays(currentSlug)
  const places = dayData?.places ?? {}
  const fcolors = await factionColors(currentSlug)
  const { rows } = await readDayTables(currentSlug, data, resolveLink)

  // 이름·별칭·포함장소 → 노트, 위치가 있는 노트 → 노드
  const noteByName = new Map<string, SimpleSlug>()
  const nodes = new Map<string, PlaceNode>()
  for (const [slug, p] of Object.entries(places)) {
    for (const n of p.names) {
      const k = normalizeName(n)
      if (!noteByName.has(k)) noteByName.set(k, slug as SimpleSlug)
    }
    let x = p.x
    let y = p.y
    if ((x === undefined || y === undefined) && p.postal && postals[p.postal]) {
      ;[x, y] = postals[p.postal]
    }
    if (x === undefined || y === undefined) continue
    nodes.set(slug, {
      key: slug,
      slug: slug as SimpleSlug,
      name: nodeLabel(data.get(slug as SimpleSlug)?.title ?? p.names[0] ?? slug),
      x,
      y,
      color: slug.startsWith("03-세력/") ? (fcolors[slug] ?? defaultColor) : defaultColor,
      rows: [],
    })
  }

  // 사건 행을 장소에 붙인다
  const postalTexts = new Map<string, Map<string, number>>()
  const unplaced = new Map<string, Unplaced>()
  const days = new Set<number>()
  const parents = new Map<SimpleSlug, DayRow>()
  for (const r of rows) {
    if (r.hasSubs) {
      parents.set(r.id, r)
      continue
    }
    days.add(r.dayN)
    const seen = new Set<string>()
    for (const ref of r.places) {
      const slug = ref.slug ?? noteByName.get(normalizeName(ref.text))
      let node = slug ? nodes.get(slug) : undefined
      if (!node && !slug) {
        // 노트는 없지만 글자에 우편번호가 있으면 그 자리 ("미션로우 8032")
        const code = ref.text.match(POSTAL_IN_TEXT)?.[1]
        if (code && postals[code]) {
          const key = "postal:" + code
          if (!nodes.has(key)) {
            nodes.set(key, {
              key,
              name: ref.text,
              x: postals[code][0],
              y: postals[code][1],
              color: defaultColor,
              rows: [],
            })
          }
          node = nodes.get(key)
          const texts = postalTexts.get(key) ?? new Map<string, number>()
          texts.set(ref.text, (texts.get(ref.text) ?? 0) + 1)
          postalTexts.set(key, texts)
        }
      }
      if (node) {
        if (!seen.has(node.key)) {
          node.rows.push(r)
          seen.add(node.key)
        }
        continue
      }
      const key = slug ?? "text:" + normalizeName(ref.text)
      if (seen.has(key)) continue
      seen.add(key)
      const u = unplaced.get(key) ?? {
        key,
        text: slug ? nodeLabel(data.get(slug)?.title ?? ref.text) : ref.text,
        slug,
        count: 0,
      }
      u.count++
      unplaced.set(key, u)
    }
  }
  // 우편번호 노드 이름은 가장 자주 적힌 글자
  for (const [key, texts] of postalTexts) {
    nodes.get(key)!.name = [...texts.entries()].sort((a, b) => b[1] - a[1])[0][0]
  }

  return {
    nodes: [...nodes.values()],
    unplaced: [...unplaced.values()].sort((a, b) => b.count - a.count),
    days: [...days].sort((a, b) => a - b),
    parents,
  }
}

// ── 마커 ──

// 사건 수에 따른 점 크기 (그래프 노드처럼 많을수록 크게)
export function radiusFor(count: number): number {
  return count === 0 ? 4 : Math.min(18, 5 + 2 * Math.sqrt(count))
}

export type MarkerOpts = {
  count: (n: PlaceNode) => number
  // 이름표를 늘 보일지, 마우스를 올렸을 때만 보일지
  labels: "always" | "hover"
  over?: (n: PlaceNode, marker: any) => void
  out?: (n: PlaceNode, marker: any) => void
  click?: (n: PlaceNode, marker: any) => void
}

export function addPlaceMarkers(
  L: any,
  map: any,
  nodes: PlaceNode[],
  opts: MarkerOpts,
): Map<string, any> {
  const markers = new Map<string, any>()
  for (const n of nodes) {
    const count = opts.count(n)
    const marker = L.circleMarker([n.y, n.x], {
      radius: radiusFor(count),
      color: "#ffffff",
      weight: 2,
      opacity: count === 0 ? 0.6 : 1,
      fillColor: n.color,
      fillOpacity: count === 0 ? 0.45 : 0.95,
    }).addTo(map)
    // 이름표는 노트가 있는 곳은 위, 우편번호로만 찍힌 곳은 아래 (가까운 두 곳의 이름표가 겹치지 않게)
    const below = !n.slug
    marker.bindTooltip(n.name, {
      permanent: opts.labels === "always",
      direction: below ? "bottom" : "top",
      offset: [0, (radiusFor(count) + 2) * (below ? 1 : -1)],
      className: "bn-map-label" + (count === 0 ? " bn-dim" : ""),
      opacity: 1,
    })
    if (opts.over) marker.on("mouseover", () => opts.over!(n, marker))
    if (opts.out) marker.on("mouseout", () => opts.out!(n, marker))
    if (opts.click) marker.on("click", () => opts.click!(n, marker))
    markers.set(n.key, marker)
  }
  return markers
}

// 사건 수가 바뀌었을 때(일차 고르기) 점 크기·흐림을 맞춘다
export function updateMarker(marker: any, count: number) {
  marker.setRadius(radiusFor(count))
  marker.setStyle({ opacity: count === 0 ? 0.6 : 1, fillOpacity: count === 0 ? 0.45 : 0.95 })
  const el = marker.getTooltip()?.getElement() as HTMLElement | undefined
  el?.classList.toggle("bn-dim", count === 0)
}

// 노드들이 다 보이도록 화면을 맞춘다 (노드가 없으면 섬 가운데)
export function fitNodes(L: any, map: any, nodes: PlaceNode[], maxZoom = 4) {
  if (nodes.length === 0) {
    map.setView([-1000, 0], 3)
    return
  }
  map.fitBounds(
    L.latLngBounds(nodes.map((n) => [n.y, n.x])),
    { padding: [36, 36], maxZoom, animate: false },
  )
}
