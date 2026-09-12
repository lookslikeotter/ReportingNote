import { decorateLinks, linkResolver, loadContentData } from "./bongnudo"

// 봉누도2 — 페이지를 열 때 본문·속성 카드의 인물·세력 링크에 분류 칩을 붙인다 (LinkChips.tsx가 싣는다).
// 원본은 볼트의 .quartz/quartz/components/scripts/linkChips.inline.ts.
// 나중에 채워지는 표(사건 기록 표, 그래프 선 창)는 각자 decorateLinks를 부른다.

document.addEventListener("nav", async () => {
  const root = document.querySelector(".center")
  if (!root) return
  const data = await loadContentData()
  decorateLinks(root, data, linkResolver(data))
})
