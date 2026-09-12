import HeadConstructor from "./Head"
import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"
import { displayName } from "./bnNames"

// 봉누도2 — <head>. 원본은 볼트의 .quartz/quartz/components/BnHead.tsx (빌드 때 Quartz에 복사).
// 기본 Head를 그대로 쓰되, 브라우저 탭 제목(<title>·og:title)에서 관리용 번호를 뗀다 (bnNames.ts).

export default (() => {
  const Head = HeadConstructor()
  const BnHead: QuartzComponent = (props: QuartzComponentProps) => {
    const fm = props.fileData.frontmatter
    const fileData = fm
      ? { ...props.fileData, frontmatter: { ...fm, title: displayName(fm.title) } }
      : props.fileData
    return <Head {...props} fileData={fileData} />
  }
  BnHead.css = Head.css
  BnHead.beforeDOMLoaded = Head.beforeDOMLoaded
  BnHead.afterDOMLoaded = Head.afterDOMLoaded
  return BnHead
}) satisfies QuartzComponentConstructor
