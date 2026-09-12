import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"
import { classNames } from "../util/lang"

// 봉누도2 — 좁은 화면(휴대폰)에서 그래프 두 개를 접었다 펴는 버튼. 원본은 볼트의 .quartz/quartz/components/GraphToggle.tsx.
// 넓은 화면에서는 CSS로 숨긴다. 누르면 body에 bn-show-graphs를 켜고 끈다 (custom.scss).

const GraphToggle: QuartzComponent = ({ displayClass }: QuartzComponentProps) => (
  <button class={classNames(displayClass, "bn-graph-toggle")} aria-expanded="false">
    그래프 보기
  </button>
)

GraphToggle.afterDOMLoaded = `
document.addEventListener("nav", () => {
  for (const btn of document.querySelectorAll(".bn-graph-toggle")) {
    const sync = () => {
      const on = document.body.classList.contains("bn-show-graphs")
      btn.setAttribute("aria-expanded", String(on))
      btn.textContent = on ? "그래프 닫기" : "그래프 보기"
    }
    const onClick = () => {
      document.body.classList.toggle("bn-show-graphs")
      sync()
    }
    sync()
    btn.addEventListener("click", onClick)
    window.addCleanup(() => btn.removeEventListener("click", onClick))
  }
})
`

export default (() => GraphToggle) satisfies QuartzComponentConstructor
