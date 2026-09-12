import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"
import breadcrumbsStyle from "./styles/breadcrumbs.scss"
import { resolveRelative, simplifySlug } from "../util/path"
import { classNames } from "../util/lang"
import { trieFromAllFiles } from "../util/ctx"
import { displayCrumb, displayName } from "./bnNames"

// 봉누도2 — 경로 표시(홈 › 인물 › 김철수). 원본은 볼트의 .quartz/quartz/components/BnBreadcrumbs.tsx (빌드 때 Quartz에 복사).
// Quartz v4.5.2 Breadcrumbs와 같되, 폴더·문서 이름의 관리용 번호를 뗀다 (bnNames.ts). 첫 조각은 "홈".

const BnBreadcrumbs: QuartzComponent = ({
  fileData,
  allFiles,
  displayClass,
  ctx,
}: QuartzComponentProps) => {
  const trie = (ctx.trie ??= trieFromAllFiles(allFiles))
  const pathNodes = trie.ancestryChain(fileData.slug!.split("/"))
  if (!pathNodes) return null

  const crumbs = pathNodes.map((node, idx) => {
    const last = idx === pathNodes.length - 1
    return {
      // 폴더는 경로 조각, 문서는 제목에서 번호를 뗀다
      name: idx === 0 ? "홈" : last ? displayName(node.displayName) : displayCrumb(node.displayName),
      path: last ? "" : resolveRelative(fileData.slug!, simplifySlug(node.slug)),
    }
  })

  return (
    <nav class={classNames(displayClass, "breadcrumb-container")} aria-label="breadcrumbs">
      {crumbs.map((crumb, index) => (
        <div class="breadcrumb-element">
          <a href={crumb.path}>{crumb.name}</a>
          {index !== crumbs.length - 1 && <p> › </p>}
        </div>
      ))}
    </nav>
  )
}

BnBreadcrumbs.css = breadcrumbsStyle

export default (() => BnBreadcrumbs) satisfies QuartzComponentConstructor
