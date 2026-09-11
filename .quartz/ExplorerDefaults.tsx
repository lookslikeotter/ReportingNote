import { QuartzComponent, QuartzComponentConstructor } from "./types"

// 봉누도2 — 원본은 볼트의 .quartz/ExplorerDefaults.tsx. GitHub Actions가 빌드 때 quartz/components/에 복사한다.
// 폴더 목록 기본값은 전부 접기(quartz.layout.ts). 방문자 브라우저에 한 번만,
// '00 취재 노트'와 '01 일지'를 펼친 상태로 미리 기록해 둔다.
// 기본 펼침 폴더를 바꾸면 KEY의 버전 숫자를 올려야 기존 방문자에게도 다시 적용된다.

const ExplorerDefaults: QuartzComponent = () => null

ExplorerDefaults.beforeDOMLoaded = `
try {
  var KEY = "bn-explorer-default-v1";
  if (!localStorage.getItem(KEY)) {
    var openFolders = ["00-취재-노트", "01-일지"];
    var state = [];
    openFolders.forEach(function (p) {
      state.push({ path: p + "/index", collapsed: false });
      state.push({ path: p, collapsed: false });
    });
    localStorage.setItem("fileTree", JSON.stringify(state));
    localStorage.setItem(KEY, "1");
  }
} catch (e) {}
`

export default (() => ExplorerDefaults) satisfies QuartzComponentConstructor
