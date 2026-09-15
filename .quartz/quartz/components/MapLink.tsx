import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"
import { FullSlug, resolveRelative } from "../util/path"
import { classNames } from "../util/lang"

// 봉누도2 — 탐색기 맨 위 'N일차 일지' 바로 아래의 '지도' 항목. 원본은 볼트의 .quartz/quartz/components/MapLink.tsx.
// 지도 노트(`지도.md`)가 있을 때만 보인다. 모양은 LatestDay와 같다 (custom.scss .bn-latest).
// 탐색기 파일 목록에서는 지도.md를 뺀다 (quartz.layout.ts filterFn) — 여기 하나만 둔다.

const MAP_SLUG = "지도"

const MapLink: QuartzComponent = ({ fileData, allFiles, displayClass }: QuartzComponentProps) => {
  if (!allFiles.some((f) => f.slug === MAP_SLUG)) return null
  const here = fileData.slug!
  return (
    <a
      class={classNames(displayClass, "bn-latest", "bn-map-link", here === MAP_SLUG ? "active" : "")}
      href={resolveRelative(here, MAP_SLUG as FullSlug)}
      data-slug={MAP_SLUG}
    >
      지도
    </a>
  )
}

export default (() => MapLink) satisfies QuartzComponentConstructor
