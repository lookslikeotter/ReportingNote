import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"
// @ts-ignore
import script from "./scripts/entityEvents.inline"
import { classNames } from "../util/lang"

// 봉누도2 — 인물·세력 페이지 아래 '사건 기록' 표. 원본은 볼트의 .quartz/quartz/components/EntityEvents.tsx (빌드 때 Quartz에 복사).
// 일지 표에서 이 인물·세력이 '관련 인물' 칸에 있는 행(명총희는 '입수 경로' 칸이 인물 링크인 행도)과
// 사건의 `가담인물`에 이 인물이 있는 행을 일차 순으로 모아 일지와 같은 모양의 표로 보여 준다. ☕도 들어간다.
// 여기서는 자리만 만들고, 표는 entityEvents.inline.ts가 페이지를 연 뒤 일지 표를 읽어 채운다.

const showOn = (slug: string) =>
  /^0[23]-(인물|세력)\//.test(slug) && !/(인물-목록|세력-목록)$/.test(slug)

const EntityEvents: QuartzComponent = ({ fileData, displayClass }: QuartzComponentProps) => {
  if (!showOn(fileData.slug ?? "")) return null
  return (
    <section class={classNames(displayClass, "bn-entity-events")}>
      <h2>사건 기록</h2>
      <p class="bn-entity-events-status">일지를 읽는 중…</p>
    </section>
  )
}

EntityEvents.afterDOMLoaded = script

export default (() => EntityEvents) satisfies QuartzComponentConstructor
