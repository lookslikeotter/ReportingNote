import type { ContentDetails } from "../../plugins/emitters/contentIndex"
import {
  FullSlug,
  SimpleSlug,
  joinSegments,
  pathToRoot,
  resolveRelative,
  simplifySlug,
} from "../../util/path"

// 봉누도2 — 그래프 스크립트 두 개가 함께 쓰는 규칙과 도구.
//   graph.inline.ts: 오른쪽 아래 그래프와 전체 그래프 / peopleGraph.inline.ts: 인물 그래프
// 원본은 볼트의 .quartz/quartz/components/scripts/bongnudo.ts.

export type ContentData = Map<SimpleSlug, ContentDetails>

// 사이트 데이터(contentIndex). 자동 갱신(liveUpdate.inline.ts)이 새 데이터를 window.bnContentIndex에 넣으면 그걸 쓴다
export function loadContentIndex(): Promise<Record<string, ContentDetails>> {
  return (window as any).bnContentIndex ?? fetchData
}

// 같은 데이터를 짧은 주소(SimpleSlug) 기준 Map으로
export async function loadContentData(): Promise<ContentData> {
  return new Map(
    Object.entries<ContentDetails>(await loadContentIndex()).map(([k, v]) => [
      simplifySlug(k as FullSlug),
      v,
    ]),
  )
}

// 인물·세력 링크 앞에 분류 칩을 붙인다: 인물은 분류 태그 색 점(bn-cat-*, 그래프 노드 색과 같음), 세력은 네모(bn-fac). 모양은 custom.scss
export function decorateLinks(
  root: ParentNode,
  data: ContentData,
  resolveLink: (dest: SimpleSlug) => SimpleSlug,
) {
  for (const a of root.querySelectorAll<HTMLAnchorElement>("a[data-slug]")) {
    const id = resolveLink(simplifySlug(a.dataset.slug as FullSlug))
    if (!isInfoNode(id) || a.classList.contains("bn-chip")) continue
    const tags = data.get(id)?.tags ?? []
    const cat = tags.includes("갱")
      ? "gang"
      : tags.includes("기관")
        ? "org"
        : tags.includes("시민")
          ? "civ"
          : null
    if (cat) a.classList.add("bn-chip", `bn-cat-${cat}`)
    else if (id.startsWith("03-세력/")) a.classList.add("bn-chip", "bn-fac")
  }
}

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

// 나희정 본인 노트 (일지 표 '입수 경로'로 나희정과 전해 준 사람을 잇는다)
export const ME = "02-인물/000-나희정" as SimpleSlug

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

// 사건 하나가 인연에 더하는 무게. 🔥 특종은 📰 사건의 2배로 센다
const NEWS_WEIGHT = 1
const SCOOP_WEIGHT = 2

export type EventPair = {
  source: SimpleSlug
  target: SimpleSlug
  // 함께 엮인 사건의 무게 합 (선 굵기·색·거리). 사건 수와는 다르다 — 특종이 2로 세어진다
  weight: number
  // 그 사건 노트들
  events: SimpleSlug[]
}

// 일지 표(N일차) 📰 사건·🔥 특종 행의 '관련 인물' 칸에 함께 적힌 당사자(isParticipant) 두 명마다 한 쌍을 만든다. 키는 pairKey.
// 선을 눌렀을 때 뜨는 표와 같은 칸을 기준으로 삼는다. ☕ 일상·📅 이벤트 행은 선을 만들지 않는다.
// '입수 경로' 칸이 인물 링크뿐이면(나희정이 그 사람에게서 직접 들음) 나희정과 그 인물도 잇는다.
// 기사·SNS 등 매체로 알게 된 일은 잇지 않는다.
export async function tableEventPairs(
  currentSlug: FullSlug,
  data: ContentData,
  resolveLink: (dest: SimpleSlug) => SimpleSlug,
  isParticipant: (id: SimpleSlug) => boolean,
): Promise<Map<string, EventPair>> {
  const { rows } = await readDayTables(currentSlug, data, resolveLink)
  const pairs = new Map<string, EventPair>()
  const seen = new Set<SimpleSlug>()
  for (const r of rows) {
    if ((r.kind !== "news" && r.kind !== "scoop") || seen.has(r.id)) continue
    seen.add(r.id)
    const eventId = r.id
    // 이 사건으로 이어지는 두 사람: 관련 인물끼리 + 나희정과 직접 전해 준 사람 (같은 쌍은 한 번만)
    const rowPairs = new Map<string, [SimpleSlug, SimpleSlug]>()
    const involved = [...r.related].filter(isParticipant)
    for (let i = 0; i < involved.length; i++) {
      for (let j = i + 1; j < involved.length; j++) {
        rowPairs.set(pairKey(involved[i], involved[j]), [involved[i], involved[j]])
      }
    }
    if (isParticipant(ME)) {
      for (const s of r.sources) {
        if (s !== ME && isParticipant(s)) rowPairs.set(pairKey(ME, s), [ME, s])
      }
    }
    const w = r.kind === "scoop" ? SCOOP_WEIGHT : NEWS_WEIGHT
    for (const [key, [a, b]] of rowPairs) {
      const pair = pairs.get(key)
      if (pair) {
        pair.weight += w
        pair.events.push(eventId)
      } else {
        pairs.set(key, { source: a, target: b, weight: w, events: [eventId] })
      }
    }
  }
  return pairs
}

// 사건 인연 선 모양 (weight = 함께 엮인 사건의 무게 합. 📰 사건 1 · 🔥 특종 2)
//   굵기: 1건 EVENT_MIN_WIDTH에서 1건마다 EVENT_WIDTH_STEP씩 굵어져 EVENT_MAX_WIDTH에서 멈춘다
//   색: 굵기와 같은 속도로 --gray에서 --dark로 진해져, 굵기가 상한에 닿는 건수에서 가장 진해진다
const EVENT_MIN_WIDTH = 0.4
const EVENT_WIDTH_STEP = 0.1
const EVENT_MAX_WIDTH = 2
// 굵기가 상한에 닿는 사건 수 (0.4 + 0.1×16 = 2.0 → 17건)
const EVENT_MAX_AT = 1 + (EVENT_MAX_WIDTH - EVENT_MIN_WIDTH) / EVENT_WIDTH_STEP

export function eventLinkWidth(weight: number): number {
  return Math.min(EVENT_MIN_WIDTH + EVENT_WIDTH_STEP * (weight - 1), EVENT_MAX_WIDTH)
}

// base(연한 선 색)에서 darkest(가장 진한 색)로, 굵기와 같은 속도로
export function eventLinkColor(weight: number, base: string, darkest: string): string {
  const t = Math.max(0, Math.min(1, (weight - 1) / (EVENT_MAX_AT - 1)))
  return mixColor(base, darkest, t)
}

function parseHex(c: string): number[] | null {
  const m = c.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)
  if (!m) return null
  const h = m[1].length === 3 ? [...m[1]].map((x) => x + x).join("") : m[1]
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16))
}

// 두 색(#rgb·#rrggbb) 사이를 t(0~1)만큼 섞는다. 읽을 수 없는 색이면 가까운 쪽을 그대로 쓴다
function mixColor(a: string, b: string, t: number): string {
  const ca = parseHex(a)
  const cb = parseHex(b)
  if (!ca || !cb) return t < 0.5 ? a : b
  return "#" + ca.map((v, i) => Math.round(v + (cb[i] - v) * t).toString(16).padStart(2, "0")).join("")
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

// 창을 띄운다. Esc나 창 바깥을 누르면 닫힌다.
// 창 안의 링크를 누르면 창을 닫고, 이동은 사이트의 링크 처리에 맡긴다.
function showEdgePopup(title: string, subtitle: string, content: HTMLElement) {
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
  card.append(head, sub, content)
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

// 일지 데이터: 빌드 때 plugins/emitters/bnDays.ts가 만든 static/bn-days.json
//   days  = 일차 → 일지 주소·머리줄·행 HTML
//   cases = 사건 주소 → 가담인물 (조직이 주체라 일지 표 '관련 인물' 칸에 이름이 없는 사람들)
// 한 번 받아 페이지를 여는 동안 다시 쓰고, 자동 갱신으로 새 기록이 오면 버린다. 실패는 기억하지 않는다 (다음에 다시 시도)
type DayData = {
  days: Record<string, { slug: SimpleSlug; thead: string; rows: string[] }>
  cases: Record<string, SimpleSlug[]>
}
let daysCache: Promise<DayData | null> | null = null
function fetchDays(currentSlug: FullSlug): Promise<DayData | null> {
  if (!daysCache) {
    const url = new URL(
      joinSegments(pathToRoot(currentSlug), "static/bn-days.json"),
      window.location.toString(),
    )
    // 배포 직후 앞단 캐시(CDN)가 옛 파일을 주지 않게, 페이지에 적힌 기록 버전을 주소에 붙인다 (liveUpdate.inline.ts와 같은 방식)
    const build = document.querySelector<HTMLMetaElement>('meta[name="bn-build"]')?.content
    if (build) url.searchParams.set("bnv", build.slice(0, 12))
    daysCache = fetch(url, { cache: "no-cache" })
      .then((r) => (r.ok ? (r.json() as Promise<DayData>) : Promise.reject()))
      .catch(() => {
        daysCache = null
        return null
      })
  }
  return daysCache
}
document.addEventListener("bn-content-updated", () => (daysCache = null))

// 일지 표 머리줄 (일지 페이지를 못 읽었을 때만 쓴다)
function defaultHead(): HTMLElement {
  const thead = document.createElement("thead")
  const tr = document.createElement("tr")
  for (const h of ["시간", "사건", "요약", "관련 인물", "입수 경로"]) {
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
  // 시간 칸에 등급 이름표 (행 배경색). 시간은 알 수 없어 비워 둔다
  const grade = document.createElement("span")
  grade.className = (details?.tags ?? []).includes("특종") ? "bn-lv-scoop" : "bn-lv-news"
  cells[0].append(grade)
  const a = document.createElement("a")
  a.href = href
  a.textContent = (details?.title ?? "").replace(/^\d+일차-\d+\s+/, "")
  cells[1].append(a)
  cells[2].textContent = eventSummary(details)
  tr.append(...cells)
  return tr
}

// 일지 표(N일차)의 행 하나
export type DayRow = {
  // 행이 실린 일지(01-일지/N일차)와 그 일차 숫자
  day: SimpleSlug
  dayN: number
  // 행의 사건·이벤트 노트
  id: SimpleSlug
  // 행의 등급 이름표(bn-lv-*): 없음 daily(☕) · news(📰) · scoop(🔥) · event(📅)
  kind: "daily" | "news" | "scoop" | "event"
  // '관련 인물' 칸의 인물·세력
  related: Set<SimpleSlug>
  // '입수 경로' 칸이 인물 링크로만 되어 있으면 그 인물들 (나희정에게 직접 전해 준 사람). 직접·기사·SNS 등이면 빈 배열
  sources: SimpleSlug[]
  // 링크를 절대 주소로 고친 행 복사본
  row: Element
}

// 일지 데이터(bn-days.json)를 일차 순서대로 읽는다. 행은 페이지에 보이는 HTML 그대로 되살린다.
// joined: 사건 주소 → 가담인물 (일지 표 '관련 인물' 칸에는 없지만 그 사건에 있던 사람들)
async function readDayTables(
  currentSlug: FullSlug,
  data: ContentData,
  resolveLink: (dest: SimpleSlug) => SimpleSlug,
): Promise<{ thead: Element | null; rows: DayRow[]; joined: Record<string, SimpleSlug[]> }> {
  const here = window.location.toString()
  const slugsIn = (cell?: Element) =>
    [...(cell?.querySelectorAll<HTMLElement>("a[data-slug]") ?? [])].map((el) =>
      resolveLink(simplifySlug(el.dataset.slug as FullSlug)),
    )
  // '입수 경로' 칸: 링크 말고 다른 글자(직접·기사·SNS 등)가 없을 때만 그 링크들을 직접 전해 준 사람으로 본다
  const directSources = (cell?: Element): SimpleSlug[] => {
    if (!cell) return []
    const rest = cell.cloneNode(true) as Element
    rest.querySelectorAll("a").forEach((a) => a.remove())
    if ((rest.textContent ?? "").replace(/[\s,·]/g, "") !== "") return []
    return slugsIn(cell)
  }
  const dayData = await fetchDays(currentSlug)
  const days = Object.entries(dayData?.days ?? {})
    .map(([n, d]) => ({ n: Number(n), ...d }))
    .filter((d) => !Number.isNaN(d.n) && data.has(d.slug))
    .sort((x, y) => x.n - y.n)

  let thead: Element | null = null
  const rows: DayRow[] = []
  for (const { n: dayN, slug: day, thead: theadHtml, rows: rowHtmls } of days) {
    const dayUrl = new URL(resolveRelative(currentSlug, day), here).toString()
    const table = document.createElement("table")
    table.innerHTML = theadHtml + "<tbody>" + rowHtmls.join("") + "</tbody>"
    const heads = [...table.querySelectorAll("thead th")].map((th) => th.textContent ?? "")
    const eventCol = heads.findIndex((h) => h.includes("사건"))
    const relatedCol = heads.findIndex((h) => h.includes("관련"))
    const sourceCol = heads.findIndex((h) => h.includes("입수"))
    if (eventCol < 0 || relatedCol < 0) continue
    thead ??= table.querySelector("thead")
    for (const tr of table.querySelectorAll("tbody tr")) {
      const cells = tr.querySelectorAll("td")
      const id = slugsIn(cells[eventCol])[0]
      if (!id) continue
      // 등급 이름표(bn-lv-*)는 행 안 어디에 있어도 된다 (지금은 시간 칸)
      const kind = tr.querySelector(".bn-lv-scoop")
        ? "scoop"
        : tr.querySelector(".bn-lv-news")
          ? "news"
          : tr.querySelector(".bn-lv-event")
            ? "event"
            : "daily"
      const row = tr.cloneNode(true) as Element
      row.querySelectorAll("a[href]").forEach((a) => {
        a.setAttribute("href", new URL(a.getAttribute("href")!, dayUrl).toString())
      })
      rows.push({
        day,
        dayN,
        id,
        kind,
        related: new Set(slugsIn(cells[relatedCol])),
        sources: directSources(cells[sourceCol]),
        row,
      })
    }
  }
  return { thead, rows, joined: dayData?.cases ?? {} }
}

// 선을 눌렀을 때: 양 끝이 함께 엮인 📰 사건·🔥 특종·📅 이벤트를 일지와 같은 모양의 표로 보여 준다 (일지 순서).
//   - 일지 표 '관련 인물' 칸에 양 끝이 모두 들어간 행. 세력은 조직 단위로 얽힌 사건(관련세력)에만 이 칸에 적는다
//   - knownEvents: 그래프 선을 만든 사건들 (관련 인물 칸에 빠져 있어도 넣는다)
// ☕ 일상은 넣지 않는다. 📅 이벤트는 그래프에 노드·선을 만들지 않지만 이 창에는 나온다.
export async function showLinkPopup(p: {
  title: string
  // 선 종류 (예: "소속", "세력 관계 · 경쟁")
  kind?: string
  currentSlug: FullSlug
  data: ContentData
  resolveLink: (dest: SimpleSlug) => SimpleSlug
  a: SimpleSlug
  b: SimpleSlug
  knownEvents?: SimpleSlug[]
  // 소속 선일 때: 그 세력이 얽힌 사건 중 이 인물이 `가담인물`로 적힌 것도 넣는다
  member?: { person: SimpleSlug; faction: SimpleSlug }
}) {
  const known = new Set(p.knownEvents ?? [])
  const { thead, rows, joined } = await readDayTables(p.currentSlug, p.data, p.resolveLink)
  const picked = new Map<SimpleSlug, DayRow>()
  for (const r of rows) {
    if (r.kind === "daily" || picked.has(r.id)) continue
    const bothInRow = r.related.has(p.a) && r.related.has(p.b)
    const joinedHere =
      !!p.member &&
      r.related.has(p.member.faction) &&
      (joined[r.id] ?? []).includes(p.member.person)
    if (known.has(r.id) || bothInRow || joinedHere) picked.set(r.id, r)
  }

  const tbody = document.createElement("tbody")
  for (const r of picked.values()) tbody.append(r.row)
  for (const id of known) {
    if (picked.has(id)) continue
    const href = new URL(resolveRelative(p.currentSlug, id), window.location.toString())
    tbody.append(fallbackRow(p.data.get(id), href.toString()))
  }

  let content: HTMLElement
  if (tbody.children.length > 0) {
    const table = document.createElement("table")
    table.append(thead ? document.importNode(thead, true) : defaultHead(), tbody)
    content = document.createElement("div")
    content.className = "bn-case-table"
    content.append(table)
    decorateLinks(content, p.data, p.resolveLink)
  } else {
    content = document.createElement("div")
    content.className = "bn-edge-empty"
    content.textContent = "함께 엮인 📰·🔥 사건이나 📅 이벤트가 아직 없다."
  }

  const eventCount = [...picked.values()].filter((r) => r.kind === "event").length
  const caseCount = tbody.children.length - eventCount
  const count = `함께 엮인 사건 ${caseCount}건` + (eventCount > 0 ? ` · 이벤트 ${eventCount}건` : "")
  showEdgePopup(p.title, p.kind ? `${p.kind} · ${count}` : count, content)
}

// 사건·이벤트 노트 ↔ 그 사건에 나온 인물·세력 (일지 표 '관련 인물' 칸 + 사건의 `가담인물`).
// 그래프의 이웃 계산에만 쓴다 — 사건 노트는 노드가 아니므로 선으로 그려지지 않는다.
// frontmatter의 링크는 사이트 데이터에 들어가지 않아서, 이게 없으면 사건 페이지 그래프에 당사자가 빠진다.
export async function caseNodeLinks(
  currentSlug: FullSlug,
  data: ContentData,
  resolveLink: (dest: SimpleSlug) => SimpleSlug,
): Promise<{ source: SimpleSlug; target: SimpleSlug }[]> {
  const { rows, joined } = await readDayTables(currentSlug, data, resolveLink)
  const out: { source: SimpleSlug; target: SimpleSlug }[] = []
  const seen = new Set<string>()
  for (const r of rows) {
    for (const t of [...r.related, ...(joined[r.id] ?? [])]) {
      const key = r.id + "|" + t
      if (seen.has(key) || t === r.id) continue
      seen.add(key)
      out.push({ source: r.id, target: t })
    }
  }
  return out
}

// ── 인물·세력 페이지의 사건 기록 표 ──

// 이 인물·세력이 일지 표 '관련 인물' 칸에 있는 행 (나희정은 '입수 경로' 칸이 인물 링크뿐인 행도: 직접 전해 들은 일)
// + 그 사건의 `가담인물`에 이 인물이 있는 행 (조직이 주체라 '관련 인물' 칸에 이름이 없는 경우).
// ☕ 일상도 넣는다. 일지 순서 그대로 (일차 → 행 순).
export async function entityDayRows(
  currentSlug: FullSlug,
  data: ContentData,
  resolveLink: (dest: SimpleSlug) => SimpleSlug,
  id: SimpleSlug,
): Promise<{ thead: Element | null; rows: DayRow[] }> {
  const { thead, rows, joined } = await readDayTables(currentSlug, data, resolveLink)
  return {
    thead,
    rows: rows.filter(
      (r) =>
        r.related.has(id) ||
        (joined[r.id] ?? []).includes(id) ||
        (id === ME && r.sources.length > 0),
    ),
  }
}
