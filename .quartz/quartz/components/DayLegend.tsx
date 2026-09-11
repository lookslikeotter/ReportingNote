import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"
import { classNames } from "../util/lang"

// 봉누도2 — 일지(N일차)·사건 목록 페이지 제목 오른쪽의 색 안내. 원본은 볼트의 .quartz/quartz/components/DayLegend.tsx.
// 일지 표 행 배경색이 취재가치(등급)를 나타낸다: 시간 칸의 bn-lv-* 이름표 → custom.scss가 행을 칠함.

const showOn = (slug: string) => slug === "index" || /^01-일지\/(\d+일차|사건-목록)$/.test(slug)

const DayLegend: QuartzComponent = ({ fileData, displayClass }: QuartzComponentProps) => {
  if (!showOn(fileData.slug ?? "")) return null
  return (
    <div class={classNames(displayClass, "bn-legend")} aria-label="표 색 안내">
      <span class="bn-legend-item">
        <i class="bn-swatch news" />
        사건
      </span>
      <span class="bn-legend-item">
        <i class="bn-swatch scoop" />
        특종
      </span>
      <span class="bn-legend-item">
        <i class="bn-swatch event" />
        이벤트
      </span>
      <span class="bn-legend-item">
        <i class="bn-swatch" />
        일상
      </span>
    </div>
  )
}

export default (() => DayLegend) satisfies QuartzComponentConstructor
