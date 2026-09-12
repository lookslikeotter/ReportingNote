import { QuartzComponent, QuartzComponentConstructor } from "./types"
// @ts-ignore
import script from "./scripts/linkChips.inline"

// 봉누도2 — 인물·세력 링크 앞에 분류 표시(칩)를 붙이는 스크립트를 싣는 빈 부품.
// 원본은 볼트의 .quartz/quartz/components/LinkChips.tsx (빌드 때 Quartz에 복사).
// 인물은 분류 태그 색 점(기관 파랑·시민 초록·갱 빨강, 그래프와 같은 색), 세력은 네모. 규칙은 bongnudo.ts decorateLinks.

const LinkChips: QuartzComponent = () => null
LinkChips.afterDOMLoaded = script

export default (() => LinkChips) satisfies QuartzComponentConstructor
