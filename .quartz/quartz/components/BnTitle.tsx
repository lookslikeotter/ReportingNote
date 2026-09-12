import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"
import { classNames } from "../util/lang"
import { displayName } from "./bnNames"

// 봉누도2 — 페이지 제목. 원본은 볼트의 .quartz/quartz/components/BnTitle.tsx (빌드 때 Quartz에 복사).
// 기본 ArticleTitle과 같되 관리용 번호("001 김철수", "3일차-02 제목")를 뗀다 (bnNames.ts).

const BnTitle: QuartzComponent = ({ fileData, displayClass }: QuartzComponentProps) => {
  const title = fileData.frontmatter?.title
  if (!title) return null
  return <h1 class={classNames(displayClass, "article-title")}>{displayName(title)}</h1>
}

BnTitle.css = `
.article-title {
  margin: 2rem 0 0 0;
}
`

export default (() => BnTitle) satisfies QuartzComponentConstructor
