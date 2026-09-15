import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"
// @ts-ignore
import script from "./scripts/bnMap.inline"
import { classNames } from "../util/lang"

// 봉누도2 — 지도 페이지(볼트 맨 위 `지도.md`)의 큰 지도. 원본은 볼트의 .quartz/quartz/components/BnMap.tsx (빌드 때 Quartz에 복사).
// 여기서는 자리만 만들고, bnMap.inline.ts가 바탕 지도(static/map/tiles)를 깔고
// 세력·장소 노트의 `좌표`·`우편번호`와 일지 표 '장소' 칸을 읽어 장소 점·일차 고르기를 채운다.
// 점에 마우스를 올리면 나오는 사건 목록은 오른쪽 사이드바의 MapPanel.tsx에 들어간다.

const MAP_SLUG = "지도"

const BnMap: QuartzComponent = ({ fileData, displayClass }: QuartzComponentProps) => {
  if (fileData.slug !== MAP_SLUG) return null
  return (
    <section class={classNames(displayClass, "bn-map")}>
      <div class="bn-map-days" role="toolbar" aria-label="일차 고르기"></div>
      <div class="bn-map-frame">
        <div class="bn-map-canvas"></div>
        <p class="bn-map-status">지도를 불러오는 중…</p>
      </div>
      <details class="bn-map-unplaced" hidden>
        <summary></summary>
        <ul></ul>
      </details>
    </section>
  )
}

BnMap.afterDOMLoaded = script

export default (() => BnMap) satisfies QuartzComponentConstructor
