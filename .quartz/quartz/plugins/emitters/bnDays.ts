import { Root, Element } from "hast"
import { toHtml } from "hast-util-to-html"
import { FilePath, FullSlug, SimpleSlug, simplifySlug, slugifyFilePath } from "../../util/path"
import { QuartzEmitterPlugin } from "../types"
import { write } from "./helpers"

// 봉누도2 — 일지 데이터 이미터. 원본은 볼트의 .quartz/quartz/plugins/emitters/bnDays.ts (빌드 때 Quartz에 복사).
// 빌드 때 static/bn-days.json 하나를 내보낸다:
//   {
//     "days":  { "3": { slug, thead, rows[] } },        // 일지(01 일지/N일차) 페이지의 첫 표
//     "cases": { "01-일지/사건/3일차/3일차-02-…": [인물 주소…] }  // 사건 노트의 가담인물
//   }
// 그래프 선·선을 누르면 뜨는 창·인물 페이지 사건 기록 표(components/scripts/bongnudo.ts)가 이 파일을 읽는다.
// 행 HTML은 페이지에 보이는 것과 같다 (링크의 data-slug, 등급 이름표 bn-lv-* 포함).
//
// 가담인물: 조직이 주체인 사건은 일지 표 '관련 인물' 칸에 조직만 적고 개인은 적지 않는다(그래프가 복잡해져서).
// 그래도 "누가 그 자리에 있었나"는 알아야 하므로 사건 노트가 이 속성으로 직접 들고 있고, 여기서 주소로 바꿔 내보낸다.

const DAY_SLUG = /^01-일지\/(\d+)일차$/
const WIKILINK = /^\s*\[\[([^\]|#]+)/

type DayTable = { slug: SimpleSlug; thead: string; rows: string[] }

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
    for (const [tree, file] of content) {
      const slug = simplifySlug(file.data.slug!)

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
      content: JSON.stringify({ days, cases }),
      slug: "static/bn-days" as FullSlug,
      ext: ".json",
    })
  },
})
