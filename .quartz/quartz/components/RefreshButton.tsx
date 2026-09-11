import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"
import { classNames } from "../util/lang"

// 봉누도2 — 본문 위 새로고침 버튼. 원본은 볼트의 .quartz/quartz/components/RefreshButton.tsx (빌드 때 Quartz에 복사).
// 누르면 지금 페이지와 사이트 스크립트·스타일·데이터를 서버에서 새로 받은 뒤 다시 불러온다 (Ctrl+F5와 비슷).
// 사이트를 고친 뒤 브라우저가 옛 스크립트를 계속 쓰고 있을 때 쓴다.

const RefreshButton: QuartzComponent = ({ displayClass }: QuartzComponentProps) => (
  <button
    class={classNames(displayClass, "bn-refresh")}
    aria-label="새로고침"
    title="새로고침 (사이트 새 버전 받기)"
  >
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
    </svg>
  </button>
)

RefreshButton.afterDOMLoaded = `
function bnHardRefresh(e) {
  var btn = e.currentTarget;
  if (btn.classList.contains("spinning")) return;
  btn.classList.add("spinning");
  // 지금 페이지 + 사이트 스크립트·스타일 + 그래프 데이터를 캐시 없이 다시 받아 브라우저 캐시를 새것으로 바꾼다
  var urls = new Set([location.href.split("#")[0]]);
  var root = null;
  document.querySelectorAll("script[src]").forEach(function (s) {
    urls.add(s.src);
    if (s.src.indexOf("postscript.js") >= 0) root = new URL(".", s.src);
  });
  document.querySelectorAll('link[rel="stylesheet"][href]').forEach(function (l) {
    urls.add(l.href);
  });
  if (root) urls.add(new URL("static/contentIndex.json", root).href);
  var mine = Array.from(urls).filter(function (u) {
    try { return new URL(u).origin === location.origin; } catch (err) { return false; }
  });
  Promise.allSettled(mine.map(function (u) { return fetch(u, { cache: "reload" }); })).then(function () {
    location.reload();
  });
}

document.addEventListener("nav", function () {
  document.querySelectorAll(".bn-refresh").forEach(function (btn) {
    btn.addEventListener("click", bnHardRefresh);
    window.addCleanup(function () { btn.removeEventListener("click", bnHardRefresh); });
  });
});
`

export default (() => RefreshButton) satisfies QuartzComponentConstructor
