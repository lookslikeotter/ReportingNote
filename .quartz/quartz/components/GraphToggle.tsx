import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"
import { classNames } from "../util/lang"

// 봉누도2 — 좁은 화면(휴대폰)에서 오른쪽 지도·그래프를 접었다 펴는 버튼. 원본은 볼트의 .quartz/quartz/components/GraphToggle.tsx.
// 넓은 화면에서는 CSS로 숨긴다. 누르면 body에 bn-show-graphs를 켜고 끈다 (custom.scss).
// 펼칠 때 bn-graph-mode 이벤트를 보내 접혀 있던(너비 0) 지도·그래프를 그리게 한다.

const GraphToggle: QuartzComponent = ({ displayClass }: QuartzComponentProps) => (
  <button class={classNames(displayClass, "bn-graph-toggle")} aria-expanded="false">
    지도·그래프 보기
  </button>
)

GraphToggle.afterDOMLoaded = `
document.addEventListener("nav", () => {
  for (const btn of document.querySelectorAll(".bn-graph-toggle")) {
    const sync = () => {
      const on = document.body.classList.contains("bn-show-graphs")
      btn.setAttribute("aria-expanded", String(on))
      btn.textContent = on ? "지도·그래프 닫기" : "지도·그래프 보기"
    }
    const onClick = () => {
      const on = document.body.classList.toggle("bn-show-graphs")
      sync()
      if (on) document.dispatchEvent(new CustomEvent("bn-graph-mode", { detail: {} }))
    }
    sync()
    btn.addEventListener("click", onClick)
    window.addCleanup(() => btn.removeEventListener("click", onClick))
  }
})
`

export default (() => GraphToggle) satisfies QuartzComponentConstructor
