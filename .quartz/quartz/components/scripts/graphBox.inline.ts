import { GraphMode, applyGraphMode, setGraphMode } from "./bongnudo"

// 봉누도2 — 오른쪽 그래프 상자의 탭('이 페이지' ↔ '인물'). 원본은 볼트의 .quartz/quartz/components/scripts/graphBox.inline.ts.
// GraphBox.tsx가 두 그래프 스크립트와 함께 싣는다. 고른 탭은 브라우저에 남고(bongnudo.ts graphMode),
// 바꾸면 bn-graph-mode 이벤트로 두 그래프 스크립트가 보이는 쪽을 그린다.

document.addEventListener("nav", () => {
  applyGraphMode()
  for (const btn of document.querySelectorAll<HTMLElement>(".bn-graph-tabs button")) {
    const onClick = () => setGraphMode((btn.dataset.mode as GraphMode) ?? "local")
    btn.addEventListener("click", onClick)
    window.addCleanup(() => btn.removeEventListener("click", onClick))
  }
})
