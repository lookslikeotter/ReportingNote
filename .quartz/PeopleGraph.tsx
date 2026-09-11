import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"
// @ts-ignore
import script from "./scripts/peopleGraph.inline"
import style from "./styles/graph.scss"
import { classNames } from "../util/lang"
import { D3Config } from "./Graph"

// 봉누도2 — 인물 그래프. 원본은 볼트의 .quartz/PeopleGraph.tsx.
// GitHub Actions가 빌드 때 quartz/components/에 복사한다. 기본 Graph와 스타일(graph.scss)은 공유하고,
// 그림 영역 이름(people-graph-container)을 달리해서 두 그래프가 서로 간섭하지 않게 한다.

const defaultCfg: D3Config = {
  drag: true,
  zoom: true,
  depth: -1,
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

export default ((opts?: Partial<D3Config>) => {
  const PeopleGraph: QuartzComponent = ({ displayClass }: QuartzComponentProps) => {
    const cfg = { ...defaultCfg, ...opts }
    return (
      <div class={classNames(displayClass, "graph", "people-graph")}>
        <div class="graph-outer">
          <div class="people-graph-container" data-cfg={JSON.stringify(cfg)}></div>
        </div>
      </div>
    )
  }

  PeopleGraph.css = style
  PeopleGraph.afterDOMLoaded = script

  return PeopleGraph
}) satisfies QuartzComponentConstructor
