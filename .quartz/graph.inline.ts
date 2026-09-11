import type { ContentDetails } from "../../plugins/emitters/contentIndex"
import {
  SimulationNodeDatum,
  SimulationLinkDatum,
  Simulation,
  forceSimulation,
  forceManyBody,
  forceCenter,
  forceLink,
  forceCollide,
  forceRadial,
  zoomIdentity,
  select,
  drag,
  zoom,
} from "d3"
import { Text, Graphics, Application, Container, Circle } from "pixi.js"
import { Group as TweenGroup, Tween as Tweened } from "@tweenjs/tween.js"
import { registerEscapeHandler, removeAllChildren } from "./util"
import { FullSlug, SimpleSlug, getFullSlug, resolveRelative, simplifySlug } from "../../util/path"
import { D3Config } from "../Graph"

// 봉누도2 — Quartz v4.5.2 graph.inline.ts 수정본. 원본은 볼트의 .quartz/graph.inline.ts.
// GitHub Actions가 빌드 때 quartz/components/scripts/graph.inline.ts를 이 파일로 덮어쓴다.
// 바뀐 점:
//   - 노드 이름표를 처음부터 보이게 한다 (원래는 확대해야 보임) — 사이드바·전체 화면 모두
//   - 확대·축소해도 이름표 글자 크기는 화면에서 그대로 유지한다 (인물 그래프와 같은 방식)
//   - 사이드바 그래프는 처음부터 INITIAL_ZOOM 배율로 확대해서 시작한다 (전체 화면은 원래 배율)
const INITIAL_ZOOM = 1.5

// 봉누도2: 그래프(사이드바·전체 화면 모두)에는 정보 노드(인물·세력·장소)만 남긴다. 목록·일지·사건·서버 정보 등은 뺀다.
const INFO_PREFIXES = ["02-인물/", "03-세력/", "04-장소/"]
const INFO_EXCLUDE = ["02-인물/인물-목록", "03-세력/세력-목록"]

// 봉누도2: 분류 태그별 노드 색 (앞에 있는 태그가 우선). 태그가 없으면 기본 글자색(라이트 모드 검정)
const CATEGORY_COLORS: [string, string][] = [
  ["갱", "#e03131"],
  ["기관", "#0075de"],
  ["시민", "#1aae39"],
]
function isInfoNode(id: string) {
  return INFO_PREFIXES.some((p) => id.startsWith(p)) && !INFO_EXCLUDE.includes(id)
}

type GraphicsInfo = {
  color: string
  gfx: Graphics
  alpha: number
  active: boolean
}

type NodeData = {
  id: SimpleSlug
  text: string
  tags: string[]
} & SimulationNodeDatum

type SimpleLinkData = {
  source: SimpleSlug
  target: SimpleSlug
  // 봉누도2: 소속 선 (인물 ↔ 소속 기관)
  member?: boolean
  // 봉누도2: 사건 인연 선의 굵기 (함께 엮인 📰·🔥 사건 수)
  weight?: number
}

type LinkData = {
  source: NodeData
  target: NodeData
  member?: boolean
  weight?: number
} & SimulationLinkDatum<NodeData>

type LinkRenderData = GraphicsInfo & {
  simulationData: LinkData
}

type NodeRenderData = GraphicsInfo & {
  simulationData: NodeData
  label: Text
}

const localStorageKey = "graph-visited"
function getVisited(): Set<SimpleSlug> {
  return new Set(JSON.parse(localStorage.getItem(localStorageKey) ?? "[]"))
}

function addToVisited(slug: SimpleSlug) {
  const visited = getVisited()
  visited.add(slug)
  localStorage.setItem(localStorageKey, JSON.stringify([...visited]))
}

type TweenNode = {
  update: (time: number) => void
  stop: () => void
}

async function renderGraph(graph: HTMLElement, fullSlug: FullSlug) {
  const slug = simplifySlug(fullSlug)
  const visited = getVisited()
  removeAllChildren(graph)
  // 봉누도2: 글꼴을 다 불러온 뒤에 그려야 이름표가 대체 글꼴로 그려지지 않는다
  await document.fonts?.ready
  const isGlobal = graph.classList.contains("global-graph-container")

  let {
    drag: enableDrag,
    zoom: enableZoom,
    depth,
    scale,
    repelForce,
    centerForce,
    linkDistance,
    fontSize,
    opacityScale,
    removeTags,
    showTags,
    focusOnHover,
    enableRadial,
  } = JSON.parse(graph.dataset["cfg"]!) as D3Config

  const data: Map<SimpleSlug, ContentDetails> = new Map(
    Object.entries<ContentDetails>(await fetchData).map(([k, v]) => [
      simplifySlug(k as FullSlug),
      v,
    ]),
  )
  // 봉누도2: 별칭·짧은 이름 링크를 실제 노트 주소로 되돌린다.
  // Quartz는 파일명과 같은 별칭(aliases)이 있으면 [[표민수]] 같은 짧은 링크를 별칭 주소('표민수')로 풀어서,
  // 그래프에서 실제 노트('02-인물/테스트/표민수')와 다른 노드로 취급된다. 이름(앞 번호 제외)이 같은 노트가 하나뿐이면 그 노트로 본다.
  const baseIndex = new Map<string, SimpleSlug | null>()
  for (const id of data.keys()) {
    const base = (id.split("/").pop() ?? "").replace(/^\d+-/, "")
    if (!base) continue
    baseIndex.set(base, baseIndex.has(base) ? null : id)
  }
  const resolveLink = (dest: SimpleSlug): SimpleSlug => {
    if (data.has(dest)) return dest
    const base = (dest.split("/").pop() ?? "").replace(/^\d+-/, "")
    return baseIndex.get(base) ?? dest
  }

  const links: SimpleLinkData[] = []
  const tags: SimpleSlug[] = []
  const validLinks = new Set(data.keys())

  const tweens = new Map<string, TweenNode>()
  for (const [source, details] of data.entries()) {
    const outgoing = details.links ?? []

    for (const dest of outgoing) {
      const target = resolveLink(dest)
      if (validLinks.has(target)) {
        links.push({ source: source, target })
      }
    }

    if (showTags) {
      const localTags = details.tags
        .filter((tag) => !removeTags.includes(tag))
        .map((tag) => simplifySlug(("tags/" + tag) as FullSlug))

      tags.push(...localTags.filter((tag) => !tags.includes(tag)))

      for (const tag of localTags) {
        links.push({ source: source, target: tag })
      }
    }
  }

  // 봉누도2: 소속 선 — 인물 노트의 조직 태그와 이름이 같은 세력 노드를 잇는다 (본문 링크가 없어도).
  // 이름은 띄어쓰기·하이픈을 빼고 비교한다 (태그 판도라연구소 = 노트 판도라-연구소).
  const normalizeName = (s: string) => s.replace(/[\s-]/g, "")
  const pairKey = (a: string, b: string) => (a < b ? a + "|" + b : b + "|" + a)
  const orgByName = new Map<string, SimpleSlug>()
  for (const [id, details] of data.entries()) {
    if (id.startsWith("03-세력/") && !id.endsWith("/") && isInfoNode(id)) {
      const base = id.split("/").pop() ?? ""
      if (base) orgByName.set(normalizeName(base), id)
      if (details.title) orgByName.set(normalizeName(details.title), id)
    }
  }
  const memberPairs = new Set<string>()
  for (const [id, details] of data.entries()) {
    for (const tag of details.tags ?? []) {
      const org = orgByName.get(normalizeName(tag))
      if (org && org !== id && !memberPairs.has(pairKey(id, org))) {
        memberPairs.add(pairKey(id, org))
        links.push({ source: id, target: org, member: true })
      }
    }
  }

  const neighbourhood = new Set<SimpleSlug>()
  const wl: (SimpleSlug | "__SENTINEL")[] = [slug, "__SENTINEL"]
  if (depth >= 0) {
    while (depth >= 0 && wl.length > 0) {
      // compute neighbours
      const cur = wl.shift()!
      if (cur === "__SENTINEL") {
        depth--
        wl.push("__SENTINEL")
      } else {
        neighbourhood.add(cur)
        const outgoing = links.filter((l) => l.source === cur)
        const incoming = links.filter((l) => l.target === cur)
        wl.push(...outgoing.map((l) => l.target), ...incoming.map((l) => l.source))
      }
    }
  } else {
    validLinks.forEach((id) => neighbourhood.add(id))
    if (showTags) tags.forEach((tag) => neighbourhood.add(tag))
  }

  // 봉누도2: 사이드바 그래프와 전체 화면 전역 그래프 모두 정보 노드만
  for (const id of [...neighbourhood]) {
    if (!isInfoNode(id)) neighbourhood.delete(id)
  }

  const nodes = [...neighbourhood].map((url) => {
    // 봉누도2: 인물 이름 앞의 번호(001 등)는 떼고 이름만 보이게
    const text = url.startsWith("tags/")
      ? "#" + url.substring(5)
      : (data.get(url)?.title ?? url).replace(/^\d{3}\s+/, "")
    return {
      id: url,
      text,
      tags: data.get(url)?.tags ?? [],
    }
  })
  // 봉누도2: 그리는 선은 두 가지뿐 —
  //   소속 선(인물 ↔ 소속 기관)과 사건 인연 선(📰 사건·🔥 특종 태그가 붙은 사건 노트에 함께 링크된 두 정보 노드).
  // 본문 링크는 '어떤 노드를 보여 줄지'(위의 이웃 계산)에만 쓰고 선으로 그리지 않는다.
  // 같은 두 노드 사이에 둘 다 있으면 소속 선만 그린다.
  const EVENT_TAGS = ["사건", "특종"]
  const eventWeight = new Map<string, SimpleLinkData>()
  for (const [, details] of data.entries()) {
    if (!(details.tags ?? []).some((t) => EVENT_TAGS.includes(t))) continue
    const involved = [
      ...new Set((details.links ?? []).map(resolveLink).filter((d) => isInfoNode(d))),
    ]
    for (let i = 0; i < involved.length; i++) {
      for (let j = i + 1; j < involved.length; j++) {
        const key = pairKey(involved[i], involved[j])
        const entry = eventWeight.get(key)
        if (entry) {
          entry.weight = (entry.weight ?? 1) + 1
        } else {
          eventWeight.set(key, { source: involved[i], target: involved[j], weight: 1 })
        }
      }
    }
  }
  const drawnLinks: SimpleLinkData[] = [
    ...links.filter((l) => l.member),
    ...[...eventWeight.entries()]
      .filter(([key]) => !memberPairs.has(key))
      .map(([, l]) => l),
  ]
  const graphData: { nodes: NodeData[]; links: LinkData[] } = {
    nodes,
    links: drawnLinks
      .filter((l) => neighbourhood.has(l.source) && neighbourhood.has(l.target))
      .map((l) => ({
        source: nodes.find((n) => n.id === l.source)!,
        target: nodes.find((n) => n.id === l.target)!,
        member: l.member ?? false,
        weight: l.weight ?? 1,
      })),
  }

  const width = graph.offsetWidth
  const height = Math.max(graph.offsetHeight, 250)

  // we virtualize the simulation and use pixi to actually render it
  const simulation: Simulation<NodeData, LinkData> = forceSimulation<NodeData>(graphData.nodes)
    .force("charge", forceManyBody().strength(-100 * repelForce))
    .force("center", forceCenter().strength(centerForce))
    // 봉누도2: 사건 인연 선은 함께 엮인 사건이 많을수록 더 가깝게
    .force(
      "link",
      forceLink(graphData.links.filter((l) => !l.member)).distance(
        (l: LinkData) => linkDistance / (1 + 0.3 * ((l.weight ?? 1) - 1)),
      ),
    )
    // 봉누도2: 소속 선은 더 세게, 더 가깝게 당긴다 (기관 주위에 소속 인물이 모이게)
    .force(
      "member",
      forceLink(graphData.links.filter((l) => l.member))
        .distance(linkDistance * 0.6)
        .strength(1),
    )
    .force("collide", forceCollide<NodeData>((n) => nodeRadius(n)).iterations(3))

  const radius = (Math.min(width, height) / 2) * 0.8
  if (enableRadial) simulation.force("radial", forceRadial(radius).strength(0.2))

  // precompute style prop strings as pixi doesn't support css variables
  const cssVars = [
    "--secondary",
    "--tertiary",
    "--gray",
    "--light",
    "--lightgray",
    "--dark",
    "--darkgray",
    "--bodyFont",
  ] as const
  const computedStyleMap = cssVars.reduce(
    (acc, key) => {
      acc[key] = getComputedStyle(document.documentElement).getPropertyValue(key)
      return acc
    },
    {} as Record<(typeof cssVars)[number], string>,
  )

  // 봉누도2: 노드 색은 분류 태그 기준 (갱 빨강 · 기관 파랑 · 시민 초록 · 그 외 기본 글자색)
  // 지금 보고 있는 페이지는 색 대신 테두리로 표시한다
  const color = (d: NodeData) => {
    for (const [tag, c] of CATEGORY_COLORS) {
      if (d.tags.includes(tag)) return c
    }
    return computedStyleMap["--dark"]
  }

  function nodeRadius(d: NodeData) {
    const numLinks = graphData.links.filter(
      (l) => l.source.id === d.id || l.target.id === d.id,
    ).length
    return 2 + Math.sqrt(numLinks)
  }

  let hoveredNodeId: string | null = null
  let hoveredNeighbours: Set<string> = new Set()
  const linkRenderData: LinkRenderData[] = []
  const nodeRenderData: NodeRenderData[] = []
  function updateHoverInfo(newHoveredId: string | null) {
    hoveredNodeId = newHoveredId

    if (newHoveredId === null) {
      hoveredNeighbours = new Set()
      for (const n of nodeRenderData) {
        n.active = false
      }

      for (const l of linkRenderData) {
        l.active = false
      }
    } else {
      hoveredNeighbours = new Set()
      for (const l of linkRenderData) {
        const linkData = l.simulationData
        if (linkData.source.id === newHoveredId || linkData.target.id === newHoveredId) {
          hoveredNeighbours.add(linkData.source.id)
          hoveredNeighbours.add(linkData.target.id)
        }

        l.active = linkData.source.id === newHoveredId || linkData.target.id === newHoveredId
      }

      for (const n of nodeRenderData) {
        n.active = hoveredNeighbours.has(n.simulationData.id)
      }
    }
  }

  let dragStartTime = 0
  let dragging = false

  function renderLinks() {
    tweens.get("link")?.stop()
    const tweenGroup = new TweenGroup()

    for (const l of linkRenderData) {
      let alpha = 1

      // if we are hovering over a node, we want to highlight the immediate neighbours
      // with full alpha and the rest with default alpha
      if (hoveredNodeId) {
        alpha = l.active ? 1 : 0.2
      }

      // 봉누도2: 소속 선은 항상 진하게, 사건 인연 선은 중간 진하기(마우스를 올리면 진하게)
      l.color = l.simulationData.member
        ? computedStyleMap["--darkgray"]
        : l.active
          ? computedStyleMap["--darkgray"]
          : computedStyleMap["--gray"]
      tweenGroup.add(new Tweened<LinkRenderData>(l).to({ alpha }, 200))
    }

    tweenGroup.getAll().forEach((tw) => tw.start())
    tweens.set("link", {
      update: tweenGroup.update.bind(tweenGroup),
      stop() {
        tweenGroup.getAll().forEach((tw) => tw.stop())
      },
    })
  }

  function renderLabels() {
    tweens.get("label")?.stop()
    const tweenGroup = new TweenGroup()

    // 봉누도2: 현재 확대 배율을 나눠서, 화면에서 보이는 글자 크기를 일정하게
    const defaultScale = 1 / currentTransform.k
    const activeScale = defaultScale * 1.1
    for (const n of nodeRenderData) {
      const nodeId = n.simulationData.id

      if (hoveredNodeId === nodeId) {
        tweenGroup.add(
          new Tweened<Text>(n.label).to(
            {
              alpha: 1,
              scale: { x: activeScale, y: activeScale },
            },
            100,
          ),
        )
      } else {
        tweenGroup.add(
          new Tweened<Text>(n.label).to(
            {
              alpha: n.label.alpha,
              scale: { x: defaultScale, y: defaultScale },
            },
            100,
          ),
        )
      }
    }

    tweenGroup.getAll().forEach((tw) => tw.start())
    tweens.set("label", {
      update: tweenGroup.update.bind(tweenGroup),
      stop() {
        tweenGroup.getAll().forEach((tw) => tw.stop())
      },
    })
  }

  function renderNodes() {
    tweens.get("hover")?.stop()

    const tweenGroup = new TweenGroup()
    for (const n of nodeRenderData) {
      let alpha = 1

      // if we are hovering over a node, we want to highlight the immediate neighbours
      if (hoveredNodeId !== null && focusOnHover) {
        alpha = n.active ? 1 : 0.2
      }

      tweenGroup.add(new Tweened<Graphics>(n.gfx, tweenGroup).to({ alpha }, 200))
    }

    tweenGroup.getAll().forEach((tw) => tw.start())
    tweens.set("hover", {
      update: tweenGroup.update.bind(tweenGroup),
      stop() {
        tweenGroup.getAll().forEach((tw) => tw.stop())
      },
    })
  }

  function renderPixiFromD3() {
    renderNodes()
    renderLinks()
    renderLabels()
  }

  tweens.forEach((tween) => tween.stop())
  tweens.clear()

  const app = new Application()
  await app.init({
    width,
    height,
    antialias: true,
    autoStart: false,
    autoDensity: true,
    backgroundAlpha: 0,
    preference: "webgpu",
    resolution: window.devicePixelRatio,
    eventMode: "static",
  })
  graph.appendChild(app.canvas)

  const stage = app.stage
  stage.interactive = false

  const labelsContainer = new Container<Text>({ zIndex: 3, isRenderGroup: true })
  const nodesContainer = new Container<Graphics>({ zIndex: 2, isRenderGroup: true })
  const linkContainer = new Container<Graphics>({ zIndex: 1, isRenderGroup: true })
  stage.addChild(nodesContainer, labelsContainer, linkContainer)

  for (const n of graphData.nodes) {
    const nodeId = n.id

    const label = new Text({
      interactive: false,
      eventMode: "none",
      text: n.text,
      // 봉누도2: 이름표를 처음부터 보이게 (사이드바·전체 화면 모두)
      alpha: 1,
      anchor: { x: 0.5, y: 1.2 },
      style: {
        // 봉누도2: 화면에 보일 크기 그대로 그린다 (축소하며 흐려지지 않게)
        fontSize: (fontSize * 15) / scale,
        fill: computedStyleMap["--dark"],
        fontFamily: computedStyleMap["--bodyFont"],
        // 봉누도2: 배경색 테두리로 선·점 위에서도 글자가 묻히지 않게
        fontWeight: "600",
        stroke: { color: computedStyleMap["--light"], width: 3, join: "round" },
      },
      resolution: window.devicePixelRatio,
    })
    label.scale.set(1)

    let oldLabelOpacity = 1
    const isTagNode = nodeId.startsWith("tags/")
    const gfx = new Graphics({
      interactive: true,
      label: nodeId,
      eventMode: "static",
      hitArea: new Circle(0, 0, nodeRadius(n)),
      cursor: "pointer",
    })
      .circle(0, 0, nodeRadius(n))
      .fill({ color: isTagNode ? computedStyleMap["--light"] : color(n) })
      .on("pointerover", (e) => {
        updateHoverInfo(e.target.label)
        oldLabelOpacity = label.alpha
        if (!dragging) {
          renderPixiFromD3()
        }
      })
      .on("pointerleave", () => {
        updateHoverInfo(null)
        label.alpha = oldLabelOpacity
        if (!dragging) {
          renderPixiFromD3()
        }
      })

    if (isTagNode) {
      gfx.stroke({ width: 2, color: computedStyleMap["--tertiary"] })
    }

    // 봉누도2: 지금 보고 있는 페이지는 테두리로 표시
    if (nodeId === slug) {
      gfx.stroke({ width: 2, color: computedStyleMap["--secondary"] })
    }

    nodesContainer.addChild(gfx)
    labelsContainer.addChild(label)

    const nodeRenderDatum: NodeRenderData = {
      simulationData: n,
      gfx,
      label,
      color: color(n),
      alpha: 1,
      active: false,
    }

    nodeRenderData.push(nodeRenderDatum)
  }

  for (const l of graphData.links) {
    const gfx = new Graphics({ interactive: false, eventMode: "none" })
    linkContainer.addChild(gfx)

    const linkRenderDatum: LinkRenderData = {
      simulationData: l,
      gfx,
      color: l.member ? computedStyleMap["--darkgray"] : computedStyleMap["--gray"],
      alpha: 1,
      active: false,
    }

    linkRenderData.push(linkRenderDatum)
  }

  let currentTransform = zoomIdentity
  if (enableDrag) {
    select<HTMLCanvasElement, NodeData | undefined>(app.canvas).call(
      drag<HTMLCanvasElement, NodeData | undefined>()
        .container(() => app.canvas)
        .subject(() => graphData.nodes.find((n) => n.id === hoveredNodeId))
        .on("start", function dragstarted(event) {
          if (!event.active) simulation.alphaTarget(1).restart()
          event.subject.fx = event.subject.x
          event.subject.fy = event.subject.y
          event.subject.__initialDragPos = {
            x: event.subject.x,
            y: event.subject.y,
            fx: event.subject.fx,
            fy: event.subject.fy,
          }
          dragStartTime = Date.now()
          dragging = true
        })
        .on("drag", function dragged(event) {
          const initPos = event.subject.__initialDragPos
          event.subject.fx = initPos.x + (event.x - initPos.x) / currentTransform.k
          event.subject.fy = initPos.y + (event.y - initPos.y) / currentTransform.k
        })
        .on("end", function dragended(event) {
          if (!event.active) simulation.alphaTarget(0)
          event.subject.fx = null
          event.subject.fy = null
          dragging = false

          // if the time between mousedown and mouseup is short, we consider it a click
          if (Date.now() - dragStartTime < 500) {
            const node = graphData.nodes.find((n) => n.id === event.subject.id) as NodeData
            const targ = resolveRelative(fullSlug, node.id)
            window.spaNavigate(new URL(targ, window.location.toString()))
          }
        }),
    )
  } else {
    for (const node of nodeRenderData) {
      node.gfx.on("click", () => {
        const targ = resolveRelative(fullSlug, node.simulationData.id)
        window.spaNavigate(new URL(targ, window.location.toString()))
      })
    }
  }

  if (enableZoom) {
    const zoomBehavior = zoom<HTMLCanvasElement, NodeData>()
      .extent([
        [0, 0],
        [width, height],
      ])
      .scaleExtent([0.25, 4])
      .on("zoom", ({ transform }) => {
        currentTransform = transform
        stage.scale.set(transform.k, transform.k)
        stage.position.set(transform.x, transform.y)
        // 봉누도2: 이름표를 항상 보이게 하므로 확대에 따른 이름표 투명도 조절은 하지 않는다.
        // 대신 확대·축소해도 이름표 글자 크기는 화면에서 그대로 유지한다.
        for (const n of nodeRenderData) {
          n.label.scale.set(1 / transform.k)
        }
      })

    const canvasSelection = select<HTMLCanvasElement, NodeData>(app.canvas)
    canvasSelection.call(zoomBehavior)

    // 봉누도2: 로컬 그래프는 가운데를 기준으로 확대한 채 시작
    if (!isGlobal && INITIAL_ZOOM !== 1) {
      const k = INITIAL_ZOOM
      canvasSelection.call(
        zoomBehavior.transform,
        zoomIdentity.translate((width / 2) * (1 - k), (height / 2) * (1 - k)).scale(k),
      )
    }
  }

  let stopAnimation = false
  function animate(time: number) {
    if (stopAnimation) return
    for (const n of nodeRenderData) {
      const { x, y } = n.simulationData
      if (!x || !y) continue
      n.gfx.position.set(x + width / 2, y + height / 2)
      if (n.label) {
        n.label.position.set(x + width / 2, y + height / 2)
      }
    }

    for (const l of linkRenderData) {
      const linkData = l.simulationData
      l.gfx.clear()
      const x1 = linkData.source.x! + width / 2
      const y1 = linkData.source.y! + height / 2
      const x2 = linkData.target.x! + width / 2
      const y2 = linkData.target.y! + height / 2

      if (linkData.member) {
        // 봉누도2: 소속 선은 점선 (Pixi에 점선 기능이 없어 짧은 선분으로 나눠 그린다).
        // 선분·빈칸 길이는 확대 배율로 나눠 화면에서 일정하게 보이게 한다.
        const k = currentTransform.k
        const dash = 5 / k
        const gap = 4 / k
        const dx = x2 - x1
        const dy = y2 - y1
        const len = Math.hypot(dx, dy)
        if (len > 0) {
          const ux = dx / len
          const uy = dy / len
          for (let d = 0; d < len; d += dash + gap) {
            const e = Math.min(d + dash, len)
            l.gfx.moveTo(x1 + ux * d, y1 + uy * d).lineTo(x1 + ux * e, y1 + uy * e)
          }
          l.gfx.stroke({ alpha: l.alpha, width: 1.5, color: l.color })
        }
      } else {
        // 봉누도2: 사건 인연 선은 실선, 함께 엮인 사건 수에 따라 1.8px ~ 최대 4px
        l.gfx
          .moveTo(x1, y1)
          .lineTo(x2, y2)
          .stroke({
            alpha: l.alpha,
            width: Math.min(1 + 0.8 * (linkData.weight ?? 1), 4),
            color: l.color,
          })
      }
    }

    tweens.forEach((t) => t.update(time))
    app.renderer.render(stage)
    requestAnimationFrame(animate)
  }

  requestAnimationFrame(animate)
  return () => {
    stopAnimation = true
    app.destroy()
  }
}

let localGraphCleanups: (() => void)[] = []
let globalGraphCleanups: (() => void)[] = []

function cleanupLocalGraphs() {
  for (const cleanup of localGraphCleanups) {
    cleanup()
  }
  localGraphCleanups = []
}

function cleanupGlobalGraphs() {
  for (const cleanup of globalGraphCleanups) {
    cleanup()
  }
  globalGraphCleanups = []
}

document.addEventListener("nav", async (e: CustomEventMap["nav"]) => {
  const slug = e.detail.url
  addToVisited(simplifySlug(slug))

  async function renderLocalGraph() {
    cleanupLocalGraphs()
    const localGraphContainers = document.getElementsByClassName("graph-container")
    for (const container of localGraphContainers) {
      localGraphCleanups.push(await renderGraph(container as HTMLElement, slug))
    }
  }

  await renderLocalGraph()
  const handleThemeChange = () => {
    void renderLocalGraph()
  }

  document.addEventListener("themechange", handleThemeChange)
  window.addCleanup(() => {
    document.removeEventListener("themechange", handleThemeChange)
  })

  const containers = [...document.getElementsByClassName("global-graph-outer")] as HTMLElement[]
  async function renderGlobalGraph() {
    const slug = getFullSlug(window)
    for (const container of containers) {
      container.classList.add("active")
      const sidebar = container.closest(".sidebar") as HTMLElement
      if (sidebar) {
        sidebar.style.zIndex = "1"
      }

      const graphContainer = container.querySelector(".global-graph-container") as HTMLElement
      registerEscapeHandler(container, hideGlobalGraph)
      if (graphContainer) {
        globalGraphCleanups.push(await renderGraph(graphContainer, slug))
      }
    }
  }

  function hideGlobalGraph() {
    cleanupGlobalGraphs()
    for (const container of containers) {
      container.classList.remove("active")
      const sidebar = container.closest(".sidebar") as HTMLElement
      if (sidebar) {
        sidebar.style.zIndex = ""
      }
    }
  }

  async function shortcutHandler(e: HTMLElementEventMap["keydown"]) {
    if (e.key === "g" && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
      e.preventDefault()
      const anyGlobalGraphOpen = containers.some((container) =>
        container.classList.contains("active"),
      )
      anyGlobalGraphOpen ? hideGlobalGraph() : renderGlobalGraph()
    }
  }

  const containerIcons = document.getElementsByClassName("global-graph-icon")
  Array.from(containerIcons).forEach((icon) => {
    icon.addEventListener("click", renderGlobalGraph)
    window.addCleanup(() => icon.removeEventListener("click", renderGlobalGraph))
  })

  document.addEventListener("keydown", shortcutHandler)
  window.addCleanup(() => {
    document.removeEventListener("keydown", shortcutHandler)
    cleanupLocalGraphs()
    cleanupGlobalGraphs()
  })
})
