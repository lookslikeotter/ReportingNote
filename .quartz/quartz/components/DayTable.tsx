import { QuartzComponent, QuartzComponentConstructor } from "./types"
// @ts-ignore
import script from "./scripts/dayTable.inline"

// 봉누도2 — 일지 표의 큰 사건 펼치기. 원본은 볼트의 .quartz/quartz/components/DayTable.tsx (빌드 때 Quartz에 복사).
// 화면에는 아무것도 그리지 않고, dayTable.inline.ts만 싣는다.
//   일지 표에서 사건 칸이 "↳"로 시작하는 행은 바로 위 큰 사건의 하위 사건 행이다.
//   일지·첫 화면·사건 목록 페이지에서는 하위 행을 접어 두고 큰 사건 행의 ▸ 버튼으로 펼친다.
//   그래프 선 창·사건 기록 표(.bn-case-table)에서는 접지 않고 들여쓰기만 한다.

const DayTable: QuartzComponent = () => null

DayTable.afterDOMLoaded = script

export default (() => DayTable) satisfies QuartzComponentConstructor
