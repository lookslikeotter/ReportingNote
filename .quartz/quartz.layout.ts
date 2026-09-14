import { PageLayout, SharedLayout } from "./quartz/cfg"
import * as Component from "./quartz/components"
import ExplorerDefaults from "./quartz/components/ExplorerDefaults"
import PeopleGraph from "./quartz/components/PeopleGraph"
import FontLoader from "./quartz/components/FontLoader"
import RefreshButton from "./quartz/components/RefreshButton"
import DayLegend from "./quartz/components/DayLegend"
import EntityEvents from "./quartz/components/EntityEvents"
import DayTable from "./quartz/components/DayTable"
import BnTagList from "./quartz/components/BnTagList"
import BnFooter from "./quartz/components/BnFooter"
import BnHead from "./quartz/components/BnHead"
import BnTitle from "./quartz/components/BnTitle"
import BnBreadcrumbs from "./quartz/components/BnBreadcrumbs"
import InfoBox from "./quartz/components/InfoBox"
import DayNav from "./quartz/components/DayNav"
import LinkChips from "./quartz/components/LinkChips"
import GraphToggle from "./quartz/components/GraphToggle"
import LatestDay from "./quartz/components/LatestDay"

// 봉누도2 — 원본은 볼트의 .quartz/quartz.layout.ts. GitHub Actions가 빌드 때 Quartz에 덮어쓴다.
// 실제 날짜가 보이지 않도록 ContentMeta(수정일·읽는 시간)는 넣지 않고, 바닥글도 도구 이름·연도가 없는 BnFooter를 쓴다.
// 왼쪽 위 사이트 제목(PageTitle)은 넣지 않는다.

// 폴더는 기본으로 접고, ExplorerDefaults가 '01 일지'만 처음에 펼쳐 둔다.
// 이름 앞 번호(01 일지, 001 이윤진)와 사건 폴더·문서의 번호(0일차-01 …, 0일차-01-2 … → 제목만)는 화면에서만 떼고,
// 정렬은 원래 이름대로 한 뒤에 뗀다 (sort → map 순서)
const explorer = Component.Explorer({
  folderDefaultState: "collapsed",
  folderClickBehavior: "collapse",
  useSavedState: true,
  order: ["filter", "sort", "map"],
  mapFn: (node) => {
    // 사건 폴더·노트 "0일차-02 제목"·"0일차-02-1 제목" → "제목", 그 밖의 번호 접두어 "02 인물" → "인물"
    node.displayName = node.displayName
      .replace(/^\d+일차-\d+(?:-\d+)?\s+/, "")
      .replace(/^\d+\s+/, "")
      .replace(/^？/, "?")
  },
})

// components shared across all pages
export const sharedPageComponents: SharedLayout = {
  // 탭 제목에서 번호를 뗀 Head
  head: BnHead(),
  header: [],
  // 본문 아래: 인물·세력 페이지의 '사건 기록' 표 (다른 페이지에서는 아무것도 그리지 않음), 인물·세력 링크 칩 스크립트
  // DayTable: 일지 표의 큰 사건 펼치기 (화면에는 안 그리고 스크립트만)
  afterBody: [EntityEvents(), LinkChips(), DayTable(), ExplorerDefaults(), FontLoader()],
  footer: BnFooter(),
}

// components for pages that display a single page (e.g. a single note)
export const defaultContentPageLayout: PageLayout = {
  // 새로고침 버튼은 경로 표시(Home > …) 왼쪽 (custom.scss에서 한 줄로 배치)
  beforeBody: [
    RefreshButton(),
    Component.ConditionalRender({
      component: BnBreadcrumbs(),
      condition: (page) => page.fileData.slug !== "index",
    }),
    // 제목·경로는 관리용 번호를 뗀 이름으로
    BnTitle(),
    // 일지·사건 목록 페이지에서만 제목 오른쪽에 표 색 안내
    DayLegend(),
    // 일지·사건 페이지의 이전/다음 이동
    DayNav(),
    // 노트 type별 속성 카드
    InfoBox(),
    // 세력 관계 태그(경쟁/… 등)는 빼고 보여 주는 태그 목록
    BnTagList(),
    // 좁은 화면에서만 보이는 그래프 접기/펴기
    GraphToggle(),
  ],
  left: [
    Component.MobileOnly(Component.Spacer()),
    Component.Flex({
      components: [
        {
          Component: Component.Search(),
          grow: true,
        },
        { Component: Component.Darkmode() },
        { Component: Component.ReaderMode() },
      ],
    }),
    // 탐색기 맨 위: 최신 일지(첫 화면)로 가는 항목
    LatestDay(),
    explorer,
  ],
  // 오른쪽은 그래프 2개만 (위: 인물 그래프, 아래: 기본 그래프). 목차·백링크는 넣지 않는다.
  right: [
    PeopleGraph(),
    Component.Graph({
      localGraph: { fontSize: 1.4, repelForce: 0.8, linkDistance: 50, showTags: false },
      globalGraph: { fontSize: 1.0, showTags: false },
    }),
  ],
}

// components for pages that display lists of pages  (e.g. tags or folders)
export const defaultListPageLayout: PageLayout = {
  beforeBody: [RefreshButton(), BnBreadcrumbs(), BnTitle()],
  left: [
    Component.MobileOnly(Component.Spacer()),
    Component.Flex({
      components: [
        {
          Component: Component.Search(),
          grow: true,
        },
        { Component: Component.Darkmode() },
      ],
    }),
    // 탐색기 맨 위: 최신 일지(첫 화면)로 가는 항목
    LatestDay(),
    explorer,
  ],
  right: [],
}
