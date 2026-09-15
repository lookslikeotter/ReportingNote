import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"
// @ts-ignore
import script from "./scripts/miniMap.inline"
import { classNames } from "../util/lang"

// 봉누도2 — 오른쪽 위 작은 지도. 원본은 볼트의 .quartz/quartz/components/MiniMap.tsx (빌드 때 Quartz에 복사).
// 자리만 만들고, miniMap.inline.ts가 바탕 지도와 장소 점을 채운다 (지도 페이지로는 탐색기의 '지도' 항목으로 간다).
// 지도 페이지 자체에서는 만들지 않는다.

const MAP_SLUG = "지도"

const MiniMap: QuartzComponent = ({ fileData, displayClass }: QuartzComponentProps) => {
  // 지도 페이지에는 큰 지도가 있고 오른쪽은 사건 칸(MapPanel.tsx)이 쓴다
  if (fileData.slug === MAP_SLUG) return null
  return (
    <div class={classNames(displayClass, "bn-minimap")}>
      <div class="bn-minimap-outer">
        <div class="bn-minimap-container"></div>
      </div>
    </div>
  )
}

MiniMap.afterDOMLoaded = script

export default (() => MiniMap) satisfies QuartzComponentConstructor
