import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"
import style from "./styles/footer.scss"

// 봉누도2 — 바닥글. 원본은 볼트의 .quartz/quartz/components/BnFooter.tsx (빌드 때 Quartz에 복사).
// 기본 Footer는 "Created with Quartz vX · © 실제 연도"를 넣어 게임 밖 정보가 보이므로, 아무 글자도 없는 바닥글로 바꾼다.

const BnFooter: QuartzComponent = ({ displayClass }: QuartzComponentProps) => (
  <footer class={`${displayClass ?? ""}`}></footer>
)

BnFooter.css = style

export default (() => BnFooter) satisfies QuartzComponentConstructor
