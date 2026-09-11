import { PageLayout, SharedLayout } from "./quartz/cfg"
import * as Component from "./quartz/components"
import ExplorerDefaults from "./quartz/components/ExplorerDefaults"
import PeopleGraph from "./quartz/components/PeopleGraph"

// 봉누도2 — 원본은 볼트의 .quartz/quartz.layout.ts. GitHub Actions가 빌드 때 Quartz에 덮어쓴다.
// 실제 날짜가 보이지 않도록 ContentMeta(수정일·읽는 시간)는 넣지 않는다.
// 왼쪽 위 사이트 제목(PageTitle)은 넣지 않는다.

// 폴더는 기본으로 접고, ExplorerDefaults가 '01 일지'만 처음에 펼쳐 둔다.
const explorer = Component.Explorer({
  folderDefaultState: "collapsed",
  folderClickBehavior: "collapse",
  useSavedState: true,
})

// components shared across all pages
export const sharedPageComponents: SharedLayout = {
  head: Component.Head(),
  header: [],
  afterBody: [ExplorerDefaults()],
  footer: Component.Footer({
    links: {},
  }),
}

// components for pages that display a single page (e.g. a single note)
export const defaultContentPageLayout: PageLayout = {
  beforeBody: [
    Component.ConditionalRender({
      component: Component.Breadcrumbs(),
      condition: (page) => page.fileData.slug !== "index",
    }),
    Component.ArticleTitle(),
    Component.TagList(),
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
    explorer,
  ],
  right: [
    PeopleGraph(),
    Component.Graph(),
    Component.DesktopOnly(Component.TableOfContents()),
    Component.Backlinks(),
  ],
}

// components for pages that display lists of pages  (e.g. tags or folders)
export const defaultListPageLayout: PageLayout = {
  beforeBody: [Component.Breadcrumbs(), Component.ArticleTitle()],
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
    explorer,
  ],
  right: [],
}
