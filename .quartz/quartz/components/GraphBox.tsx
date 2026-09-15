import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"
// @ts-ignore
import graphScript from "./scripts/graph.inline"
// @ts-ignore
import peopleScript from "./scripts/peopleGraph.inline"
// @ts-ignore
import tabsScript from "./scripts/graphBox.inline"
import style from "./styles/graph.scss"
import { classNames } from "../util/lang"
import { D3Config } from "./Graph"

// 봉누도2 — 오른쪽 아래 그래프 상자. 원본은 볼트의 .quartz/quartz/components/GraphBox.tsx (빌드 때 Quartz에 복사).
// 탭 하나로 두 그래프를 바꿔 본다: '이 페이지'(Quartz 기본 그래프 수정본, graph.inline.ts — 지금 페이지의 이웃 인물·세력·장소)
// 와 '인물'(peopleGraph.inline.ts — 인물 전부). 각 탭에 크게 보기 버튼과 창이 있다.
// 세 스크립트를 하나씩 IIFE로 감싸 함께 싣는다 (Quartz는 컴포넌트마다 스크립트 하나만 받는다).
// 고른 탭은 브라우저에 남는다 (graphBox.inline.ts · bongnudo.ts graphMode).

const graphIcon = (
  <svg
    version="1.1"
    xmlns="http://www.w3.org/2000/svg"
    xmlnsXlink="http://www.w3.org/1999/xlink"
    x="0px"
    y="0px"
    viewBox="0 0 55 55"
    fill="currentColor"
    xmlSpace="preserve"
  >
    <path
      d="M49,0c-3.309,0-6,2.691-6,6c0,1.035,0.263,2.009,0.726,2.86l-9.829,9.829C32.542,17.634,30.846,17,29,17
      s-3.542,0.634-4.898,1.688l-7.669-7.669C16.785,10.424,17,9.74,17,9c0-2.206-1.794-4-4-4S9,6.794,9,9s1.794,4,4,4
      c0.74,0,1.424-0.215,2.019-0.567l7.669,7.669C21.634,21.458,21,23.154,21,25s0.634,3.542,1.688,4.897L10.024,42.562
      C8.958,41.595,7.549,41,6,41c-3.309,0-6,2.691-6,6s2.691,6,6,6s6-2.691,6-6c0-1.035-0.263-2.009-0.726-2.86l12.829-12.829
      c1.106,0.86,2.44,1.436,3.898,1.619v10.16c-2.833,0.478-5,2.942-5,5.91c0,3.309,2.691,6,6,6s6-2.691,6-6c0-2.967-2.167-5.431-5-5.91
      v-10.16c1.458-0.183,2.792-0.759,3.898-1.619l7.669,7.669C41.215,39.576,41,40.26,41,41c0,2.206,1.794,4,4,4s4-1.794,4-4
      s-1.794-4-4-4c-0.74,0-1.424,0.215-2.019,0.567l-7.669-7.669C36.366,28.542,37,26.846,37,25s-0.634-3.542-1.688-4.897l9.665-9.665
      C46.042,11.405,47.451,12,49,12c3.309,0,6-2.691,6-6S52.309,0,49,0z M11,9c0-1.103,0.897-2,2-2s2,0.897,2,2s-0.897,2-2,2
      S11,10.103,11,9z M6,51c-2.206,0-4-1.794-4-4s1.794-4,4-4s4,1.794,4,4S8.206,51,6,51z M33,49c0,2.206-1.794,4-4,4s-4-1.794-4-4
      s1.794-4,4-4S33,46.794,33,49z M29,31c-3.309,0-6-2.691-6-6s2.691-6,6-6s6,2.691,6,6S32.309,31,29,31z M47,41c0,1.103-0.897,2-2,2
      s-2-0.897-2-2s0.897-2,2-2S47,39.897,47,41z M49,10c-2.206,0-4-1.794-4-4s1.794-4,4-4s4,1.794,4,4S51.206,10,49,10z"
    />
  </svg>
)

const baseCfg: D3Config = {
  drag: true,
  zoom: true,
  depth: 1,
  scale: 1.1,
  repelForce: 0.8,
  centerForce: 0.3,
  linkDistance: 50,
  fontSize: 1.2,
  opacityScale: 1,
  showTags: false,
  removeTags: [],
  focusOnHover: true,
  enableRadial: false,
}

interface GraphBoxOptions {
  localGraph?: Partial<D3Config>
  globalGraph?: Partial<D3Config>
  peopleGraph?: Partial<D3Config>
}

const defaults: Required<GraphBoxOptions> = {
  localGraph: { fontSize: 1.4, focusOnHover: false },
  globalGraph: { depth: -1, scale: 0.9, centerForce: 0.2, fontSize: 1.0 },
  peopleGraph: { depth: -1 },
}

export default ((opts?: GraphBoxOptions) => {
  const GraphBox: QuartzComponent = ({ fileData, displayClass }: QuartzComponentProps) => {
    // 지도 페이지에서는 오른쪽을 사건 칸(MapPanel.tsx)이 쓴다
    if (fileData.slug === "지도") return null
    const local = { ...baseCfg, ...defaults.localGraph, ...opts?.localGraph }
    const global = { ...baseCfg, ...defaults.globalGraph, ...opts?.globalGraph }
    const people = { ...baseCfg, ...defaults.peopleGraph, ...opts?.peopleGraph }
    return (
      <div class={classNames(displayClass, "graph", "bn-graph-box")} data-mode="local">
        <div class="bn-graph-tabs" role="tablist" aria-label="그래프 고르기">
          <button type="button" role="tab" data-mode="local" aria-selected="true">
            이 페이지
          </button>
          <button type="button" role="tab" data-mode="people" aria-selected="false">
            인물
          </button>
        </div>
        <div class="graph-outer bn-mode-local">
          <div class="graph-container" data-cfg={JSON.stringify(local)}></div>
          <button class="global-graph-icon" aria-label="전체 그래프">
            {graphIcon}
          </button>
        </div>
        <div class="graph-outer bn-mode-people">
          <div class="people-graph-container" data-cfg={JSON.stringify(people)}></div>
          <p class="bn-graph-note">만난 인물이 셋 이상 되면 인물 사이 선이 여기 그려진다.</p>
          <button class="people-global-graph-icon" aria-label="인물 그래프 크게 보기">
            {graphIcon}
          </button>
        </div>
        <div class="global-graph-outer">
          <div class="global-graph-container" data-cfg={JSON.stringify(global)}></div>
        </div>
        <div class="people-global-graph-outer">
          <div class="people-global-graph-container" data-cfg={JSON.stringify(people)}></div>
        </div>
      </div>
    )
  }

  GraphBox.css = style
  GraphBox.afterDOMLoaded = [tabsScript, peopleScript, graphScript]
    .map((s: string) => `(function () {\n${s}\n})();`)
    .join("\n")

  return GraphBox
}) satisfies QuartzComponentConstructor
