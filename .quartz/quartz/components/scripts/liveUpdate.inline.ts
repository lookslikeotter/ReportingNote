// 봉누도2 — 새로고침 버튼과 자동 갱신. 원본은 볼트의 .quartz/quartz/components/scripts/liveUpdate.inline.ts.
// RefreshButton.tsx가 afterDOMLoaded로 싣는다.
//
// 자동 갱신: 사이트가 열려 있는 동안 POLL_MS마다 static/bn-version.json(배포 때 만들어짐)을 확인한다.
//   - 기록(노트)만 바뀌었으면 제자리 갱신: 새 사이트 데이터(contentIndex)를 window.bnContentIndex에 넣고
//     'bn-content-updated' 이벤트를 보낸 뒤, 지금 페이지를 스크롤 위치 그대로 다시 불러온다.
//     그래프·탐색기·검색 수정본은 window.bnContentIndex가 있으면 그걸 쓴다.
//   - 사이트 코드(.quartz)가 바뀌었으면 새 스크립트가 필요하므로 페이지 전체를 다시 불러온다 (스크롤 위치는 되살림).
//   - 선을 눌러 연 창, 검색, 그래프 크게 보기가 열려 있으면 닫힐 때까지 미룬다.

const POLL_MS = 30_000
const BUSY_SELECTOR = [
  ".bn-edge-popup",
  ".people-global-graph-outer.active",
  ".global-graph-outer.active",
  ".search > .search-container.active",
].join(", ")
const SCROLL_KEY = "bn-restore-scroll"

// 브라우저 콘솔에 남기는 기록 (문제가 생겼을 때 어디서 멈췄는지 보려고)
const log = (...args: unknown[]) => console.info("[bn-live]", ...args)

// 사이트 맨 위 주소 (postscript.js가 있는 곳)
function siteRoot(): URL {
  const s = [...document.querySelectorAll<HTMLScriptElement>("script[src]")].find((el) =>
    el.src.includes("postscript.js"),
  )
  return new URL(".", s?.src ?? location.href)
}

const meta = (name: string) =>
  document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)?.content ?? ""

// 지금 화면의 기록 버전, 불러와 둔 사이트 코드 버전 (페이지를 처음 열 때 기준)
let currentBuild = meta("bn-build")
const loadedCode = meta("bn-code")
let pending: { build: string; code: string } | null = null
let applying = false
let toldBusy = false
// 갱신에 실패하면(예: 캐시가 아직 옛 페이지를 줌) 이 시각까지 기다렸다가 다시 시도
let retryAt = 0
const RETRY_MS = 15_000
log("자동 갱신 켜짐", currentBuild.slice(0, 7) || "(버전 표시 없음)")

// 브라우저 캐시를 새 파일로 바꿔 둔다 (다음 불러오기 때 옛 파일을 쓰지 않게)
async function primeCache(urls: string[]) {
  await Promise.allSettled(urls.map((u) => fetch(u, { cache: "reload" })))
}

// 지금 페이지 + 사이트 스크립트·스타일 + 사이트 데이터 (같은 사이트 주소만)
function siteFiles(): string[] {
  const urls = new Set<string>([location.href.split("#")[0]])
  document.querySelectorAll<HTMLScriptElement>("script[src]").forEach((s) => urls.add(s.src))
  document
    .querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"][href]')
    .forEach((l) => urls.add(l.href))
  urls.add(new URL("static/contentIndex.json", siteRoot()).href)
  return [...urls].filter((u) => {
    try {
      return new URL(u).origin === location.origin
    } catch {
      return false
    }
  })
}

function saveScroll() {
  try {
    sessionStorage.setItem(SCROLL_KEY, JSON.stringify({ url: location.href, y: window.scrollY }))
  } catch {}
}

// 페이지 전체 새로 불러오기 (새로고침 버튼, 사이트 코드가 바뀐 자동 갱신)
async function hardReload() {
  log("페이지 전체 새로 불러오기")
  await primeCache(siteFiles())
  saveScroll()
  location.reload()
}

// 주소에 버전을 붙인다. GitHub Pages 앞단 캐시(CDN)는 배포 직후 잠시 옛 파일을 줄 수 있어서,
// 버전이 붙은 주소로 받아야 캐시를 건너뛰고 새 파일을 받는다
function withVersion(u: string | URL, build: string): URL {
  const url = new URL(u)
  url.searchParams.set("bnv", build.slice(0, 12))
  return url
}

// 기록만 바뀌었을 때: 새 데이터로 제자리 갱신
async function softReload(build: string) {
  // 지금 페이지의 새 버전을 받아, 정말 새 배포 것인지 확인한다 (아니면 실패 → 잠시 뒤 다시)
  const pageUrl = withVersion(location.href, build)
  const pageRes = await fetch(pageUrl)
  if (!pageRes.ok) throw new Error("페이지 " + pageRes.status)
  const got = (await pageRes.text()).match(/name="bn-build" content="([0-9a-f]+)"/)?.[1] ?? ""
  if (got !== build) throw new Error(`아직 옛 페이지를 받음 (${got.slice(0, 7) || "버전 없음"})`)

  const fresh = fetch(withVersion(new URL("static/contentIndex.json", siteRoot()), build)).then((r) => {
    if (!r.ok) throw new Error("데이터 " + r.status)
    return r.json()
  })
  await fresh
  ;(window as any).bnContentIndex = fresh
  // 원래 주소의 캐시도 새것으로 (다음에 이 페이지를 그냥 열 때를 위해)
  void primeCache([location.href.split("#")[0]])
  document.dispatchEvent(new CustomEvent("bn-content-updated", { detail: {} }))
  const y = window.scrollY
  // 사이트가 다른 페이지로 이동하는 중이면 spaNavigate가 아무것도 하지 않고 끝난다 → nav가 안 오면 실패로 보고 다시 시도
  let navigated = false
  const onNav = () => (navigated = true)
  document.addEventListener("nav", onNav, { once: true })
  // isBack=true: 맨 위로 올리지 않고, 방문 기록도 새로 쌓지 않는다 (주소창은 그대로).
  // 버전 붙은 주소로 부르면 방금 받아 둔 새 페이지를 쓴다
  await window.spaNavigate(pageUrl, true)
  document.removeEventListener("nav", onNav)
  if (!navigated) throw new Error("페이지 갱신이 건너뛰어짐")
  window.scrollTo({ top: y })
  log("제자리 갱신 완료")
}

async function applyPending() {
  if (!pending || applying || Date.now() < retryAt) return
  if (document.querySelector(BUSY_SELECTOR)) {
    // 닫힌 뒤 다시 시도
    if (!toldBusy) log("창·검색이 열려 있어 갱신을 미룸")
    toldBusy = true
    return
  }
  toldBusy = false
  applying = true
  const next = pending
  try {
    if (next.code && loadedCode && next.code !== loadedCode) {
      await hardReload()
      return
    }
    await softReload(next.build)
    currentBuild = next.build
    if (pending === next) pending = null
  } catch (e) {
    retryAt = Date.now() + RETRY_MS
    console.warn("[bn-live] 갱신 실패, 15초 뒤 다시 시도", e)
  } finally {
    applying = false
  }
}

async function checkVersion() {
  try {
    const url = new URL("static/bn-version.json", siteRoot())
    url.searchParams.set("t", String(Date.now()))
    const r = await fetch(url, { cache: "no-store" })
    if (!r.ok) return
    const v = (await r.json()) as { build: string; code: string }
    if (!v.build) return
    if (!currentBuild) currentBuild = v.build // 버전 표시가 없는 옛 페이지: 지금 것을 기준으로
    else if (v.build !== currentBuild && pending?.build !== v.build) {
      pending = v
      log("새 버전 발견", currentBuild.slice(0, 7), "→", v.build.slice(0, 7))
    }
  } catch (e) {
    console.warn("[bn-live] 버전 확인 실패", e)
    return
  }
  await applyPending()
}

setInterval(checkVersion, POLL_MS)
setInterval(() => {
  if (pending) void applyPending()
}, 3000)
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) void checkVersion()
})

// 새로고침 버튼
function onRefreshClick(e: Event) {
  const btn = e.currentTarget as HTMLElement
  if (btn.classList.contains("spinning")) return
  btn.classList.add("spinning")
  void hardReload()
}

document.addEventListener("nav", () => {
  // 페이지 전체를 다시 불러온 경우: 보던 스크롤 위치로
  try {
    const saved = sessionStorage.getItem(SCROLL_KEY)
    if (saved) {
      sessionStorage.removeItem(SCROLL_KEY)
      const { url, y } = JSON.parse(saved)
      if (url === location.href) window.scrollTo({ top: y })
    }
  } catch {}

  document.querySelectorAll<HTMLElement>(".bn-refresh").forEach((btn) => {
    btn.addEventListener("click", onRefreshClick)
    window.addCleanup(() => btn.removeEventListener("click", onRefreshClick))
  })
})
