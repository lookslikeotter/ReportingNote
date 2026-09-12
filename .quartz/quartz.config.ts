import { QuartzConfig } from "./quartz/cfg"
import * as Plugin from "./quartz/plugins"
import { BnDays } from "./quartz/plugins/emitters/bnDays"

/**
 * 봉누도2 — 나희정의 취재수첩 (Quartz v4.5.2 설정)
 * 원본은 볼트의 .quartz/quartz.config.ts. GitHub Actions가 빌드 때 Quartz에 덮어쓴다.
 */
const config: QuartzConfig = {
  configuration: {
    pageTitle: "나희정의 취재수첩",
    pageTitleSuffix: "",
    enableSPA: true,
    enablePopovers: true,
    analytics: null,
    locale: "ko-KR",
    baseUrl: "lookslikeotter.github.io/ReportingNote",
    ignorePatterns: ["private", "99 템플릿", ".obsidian", "CLAUDE.md"],
    defaultDateType: "modified",
    // Notion 스타일 (getdesign.md의 Notion DESIGN.md 참고). 글꼴은 Pretendard(Inter+한글)를
    // FontLoader가 CDN에서 불러오므로 fontOrigin은 local. 다크 모드 색은 원본에 없어 Notion 앱 다크 모드를 참고해 정함.
    theme: {
      fontOrigin: "local",
      cdnCaching: true,
      typography: {
        header: "Pretendard Variable",
        body: "Pretendard Variable",
        code: "IBM Plex Mono",
      },
      colors: {
        lightMode: {
          light: "#ffffff",
          lightgray: "#e5e3df",
          gray: "#a4a097",
          darkgray: "#37352f",
          dark: "#1a1a1a",
          secondary: "#0075de",
          tertiary: "#005bab",
          highlight: "rgba(0, 117, 222, 0.08)",
          textHighlight: "#f9e79f88",
        },
        darkMode: {
          light: "#191919",
          lightgray: "#2f2f2f",
          gray: "#7d7a75",
          darkgray: "#d4d4d4",
          dark: "#f0efed",
          secondary: "#529cca",
          tertiary: "#7cb4de",
          highlight: "rgba(82, 156, 202, 0.12)",
          textHighlight: "#b3aa0288",
        },
      },
    },
  },
  plugins: {
    transformers: [
      Plugin.FrontMatter(),
      Plugin.CreatedModifiedDate({
        priority: ["frontmatter", "filesystem"],
      }),
      Plugin.SyntaxHighlighting({
        theme: {
          light: "github-light",
          dark: "github-dark",
        },
        keepBackground: false,
      }),
      Plugin.ObsidianFlavoredMarkdown({ enableInHtmlEmbed: false }),
      Plugin.GitHubFlavoredMarkdown(),
      Plugin.TableOfContents(),
      Plugin.CrawlLinks({ markdownLinkResolution: "shortest" }),
      Plugin.Description(),
      Plugin.Latex({ renderEngine: "katex" }),
    ],
    filters: [Plugin.RemoveDrafts()],
    emitters: [
      Plugin.AliasRedirects(),
      Plugin.ComponentResources(),
      Plugin.ContentPage(),
      Plugin.FolderPage(),
      Plugin.TagPage(),
      // RSS는 실제 날짜가 나가므로 끈다
      Plugin.ContentIndex({
        enableSiteMap: true,
        enableRSS: false,
      }),
      Plugin.Assets(),
      Plugin.Static(),
      Plugin.Favicon(),
      Plugin.NotFoundPage(),
      // 봉누도2: 일지 표 데이터 (static/bn-days.json) — 그래프 선·선 창·사건 기록 표가 읽는다
      BnDays(),
    ],
  },
}

export default config
