import { FullSlug, resolveRelative } from "../util/path"
import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"
import { classNames } from "../util/lang"

// 봉누도2 — 제목 아래 태그 목록. 원본은 볼트의 .quartz/quartz/components/BnTagList.tsx (빌드 때 Quartz에 복사).
// Quartz v4.5.2 TagList와 같되, 세력 관계 태그(동맹/·협력/·경쟁/·적대/ + 상대 세력)는 뺀다.
// 그 태그는 그래프의 세력 사이 선을 그리기 위한 것이라 읽을 때는 필요 없다.

const HIDDEN_TAG = /^(동맹|협력|경쟁|적대)\//

const BnTagList: QuartzComponent = ({ fileData, displayClass }: QuartzComponentProps) => {
  const tags = (fileData.frontmatter?.tags ?? []).filter((tag) => !HIDDEN_TAG.test(tag))
  if (tags.length === 0) return null
  return (
    <ul class={classNames(displayClass, "tags")}>
      {tags.map((tag) => {
        const linkDest = resolveRelative(fileData.slug!, `tags/${tag}` as FullSlug)
        return (
          <li>
            <a href={linkDest} class="internal tag-link">
              {tag}
            </a>
          </li>
        )
      })}
    </ul>
  )
}

BnTagList.css = `
.tags {
  list-style: none;
  display: flex;
  padding-left: 0;
  gap: 0.4rem;
  margin: 1rem 0;
  flex-wrap: wrap;
}

.section-li > .section > .tags {
  justify-content: flex-end;
}

.tags > li {
  display: inline-block;
  white-space: nowrap;
  margin: 0;
  overflow-wrap: normal;
}

a.internal.tag-link {
  border-radius: 8px;
  background-color: var(--highlight);
  padding: 0.2rem 0.4rem;
  margin: 0 0.1rem;
}
`

export default (() => BnTagList) satisfies QuartzComponentConstructor
