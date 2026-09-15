import { Root, Element } from "hast"
import { toHtml } from "hast-util-to-html"
import { FilePath, FullSlug, SimpleSlug, simplifySlug, slugifyFilePath } from "../../util/path"
import { QuartzEmitterPlugin } from "../types"
import { write } from "./helpers"

// 봉누도2 — 일지 데이터 이미터. 원본은 볼트의 .quartz/quartz/plugins/emitters/bnDays.ts (빌드 때 Quartz에 복사).
// 빌드 때 static/bn-days.json 하나를 내보낸다:
//   {
//     "days":     { "3": { slug, thead, rows[] } },        // 일지(01 일지/N일차) 페이지의 첫 표
//     "cases":    { "01-일지/사건/3일차/3일차-02-…": [인물 주소…] },  // 사건 노트의 가담인물
//     "factions": { "03-세력/갱/텍사스": "#e03131" },         // 세력 색 (분류 기본값 또는 `색` 속성)
//     "places":   { "04-장소/경찰서": { names: ["경찰서", "경찰서 앞"], x: 443, y: -984, postal: "8047", faction: "03-세력/기관/경찰" } }
//                 // 세력·장소 노트의 지도 정보: 이름·별칭·`포함장소`와 `좌표`(게임 좌표 "x, y")·`우편번호`, `관련세력` 첫 세력(점 색)
//   }
// 그래프 선·선을 누르면 뜨는 창·인물 페이지 사건 기록 표(components/scripts/bongnudo.ts)와 지도(bnMapLib.ts)가 이 파일을 읽는다.
// 행 HTML은 페이지에 보이는 것과 같다 (링크의 data-slug, 등급 이름표 bn-lv-* 포함).
//
// 가담인물: 조직이 주체인 사건은 일지 표 '관련 인물' 칸에 조직만 적고 개인은 적지 않는다(그래프가 복잡해져서).
// 그래도 "누가 그 자리에 있었나"는 알아야 하므로 사건 노트가 이 속성으로 직접 들고 있고, 여기서 주소로 바꿔 내보낸다.

const DAY_SLUG = /^01-일지\/(\d+)일차$/
const WIKILINK = /^\s*\[\[([^\]|#]+)/

// 세력 색: 분류별 기본값. 세력 노트에 `색: "#rrggbb"`를 적으면 그 세력만 따로 정할 수 있다.
// 인물 링크 앞 동그라미는 그 인물이 속한 세력의 색을 쓴다 (components/scripts/bongnudo.ts decorateLinks)
const FACTION_COLORS: Record<string, string> = {
  기관: "#0075de", // 파랑
  갱: "#e03131", // 빨강
  사업체: "#dfab01", // 노랑
}
// 그 밖의 조직(시민 단체 등)과 소속 없는 시민
const OTHER_COLOR = "#1aae39" // 초록
const COLOR_OK = /^#[0-9a-fA-F]{3,8}$/

type DayTable = { slug: SimpleSlug; thead: string; rows: string[] }
// faction: 장소 노트 `관련세력`의 첫 세력 주소 (지도 점 색). 세력 노트 자신이면 자기 주소
type PlaceInfo = { names: string[]; x?: number; y?: number; postal?: string; faction?: SimpleSlug }

// `좌표: "x, y"` 또는 `좌표: [x, y]` → 게임 좌표
function parseCoords(v: unknown): { x: number; y: number } | null {
  const arr = Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : null
  if (!arr || arr.length < 2) return null
  const x = Number(String(arr[0]).trim())
  const y = Number(String(arr[1]).trim())
  return Number.isNaN(x) || Number.isNaN(y) ? null : { x, y }
}

const asList = (v: unknown): string[] =>
  (Array.isArray(v) ? v : v === undefined || v === null || v === "" ? [] : [v]).map((s) =>
    String(s).trim(),
  )

// 트리에서 tagName인 첫 요소
function findFirst(node: Root | Element, tagName: string): Element | null {
  if (node.type === "element" && node.tagName === tagName) return node
  for (const child of node.children) {
    if (child.type !== "element") continue
    const hit = findFirst(child, tagName)
    if (hit) return hit
  }
  return null
}

export const BnDays: QuartzEmitterPlugin = () => ({
  name: "BnDays",
  async *emit(ctx, content) {
    // 이름·별칭 → 노트 주소 (frontmatter의 [[링크]]는 Quartz가 풀어 주지 않으므로 직접 찾는다)
    const index = new Map<string, SimpleSlug>()
    for (const [, file] of content) {
      const slug = simplifySlug(file.data.slug!)
      index.set(slug, slug)
      const base = slug.split("/").pop()!
      if (!index.has(base)) index.set(base, slug)
      for (const alias of file.data.aliases ?? []) {
        const a = simplifySlug(alias)
        if (!index.has(a)) index.set(a, slug)
      }
    }
    const resolve = (name: string): SimpleSlug | null => {
      const s = simplifySlug(slugifyFilePath((name.trim() + ".md") as FilePath))
      return index.get(s) ?? index.get(s.split("/").pop()!) ?? null
    }

    const days: Record<string, DayTable> = {}
    const cases: Record<string, SimpleSlug[]> = {}
    const factions: Record<string, string> = {}
    const places: Record<string, PlaceInfo> = {}
    for (const [tree, file] of content) {
      const slug = simplifySlug(file.data.slug!)
      const fm: Record<string, unknown> = file.data.frontmatter ?? {}

      // 세력 색
      if (slug.startsWith("03-세력/") && slug !== "03-세력/세력-목록") {
        const custom = typeof fm["색"] === "string" ? fm["색"].trim() : ""
        factions[slug] = COLOR_OK.test(custom)
          ? custom
          : (FACTION_COLORS[String(fm["분류"] ?? "")] ?? OTHER_COLOR)
      }

      // 지도: 세력·장소 노트의 이름(파일명·별칭·포함장소)과 위치(좌표·우편번호). 위치가 없어도 이름은 내보낸다
      // (일지 표 '장소' 칸의 글자를 노트에 이어 주려고)
      if (
        (slug.startsWith("03-세력/") || slug.startsWith("04-장소/")) &&
        !["03-세력/세력-목록", "04-장소/장소-목록"].includes(slug)
      ) {
        const title = String(fm.title ?? slug.split("/").pop())
        const names = [...new Set([title, ...asList(fm.aliases), ...asList(fm["포함장소"])])].filter(
          (n) => n !== "",
        )
        const info: PlaceInfo = { names }
        const xy = parseCoords(fm["좌표"])
        if (xy) Object.assign(info, xy)
        const postal = String(fm["우편번호"] ?? "").trim()
        if (postal !== "") info.postal = postal
        if (slug.startsWith("03-세력/")) info.faction = slug
        else {
          const first = asList(fm["관련세력"])
            .map((v) => v.match(WIKILINK)?.[1])
            .filter((n): n is string => !!n)
            .map(resolve)
            .find((s): s is SimpleSlug => !!s)
          if (first) info.faction = first
        }
        places[slug] = info
      }

      // 일지 페이지: 첫 표가 일지 표
      const day = slug.match(DAY_SLUG)
      if (day) {
        const table = findFirst(tree as Root, "table")
        if (table) {
          const thead = findFirst(table, "thead")
          const tbody = findFirst(table, "tbody")
          const rows = (tbody?.children ?? []).filter(
            (c): c is Element => c.type === "element" && c.tagName === "tr",
          )
          days[day[1]] = {
            slug,
            thead: thead ? toHtml(thead) : "",
            rows: rows.map((r) => toHtml(r)),
          }
        }
      }

      // 사건 노트: 가담인물
      const joined = file.data.frontmatter?.["가담인물"]
      if (Array.isArray(joined)) {
        const ids = joined
          .map((v) => String(v).match(WIKILINK)?.[1])
          .filter((n): n is string => !!n)
          .map(resolve)
          .filter((s): s is SimpleSlug => !!s)
        if (ids.length > 0) cases[slug] = ids
      }
    }

    yield write({
      ctx,
      content: JSON.stringify({ days, cases, factions, places }),
      slug: "static/bn-days" as FullSlug,
      ext: ".json",
    })
  },
})
