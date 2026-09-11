import { QuartzComponent, QuartzComponentConstructor } from "./types"

// 봉누도2 — 원본은 볼트의 .quartz/FontLoader.tsx. GitHub Actions가 빌드 때 quartz/components/에 복사한다.
// Pretendard(Inter 기반 + 한글) 글꼴을 CDN에서 불러온다. Google Fonts에 없어서 quartz.config.ts는 fontOrigin "local".
// Quartz는 페이지를 옮길 때 <head>를 교체하므로 spa-preserve를 붙여 지워지지 않게 한다.

const FontLoader: QuartzComponent = () => null

FontLoader.beforeDOMLoaded = `
try {
  if (!document.getElementById("bn-pretendard")) {
    var pc = document.createElement("link");
    pc.rel = "preconnect";
    pc.href = "https://cdn.jsdelivr.net";
    pc.crossOrigin = "";
    pc.setAttribute("spa-preserve", "");
    document.head.appendChild(pc);

    var l = document.createElement("link");
    l.id = "bn-pretendard";
    l.rel = "stylesheet";
    l.href = "https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css";
    l.setAttribute("spa-preserve", "");
    document.head.appendChild(l);
  }
} catch (e) {}
`

export default (() => FontLoader) satisfies QuartzComponentConstructor
