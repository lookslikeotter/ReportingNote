import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"
// @ts-ignore
import script from "./scripts/dayNav.inline"
import { FullSlug, resolveRelative, simplifySlug } from "../util/path"
import { classNames } from "../util/lang"
import { caseIndex, displayName } from "./bnNames"

// 봉누도2 — 일차 이동. 원본은 볼트의 .quartz/quartz/components/DayNav.tsx (빌드 때 Quartz에 복사).
//   일지 페이지: ← 이전 일차 | 일차 선택 | 다음 일차 →  (일지 노트 01-일지/N일차가 있는 일차만)
//   사건 페이지: ← 그날 이전 사건 | N일차 일지 | 그날 다음 사건 →  (같은 폴더의 사건 파일 순번 기준)
// 선택 상자는 dayNav.inline.ts가 처리한다.

const DAY_SLUG = /^01-일지\/(\d+)일차$/

const DayNav: QuartzComponent = ({ fileData, allFiles, displayClass }: QuartzComponentProps) => {
  const type = fileData.frontmatter?.type
  const here = fileData.slug!
  const href = (slug: FullSlug) => resolveRelative(here, simplifySlug(slug))

  if (type === "일지") {
    const n = Number(fileData.frontmatter?.일차)
    if (Number.isNaN(n)) return null
    const days = allFiles
      .map((f) => ({ n: Number(f.slug?.match(DAY_SLUG)?.[1] ?? NaN), slug: f.slug! }))
      .filter((d) => !Number.isNaN(d.n))
      .sort((a, b) => a.n - b.n)
    const prev = [...days].reverse().find((d) => d.n < n)
    const next = days.find((d) => d.n > n)
    return (
      <nav class={classNames(displayClass, "bn-daynav")} aria-label="일차 이동">
        {prev ? (
          <a class="bn-pill" href={href(prev.slug)}>
            ← {prev.n}일차
          </a>
        ) : (
          <span class="bn-pill disabled">← 이전</span>
        )}
        <select class="bn-dayselect" aria-label="일차 선택">
          {days.map((d) => (
            <option value={href(d.slug)} selected={d.n === n}>
              {d.n}일차
            </option>
          ))}
        </select>
        {next ? (
          <a class="bn-pill" href={href(next.slug)}>
            {next.n}일차 →
          </a>
        ) : (
          <span class="bn-pill disabled">다음 →</span>
        )}
      </nav>
    )
  }

  if (type === "사건") {
    const ci = caseIndex(fileData.frontmatter?.title ?? "")
    if (!ci) return null
    const folder = here.slice(0, here.lastIndexOf("/") + 1)
    const siblings = allFiles
      .filter((f) => f.slug?.startsWith(folder))
      .map((f) => ({ ci: caseIndex(f.frontmatter?.title ?? ""), f }))
      .filter((s): s is { ci: { day: number; n: number }; f: (typeof allFiles)[number] } => !!s.ci)
      .sort((a, b) => a.ci.n - b.ci.n)
    const prev = [...siblings].reverse().find((s) => s.ci.n < ci.n)
    const next = siblings.find((s) => s.ci.n > ci.n)
    const day = allFiles.find((f) => f.slug === `01-일지/${ci.day}일차`)
    return (
      <nav class={classNames(displayClass, "bn-daynav")} aria-label="사건 이동">
        {prev ? (
          <a class="bn-pill" href={href(prev.f.slug!)} title={displayName(prev.f.frontmatter!.title)}>
            ← {displayName(prev.f.frontmatter!.title)}
          </a>
        ) : (
          <span class="bn-pill disabled">← 그날 첫 사건</span>
        )}
        {day && (
          <a class="bn-pill current" href={href(day.slug!)}>
            {ci.day}일차 일지
          </a>
        )}
        {next ? (
          <a class="bn-pill" href={href(next.f.slug!)} title={displayName(next.f.frontmatter!.title)}>
            {displayName(next.f.frontmatter!.title)} →
          </a>
        ) : (
          <span class="bn-pill disabled">그날 마지막 사건 →</span>
        )}
      </nav>
    )
  }

  return null
}

DayNav.afterDOMLoaded = script

export default (() => DayNav) satisfies QuartzComponentConstructor
