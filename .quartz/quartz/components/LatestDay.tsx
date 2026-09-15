import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"
import { FullSlug, resolveRelative } from "../util/path"
import { classNames } from "../util/lang"

// 봉누도2 — 탐색기 맨 위 '최신 일지' 항목. 원본은 볼트의 .quartz/quartz/components/LatestDay.tsx (빌드 때 Quartz에 복사).
// 첫 화면(index)은 배포 때 가장 큰 일차의 일지를 복사한 것이라, 탐색기의 '일지' 폴더 위에 그 일차로 가는 홈 링크를 둔다.
// 이름은 "N일차 일지". 최상위 폴더보다 조금 크게 (custom.scss .bn-latest). 첫 화면에서는 지금 페이지 표시(active).

const DAY_SLUG = /^01-일지\/(\d+)일차$/

const LatestDay: QuartzComponent = ({ fileData, allFiles, displayClass }: QuartzComponentProps) => {
  const days = allFiles
    .map((f) => Number(f.slug?.match(DAY_SLUG)?.[1] ?? NaN))
    .filter((n) => !Number.isNaN(n))
  if (days.length === 0) return null
  const latest = Math.max(...days)
  const here = fileData.slug!
  return (
    <a
      class={classNames(displayClass, "bn-latest", here === "index" ? "active" : "")}
      href={resolveRelative(here, "index" as FullSlug)}
      data-slug="index"
      title="첫 화면 (최신 일지)"
    >
      <span class="bn-latest-icon" aria-hidden="true">
        📰
      </span>
      {latest}일차 일지
    </a>
  )
}

export default (() => LatestDay) satisfies QuartzComponentConstructor
