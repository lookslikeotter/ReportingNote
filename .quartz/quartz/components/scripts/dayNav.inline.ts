// 봉누도2 — 일차 선택 상자(DayNav.tsx)에서 고르면 그 일지로 이동한다. 원본은 볼트의 .quartz/quartz/components/scripts/dayNav.inline.ts.

document.addEventListener("nav", () => {
  for (const sel of document.querySelectorAll<HTMLSelectElement>(".bn-dayselect")) {
    const onChange = () => {
      if (sel.value) window.spaNavigate(new URL(sel.value, window.location.toString()))
    }
    sel.addEventListener("change", onChange)
    window.addCleanup(() => sel.removeEventListener("change", onChange))
  }
})
