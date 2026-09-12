import { Root, Element } from "hast"
import { toHtml } from "hast-util-to-html"
import { FullSlug, SimpleSlug, simplifySlug } from "../../util/path"
import { QuartzEmitterPlugin } from "../types"
import { write } from "./helpers"

// 봉누도2 — 일지 표 데이터 이미터. 원본은 볼트의 .quartz/quartz/plugins/emitters/bnDays.ts (빌드 때 Quartz에 복사).
// 일지(01 일지/N일차) 페이지의 표를 빌드 때 static/bn-days.json 하나로 내보낸다:
//   { "3": { "slug": "01-일지/3일차", "thead": "<thead>…</thead>", "rows": ["<tr>…</tr>", …] }, … }
// 그래프 선·선을 누르면 뜨는 창·인물 페이지 사건 기록 표(components/scripts/bongnudo.ts)가
// 일지 페이지 HTML을 하나씩 받아 긁는 대신 이 파일을 읽는다.
// 행 HTML은 페이지에 보이는 것과 같다 (링크의 data-slug, 등급 이름표 bn-lv-* 포함). 링크 주소는 그 일지 페이지 기준 상대 주소.

const DAY_SLUG = /^01-일지\/(\d+)일차$/

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
    const days: Record<string, DayTable> = {}
    for (const [tree, file] of content) {
      const slug = simplifySlug(file.data.slug!)
      const m = slug.match(DAY_SLUG)
      if (!m) continue
      // 페이지의 첫 표가 일지 표
      const table = findFirst(tree as Root, "table")
      if (!table) continue
      const thead = findFirst(table, "thead")
      const tbody = findFirst(table, "tbody")
      const rows = (tbody?.children ?? []).filter(
        (c): c is Element => c.type === "element" && c.tagName === "tr",
      )
      days[m[1]] = { slug, thead: thead ? toHtml(thead) : "", rows: rows.map((r) => toHtml(r)) }
    }
    yield write({
      ctx,
      content: JSON.stringify(days),
      slug: "static/bn-days" as FullSlug,
      ext: ".json",
    })
  },
})
