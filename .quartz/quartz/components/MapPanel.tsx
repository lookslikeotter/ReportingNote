import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"
import { classNames } from "../util/lang"

// 봉누도2 — 지도 페이지(`지도.md`)의 오른쪽 사이드바 사건 칸. 원본은 볼트의 .quartz/quartz/components/MapPanel.tsx.
// 지도 페이지에는 그래프·작은 지도가 없고(GraphBox·MiniMap이 이 페이지에서는 아무것도 그리지 않는다) 이 칸이 그 자리를 쓴다.
// 자리만 만들고, bnMap.inline.ts가 점에 마우스를 올릴 때 그곳의 사건 목록으로 채운다.

const MAP_SLUG = "지도"

const MapPanel: QuartzComponent = ({ fileData, displayClass }: QuartzComponentProps) => {
  if (fileData.slug !== MAP_SLUG) return null
  return (
    <aside class={classNames(displayClass, "bn-map-side")}>
      <p class="bn-map-side-empty">지도의 점에 마우스를 올리면 그곳에서 있었던 사건이 여기 나온다.</p>
    </aside>
  )
}

export default (() => MapPanel) satisfies QuartzComponentConstructor
