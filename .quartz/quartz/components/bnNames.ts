// 봉누도2 — 화면에 보이는 이름에서 관리용 번호를 떼는 공용 함수. 원본은 볼트의 .quartz/quartz/components/bnNames.ts.
// BnTitle(제목)·BnBreadcrumbs(경로)·BnHead(탭 제목)·InfoBox·DayNav가 쓴다.
// 파일명·slug·탐색기 정렬은 그대로 두고 보이는 글자만 바꾼다.
//   인물 "001 김철수" → "김철수" · 사건 "3일차-02 제목" → "제목" · 폴더 "02 인물" → "인물"

export function displayName(name: string): string {
  return name
    .replace(/^\d{3}\s+/, "")
    .replace(/^\d+일차-\d+\s+/, "")
    .replace(/^\d{2}\s+(?=\S)/, "")
}

// 경로 조각(폴더 이름 "02 인물" 또는 slug "02-인물"): "인물". "0일차"는 그대로
export function displayCrumb(segment: string): string {
  return segment.replace(/^\d{2}[-\s](?=\S)/, "").replaceAll("-", " ")
}

// 사건 파일명 "3일차-02 제목"에서 일차와 순번
export function caseIndex(name: string): { day: number; n: number } | null {
  const m = name.match(/^(\d+)일차-(\d+)\s/)
  return m ? { day: Number(m[1]), n: Number(m[2]) } : null
}
