import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"
import { QuartzPluginData } from "../plugins/vfile"
import { FilePath, FullSlug, resolveRelative, simplifySlug, slugifyFilePath } from "../util/path"
import { classNames } from "../util/lang"
import { caseIndex, displayName } from "./bnNames"
import type { ComponentChildren } from "preact"

// 봉누도2 — 제목 아래 속성 카드. 원본은 볼트의 .quartz/quartz/components/InfoBox.tsx (빌드 때 Quartz에 복사).
// Quartz는 frontmatter를 화면에 보여 주지 않으므로, 노트 type별로 고른 속성을 2열 표로 보여 준다.
// 값이 비면 그 행은 뺀다. [[링크]]는 파일명·별칭으로 노트를 찾아 링크로 만든다 (못 찾으면 글자 그대로).
// 등급·관계·상태 같은 값은 배지(bn-badge, data-v 값으로 색을 정함 — custom.scss).

type Kind = "text" | "links" | "badge" | "day" | "bool"
type Field = { key: string; label: string; kind: Kind }

const FIELDS: Record<string, Field[]> = {
  사건: [
    { key: "시간", label: "시간", kind: "text" },
    { key: "장소", label: "장소", kind: "links" },
    { key: "취재가치", label: "취재가치", kind: "badge" },
    { key: "상태", label: "상태", kind: "badge" },
    { key: "관련인물", label: "관련 인물", kind: "links" },
    { key: "관련세력", label: "관련 세력", kind: "links" },
    { key: "입수경로", label: "입수 경로", kind: "links" },
    { key: "기사화", label: "기사화", kind: "bool" },
  ],
  인물: [
    { key: "소속", label: "소속", kind: "links" },
    { key: "직책", label: "직책", kind: "text" },
    { key: "나이", label: "나이", kind: "text" },
    { key: "생일", label: "생일", kind: "text" },
    { key: "관계", label: "명총희와", kind: "badge" },
    { key: "상태", label: "상태", kind: "badge" },
    { key: "첫만남", label: "첫 만남", kind: "day" },
    { key: "최근만남", label: "최근 만남", kind: "day" },
  ],
  본인: [
    { key: "소속", label: "소속", kind: "links" },
    { key: "직책", label: "직책", kind: "text" },
    { key: "나이", label: "나이", kind: "text" },
    { key: "생일", label: "생일", kind: "text" },
    { key: "상태", label: "상태", kind: "badge" },
  ],
  세력: [
    { key: "분류", label: "분류", kind: "badge" },
    { key: "aliases", label: "다른 이름", kind: "text" },
    { key: "합격인원", label: "합격 인원", kind: "text" },
  ],
  이벤트: [
    { key: "상태", label: "상태", kind: "badge" },
    { key: "주최", label: "주최", kind: "links" },
    { key: "일정", label: "일정", kind: "links" },
    { key: "첫단서", label: "첫 단서", kind: "day" },
    { key: "최근단서", label: "최근 단서", kind: "day" },
    { key: "관련인물", label: "관련 인물", kind: "links" },
    { key: "관련세력", label: "관련 세력", kind: "links" },
  ],
  외부자료: [
    { key: "종류", label: "종류", kind: "badge" },
    { key: "작성자", label: "작성자", kind: "links" },
    { key: "일차", label: "본 일차", kind: "day" },
    { key: "시간", label: "본 시각", kind: "text" },
    { key: "관련사건", label: "관련 사건", kind: "links" },
  ],
  기사: [
    { key: "일차", label: "일차", kind: "day" },
    { key: "상태", label: "상태", kind: "badge" },
    { key: "취재원", label: "취재원", kind: "links" },
    { key: "관련사건", label: "관련 사건", kind: "links" },
  ],
  장소: [
    { key: "구역", label: "구역", kind: "text" },
    { key: "관련세력", label: "관련 세력", kind: "links" },
  ],
}

const RELATION_TAG = /^(동맹|협력|경쟁|적대)\/(.+)$/
const WIKILINK = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g
const normalizeName = (s: string) => s.replace(/[\s-]/g, "")

// 링크 대상 이름("001 김철수", "01 일지/3일차", 별칭) → 노트 slug
function makeResolver(allFiles: QuartzPluginData[]) {
  const bySlug = new Map<string, FullSlug>()
  const byBase = new Map<string, FullSlug>()
  const byAlias = new Map<string, FullSlug>()
  for (const f of allFiles) {
    const slug = f.slug!
    bySlug.set(slug, slug)
    const base = slug.split("/").pop()!
    if (!byBase.has(base)) byBase.set(base, slug)
    for (const a of f.aliases ?? []) if (!byAlias.has(a)) byAlias.set(a, slug)
  }
  return (name: string): FullSlug | null => {
    const s = slugifyFilePath((name.trim() + ".md") as FilePath)
    return bySlug.get(s) ?? byBase.get(s.split("/").pop()!) ?? byAlias.get(s) ?? null
  }
}

const InfoBox: QuartzComponent = ({ fileData, allFiles, displayClass }: QuartzComponentProps) => {
  const fm = fileData.frontmatter as Record<string, unknown> | undefined
  const type = typeof fm?.type === "string" ? fm.type : ""
  const fields = FIELDS[type]
  if (!fm || !fields) return null
  const here = fileData.slug!
  const resolve = makeResolver(allFiles)

  const link = (name: string, label?: string): ComponentChildren => {
    const slug = resolve(name)
    const text = (label ?? displayName(name)).trim()
    if (!slug) return text
    return (
      <a href={resolveRelative(here, simplifySlug(slug))} class="internal" data-slug={slug}>
        {text}
      </a>
    )
  }
  // "글자 [[대상|이름]] 글자" → 글자와 링크가 섞인 조각들
  const withLinks = (s: string): ComponentChildren[] => {
    const out: ComponentChildren[] = []
    let last = 0
    for (const m of s.matchAll(WIKILINK)) {
      if (m.index! > last) out.push(s.slice(last, m.index))
      out.push(link(m[1], m[2]))
      last = m.index! + m[0].length
    }
    if (last < s.length) out.push(s.slice(last))
    return out
  }
  const joinItems = (items: ComponentChildren[][]): ComponentChildren[] =>
    items.flatMap((it, i) => (i === 0 ? it : [", ", ...it]))
  const dayLink = (n: number) => link(`01 일지/${n}일차`, `${n}일차`)

  const render = (v: unknown, kind: Kind): ComponentChildren | null => {
    if (v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0)) return null
    switch (kind) {
      case "bool":
        return v === true || v === "true" ? "예" : null
      case "badge":
        return (
          <span class="bn-badge" data-v={String(v)}>
            {String(v)}
          </span>
        )
      case "day": {
        const n = Number(v)
        return Number.isNaN(n) ? withLinks(String(v)) : dayLink(n)
      }
      default: {
        const arr = (Array.isArray(v) ? v : [v]).map((x) => String(x))
        return joinItems(arr.map(withLinks))
      }
    }
  }

  const rows: [string, ComponentChildren][] = []
  // 사건: 일지(일차)와 그날 순번
  if (type === "사건") {
    const ci = caseIndex(fm.title as string)
    const day = Number(fm.일차)
    if (ci || !Number.isNaN(day)) {
      const n = ci?.day ?? day
      rows.push(["일지", [dayLink(n), ci ? ` · 그날 ${ci.n}번째 사건` : ""]])
    }
  }
  for (const f of fields) {
    let v = fm[f.key]
    if (f.key === "합격인원" && v !== undefined && v !== null && v !== "") v = `${v}명`
    const r = render(v, f.kind)
    if (r !== null) rows.push([f.label, r])
  }
  // 세력: 관계 태그(경쟁/판도라연구소)를 상대 세력 링크로
  if (type === "세력") {
    const rels: ComponentChildren[][] = []
    for (const t of (fm.tags as string[] | undefined) ?? []) {
      const m = t.match(RELATION_TAG)
      if (!m) continue
      const other = allFiles.find(
        (f) => f.slug?.startsWith("03-세력/") && normalizeName(f.slug.split("/").pop()!) === normalizeName(m[2]),
      )
      rels.push([
        <span class="bn-badge" data-v={m[1]}>
          {m[1]}
        </span>,
        " ",
        other ? link(other.slug!.split("/").pop()!, displayName(other.frontmatter?.title ?? m[2])) : m[2],
      ])
    }
    if (rels.length > 0) rows.push(["세력 관계", joinItems(rels)])
  }
  if (rows.length === 0) return null

  return (
    <dl class={classNames(displayClass, "bn-infobox")}>
      {rows.map(([label, value]) => (
        <>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </>
      ))}
    </dl>
  )
}

export default (() => InfoBox) satisfies QuartzComponentConstructor
