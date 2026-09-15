import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"
// @ts-ignore
import script from "./scripts/miniMap.inline"
import { classNames } from "../util/lang"
import { FullSlug, resolveRelative } from "../util/path"

// 봉누도2 — 오른쪽 위 작은 지도. 원본은 볼트의 .quartz/quartz/components/MiniMap.tsx (빌드 때 Quartz에 복사).
// 자리만 만들고, miniMap.inline.ts가 바탕 지도와 장소 점을 채운다. 오른쪽 위 '지도 크게 보기'는 지도 페이지(`지도.md`)로.
// 지도 페이지 자체에서는 CSS로 숨긴다 (custom.scss).

const MAP_SLUG = "지도"

const MiniMap: QuartzComponent = ({ fileData, allFiles, displayClass }: QuartzComponentProps) => {
  const hasPage = allFiles.some((f) => f.slug === MAP_SLUG)
  return (
    <div class={classNames(displayClass, "bn-minimap")}>
      <div class="bn-minimap-outer">
        <div class="bn-minimap-container"></div>
        {hasPage && (
          <a
            class="bn-minimap-open internal"
            href={resolveRelative(fileData.slug!, MAP_SLUG as FullSlug)}
            data-slug={MAP_SLUG}
          >
            지도 크게 보기
          </a>
        )}
      </div>
    </div>
  )
}

MiniMap.afterDOMLoaded = script

export default (() => MiniMap) satisfies QuartzComponentConstructor
