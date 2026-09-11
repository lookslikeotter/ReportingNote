import type { ContentDetails } from "../../plugins/emitters/contentIndex"
import { FullSlug, SimpleSlug, resolveRelative } from "../../util/path"

// 봉누도2 — 그래프 스크립트 두 개가 함께 쓰는 규칙과 도구.
//   graph.inline.ts: 오른쪽 아래 그래프와 전체 그래프 / peopleGraph.inline.ts: 인물 그래프
// 원본은 볼트의 .quartz/quartz/components/scripts/bongnudo.ts.

export type ContentData = Map<SimpleSlug, ContentDetails>

// ── 노드 ──

// 분류 태그별 노드 색 (앞에 있는 태그가 우선). 해당 태그가 없으면 fallback(기본 글자색)
const CATEGORY_COLORS: [string, string][] = [
  ["갱", "#e03131"],
  ["기관", "#0075de"],
  ["시민", "#1aae39"],
]

export function categoryColor(tags: string[], fallback: string): string {
  return CATEGORY_COLORS.find(([tag]) => tags.includes(tag))?.[1] ?? fallback
}

// 그래프에 남기는 정보 노드: 인물·세력·장소 (목록 문서는 뺀다)
const INFO_PREFIXES = ["02-인물/", "03-세력/", "04-장소/"]
const INFO_EXCLUDE = ["02-인물/인물-목록", "03-세력/세력-목록"]

export function isInfoNode(id: string): boolean {
  return INFO_PREFIXES.some((p) => id.startsWith(p)) && !INFO_EXCLUDE.includes(id)
}

export function isPersonNode(id: string): boolean {
  return isInfoNode(id) && id.startsWith("02-인물/")
}

// 노드 이름표: 인물 이름 앞 번호(001 등)는 뗀다
export function nodeLabel(title: string): string {
  return title.replace(/^\d{3}\s+/, "")
}

// ── 이름·링크 ──

// 두 노드 쌍의 순서 없는 키
export const pairKey = (a: string, b: string) => (a < b ? a + "|" + b : b + "|" + a)

// 태그와 노트 이름 비교용: 띄어쓰기·하이픈을 뺀다 (태그 판도라연구소 = 노트 판도라-연구소)
export const normalizeName = (s: string) => s.replace(/[\s-]/g, "")

// 세력 이름(normalizeName) → 세력 노트 주소. 파일명과 제목 모두로 찾을 수 있다.
export function factionIndex(data: ContentData): Map<string, SimpleSlug> {
  const index = new Map<string, SimpleSlug>()
  for (const [id, details] of data.entries()) {
    if (!id.startsWith("03-세력/") || id.endsWith("/") || !isInfoNode(id)) continue
    const base = id.split("/").pop() ?? ""
    if (base) index.set(normalizeName(base), id)
    if (details.title) index.set(normalizeName(details.title), id)
  }
  return index
}

// 별칭·짧은 이름 링크를 실제 노트 주소로 되돌리는 함수를 만든다.
// Quartz는 파일명과 같은 별칭(aliases)이 있으면 [[표민수]] 같은 짧은 링크를 별칭 주소('표민수')로 풀어서,
// 실제 노트('02-인물/테스트/표민수')와 다른 노드가 된다. 이름(앞 번호 제외)이 같은 노트가 하나뿐이면 그 노트로 본다.
export function linkResolver(data: ContentData): (dest: SimpleSlug) => SimpleSlug {
  const baseName = (id: string) => (id.split("/").pop() ?? "").replace(/^\d+-/, "")
  const index = new Map<string, SimpleSlug | null>()
  for (const id of data.keys()) {
    const base = baseName(id)
    if (base) index.set(base, index.has(base) ? null : id)
  }
  return (dest) => (data.has(dest) ? dest : (index.get(baseName(dest)) ?? dest))
}

// ── 사건 인연 선 ──

// 📰 사건·🔥 특종 태그가 붙은 사건 노트만 선을 만든다 (☕ 일상 사건은 태그가 없다)
const EVENT_TAGS = ["사건", "특종"]

export type EventPair = {
  source: SimpleSlug
  target: SimpleSlug
  // 함께 엮인 사건 수 (선 굵기)
  weight: number
  // 그 사건 노트들 (선을 누르면 표로 보여 줌)
  events: SimpleSlug[]
}

// 사건 노트 본문에 함께 링크된 당사자(isParticipant) 두 명마다 한 쌍을 만든다. 키는 pairKey.
export function eventPairs(
  data: ContentData,
  resolveLink: (dest: SimpleSlug) => SimpleSlug,
  isParticipant: (id: SimpleSlug) => boolean,
): Map<string, EventPair> {
  const pairs = new Map<string, EventPair>()
  for (const [eventId, details] of data.entries()) {
    if (!(details.tags ?? []).some((t) => EVENT_TAGS.includes(t))) continue
    const involved = [...new Set((details.links ?? []).map(resolveLink).filter(isParticipant))]
    for (let i = 0; i < involved.length; i++) {
      for (let j = i + 1; j < involved.length; j++) {
        const key = pairKey(involved[i], involved[j])
        const pair = pairs.get(key)
        if (pair) {
          pair.weight++
          pair.events.push(eventId)
        } else {
          pairs.set(key, { source: involved[i], target: involved[j], weight: 1, events: [eventId] })
        }
      }
    }
  }
  return pairs
}

// 사건 인연 선 굵기: 1건 0.8, 1건 늘 때마다 +0.6, 최대 4
export function eventLinkWidth(weight: number): number {
  return Math.min(0.8 + 0.6 * (weight - 1), 4)
}

// 마우스를 올린 선은 이만큼 더 굵게
export const HOVER_EXTRA_WIDTH = 1.5

// ── 선 위 마우스 ──

// 선은 마우스에 반응하지 않는 그림이라, 마우스 위치(캔버스 좌표)에서 가장 가까운 선을 직접 찾는다.
// 화면 기준 LINK_HIT_PX 안에 있는 선만. 노드 좌표는 캔버스 가운데(width/2, height/2)가 원점이다.
const LINK_HIT_PX = 6
type Point = { x?: number; y?: number }

export function nearestLink<L extends { simulationData: { source: Point; target: Point } }>(
  links: L[],
  px: number,
  py: number,
  transform: { x: number; y: number; k: number },
  width: number,
  height: number,
): L | null {
  const { x: tx, y: ty, k } = transform
  const wx = (px - tx) / k - width / 2
  const wy = (py - ty) / k - height / 2
  let best: L | null = null
  let bestDist = LINK_HIT_PX / k
  for (const l of links) {
    const { source: s, target: t } = l.simulationData
    if (s.x === undefined || s.y === undefined || t.x === undefined || t.y === undefined) continue
    const dx = t.x - s.x
    const dy = t.y - s.y
    const len2 = dx * dx + dy * dy
    const u = len2 > 0 ? Math.max(0, Math.min(1, ((wx - s.x) * dx + (wy - s.y) * dy) / len2)) : 0
    const dist = Math.hypot(wx - (s.x + u * dx), wy - (s.y + u * dy))
    if (dist < bestDist) {
      bestDist = dist
      best = l
    }
  }
  return best
}

// ── 선을 누르면 뜨는 창 ──

export type EdgePopupItem = { icon: string; label: string; desc?: string; href?: string }

// 창을 띄운다. content는 간단한 목록(항목 배열)이나 이미 만든 요소(사건 표).
// Esc나 창 바깥을 누르면 닫힌다. 창 안의 링크를 누르면 창을 닫고, 이동은 사이트의 링크 처리에 맡긴다.
export function showEdgePopup(
  title: string,
  subtitle: string,
  content: EdgePopupItem[] | HTMLElement,
) {
  document.querySelector(".bn-edge-popup")?.remove()
  const outer = document.createElement("div")
  outer.className = "bn-edge-popup"
  const card = document.createElement("div")
  card.className = "bn-edge-card"
  const head = document.createElement("div")
  head.className = "bn-edge-title"
  head.textContent = title
  const sub = document.createElement("div")
  sub.className = "bn-edge-subtitle"
  sub.textContent = subtitle
  card.append(head, sub)

  if (Array.isArray(content)) {
    const list = document.createElement("ul")
    list.className = "bn-edge-list"
    for (const it of content) {
      const li = document.createElement("li")
      const label = document.createElement(it.href ? "a" : "span")
      label.className = "bn-edge-item"
      label.textContent = `${it.icon} ${it.label}`
      if (it.href) (label as HTMLAnchorElement).href = it.href
      li.append(label)
      if (it.desc) {
        const desc = document.createElement("div")
        desc.className = "bn-edge-desc"
        desc.textContent = it.desc
        li.append(desc)
      }
      list.append(li)
    }
    card.append(list)
  } else {
    card.append(content)
  }
  outer.append(card)
  document.body.append(outer)

  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape") close()
  }
  function close() {
    outer.remove()
    document.removeEventListener("keydown", onKey)
  }
  card.addEventListener("click", (e) => {
    if ((e.target as Element).closest("a")) close()
  })
  outer.addEventListener("click", (e) => {
    if (e.target === outer) close()
  })
  document.addEventListener("keydown", onKey)
}

// 사건 노트 본문 '개요' 첫 줄 = 한 줄 요약
function eventSummary(details: ContentDetails | undefined): string {
  const m = (details?.content ?? "").match(/개요\s*\n+\s*([^\n]+)/)
  return (m?.[1] ?? "").trim()
}

// 일차·순번 정렬 값 ("1일차-03 …" → 1003)
function eventOrder(title: string): number {
  const m = title.match(/^(\d+)일차-(\d+)/)
  return m ? Number(m[1]) * 1000 + Number(m[2]) : 0
}

// 일지 페이지(N일차) HTML. 실패는 기억하지 않는다 (다음에 다시 시도)
const dayPageCache = new Map<string, Promise<Document | null>>()
function fetchDayPage(url: string): Promise<Document | null> {
  let p = dayPageCache.get(url)
  if (!p) {
    p = fetch(url)
      .then((r) => (r.ok ? r.text() : Promise.reject()))
      .then((html) => new DOMParser().parseFromString(html, "text/html"))
      .catch(() => {
        dayPageCache.delete(url)
        return null
      })
    dayPageCache.set(url, p)
  }
  return p
}

// 일지 표 머리줄 (일지 페이지를 못 읽었을 때만 쓴다)
function defaultHead(): HTMLElement {
  const thead = document.createElement("thead")
  const tr = document.createElement("tr")
  for (const h of ["", "시간", "사건", "요약", "관련 인물"]) {
    const th = document.createElement("th")
    th.textContent = h
    tr.append(th)
  }
  thead.append(tr)
  return thead
}

// 일지 표에서 행을 못 찾은 사건: 사건 노트에서 아는 정보(취재가치·제목·요약)로 같은 칸 구성의 행을 만든다
function fallbackRow(details: ContentDetails | undefined, href: string): HTMLElement {
  const tr = document.createElement("tr")
  const cells = Array.from({ length: 5 }, () => document.createElement("td"))
  const scoop = (details?.tags ?? []).includes("특종")
  const icon = document.createElement("span")
  icon.className = scoop ? "bn-lv-scoop" : "bn-lv-news"
  icon.textContent = scoop ? "🔥" : "📰"
  cells[0].append(icon)
  const a = document.createElement("a")
  a.href = href
  a.textContent = (details?.title ?? "").replace(/^\d+일차-\d+\s+/, "")
  cells[2].append(a)
  cells[3].textContent = eventSummary(details)
  tr.append(...cells)
  return tr
}

// 사건들을 일지와 같은 모양의 표로 만든다: 각 사건이 있는 일지 페이지(N일차) 표에서 그 사건의 행을 그대로 가져온다.
async function buildEventTable(
  currentSlug: FullSlug,
  events: SimpleSlug[],
  data: ContentData,
): Promise<HTMLElement> {
  const here = window.location.toString()
  let thead: Element | null = null
  const tbody = document.createElement("tbody")
  for (const id of events) {
    const details = data.get(id)
    const eventUrl = new URL(resolveRelative(currentSlug, id), here)
    const day = (details?.title ?? "").match(/^(\d+)일차-/)?.[1]
    let row: Element | undefined
    let dayUrl = ""
    if (day) {
      dayUrl = new URL(
        resolveRelative(currentSlug, `01-일지/${day}일차` as SimpleSlug),
        here,
      ).toString()
      const table = (await fetchDayPage(dayUrl))?.querySelector("article table")
      thead ??= table?.querySelector("thead") ?? null
      row = [...(table?.querySelectorAll("tbody tr") ?? [])].find((tr) =>
        [...tr.querySelectorAll("a[href]")].some(
          (a) => new URL(a.getAttribute("href")!, dayUrl).pathname === eventUrl.pathname,
        ),
      )
    }
    if (row) {
      // 일지 페이지 기준 상대 링크를 절대 주소로 바꿔서 옮긴다
      const clone = document.importNode(row, true)
      clone.querySelectorAll("a[href]").forEach((a) => {
        a.setAttribute("href", new URL(a.getAttribute("href")!, dayUrl).toString())
      })
      tbody.append(clone)
    } else {
      tbody.append(fallbackRow(details, eventUrl.toString()))
    }
  }
  const table = document.createElement("table")
  table.append(thead ? document.importNode(thead, true) : defaultHead(), tbody)
  const wrap = document.createElement("div")
  wrap.className = "bn-edge-table"
  wrap.append(table)
  return wrap
}

// 사건 인연 선을 눌렀을 때: 두 인물이 함께 엮인 사건 표 창 (일차·순번 순)
export async function showEventPopup(
  title: string,
  currentSlug: FullSlug,
  events: SimpleSlug[],
  data: ContentData,
) {
  const sorted = [...events].sort(
    (a, b) => eventOrder(data.get(a)?.title ?? "") - eventOrder(data.get(b)?.title ?? ""),
  )
  const table = await buildEventTable(currentSlug, sorted, data)
  showEdgePopup(title, `함께 엮인 사건 ${sorted.length}건`, table)
}
