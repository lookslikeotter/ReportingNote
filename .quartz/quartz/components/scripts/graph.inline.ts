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
import {
  ContentData,
  HOVER_EXTRA_WIDTH,
  categoryColor,
  eventLinkColor,
  eventLinkWidth,
  tableEventPairs,
  factionIndex,
  isInfoNode,
  isPersonNode,
  linkResolver,
  loadContentIndex,
  nearestLink,
  nodeLabel,
  normalizeName,
  pairKey,
  showLinkPopup,
} from "./bongnudo"

// 봉누도2 — Quartz v4.5.2 graph.inline.ts 수정본 (오른쪽 아래 그래프와 전체 그래프).
// 원본은 볼트의 .quartz/quartz/components/scripts/graph.inline.ts. 빌드 때 Quartz의 같은 파일을 덮어쓴다.
// 인물 그래프와 함께 쓰는 규칙은 bongnudo.ts. 원래 Quartz 그래프와 다른 점:
//   - 노드는 인물·세력·장소만. 색은 분류 태그, 지금 페이지는 테두리
//   - 이름표는 처음부터 보이고, 확대·축소해도 화면에서 글자 크기가 그대로다
//   - 선은 세 가지뿐: 소속 점선(인물 ↔ 소속 세력), 세력 관계 선(관계 태그), 사건 인연 선(일지 표 📰·🔥 행 관련 인물 칸에 함께 적힌 인물끼리).
//     본문 링크는 어떤 노드를 보여 줄지(이웃 계산)에만 쓰고 선으로 그리지 않는다
//   - 선에 마우스를 올리면 하이라이트, 누르면 창 (사건 표 · 소속 · 세력 관계)
//   - 사이드바 그래프는 INITIAL_ZOOM 배율로 확대해서 시작한다 (전체 그래프는 원래 배율)

const INITIAL_ZOOM = 1.5

// 세력 관계 선 모양. 세력 노트의 관계 태그(예: 경쟁/병원)로 세력끼리 잇는다.
// distance는 기본 선 길이에 곱하는 값 (동맹은 가깝게, 적대는 멀리 배치)
const RELATION_STYLES: Record<string, { color: string; width: number; distance: number }> = {
  동맹: { color: "#1aae39", width: 2.5, distance: 0.8 },
  협력: { color: "#0075de", width: 2, distance: 1.2 },
  경쟁: { color: "#dd5b00", width: 2, distance: 1.8 },
  적대: { color: "#e03131", width: 3, distance: 2.6 },
}
const RELATION_TAG = /^(동맹|협력|경쟁|적대)\/(.+)$/

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

// 선 종류: member(소속 점선) · relation(세력 관계) · 둘 다 아니면 사건 인연(weight·events)
type SimpleLinkData = {
  source: SimpleSlug
  target: SimpleSlug
  member?: boolean
  relation?: string
  weight?: number
  events?: SimpleSlug[]
}

type LinkData = {
  source: NodeData
  target: NodeData
  member?: boolean
  relation?: string
  weight?: number
  events?: SimpleSlug[]
} & SimulationLinkDatum<NodeData>

type LinkRenderData = GraphicsInfo & {
  simulationData: LinkData
}

type NodeRenderData = GraphicsInfo & {
  simulationData: NodeData
  label: Text
}

type TweenNode = {
  update: (time: number) => void
  stop: () => void
}

async function renderGraph(graph: HTMLElement, fullSlug: FullSlug) {
  const slug = simplifySlug(fullSlug)
  removeAllChildren(graph)
  // 글꼴을 다 불러온 뒤에 그려야 이름표가 대체 글꼴로 그려지지 않는다
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
    focusOnHover,
    enableRadial,
  } = JSON.parse(graph.dataset["cfg"]!) as D3Config

  const data: ContentData = new Map(
    Object.entries<ContentDetails>(await loadContentIndex()).map(([k, v]) => [
      simplifySlug(k as FullSlug),
      v,
    ]),
  )
  const resolveLink = linkResolver(data)

  // 본문 링크 (이웃 계산용)
  const links: SimpleLinkData[] = []
  for (const [source, details] of data.entries()) {
    for (const dest of details.links ?? []) {
      const target = resolveLink(dest)
      if (data.has(target)) links.push({ source, target })
    }
  }

  // 소속 선: 인물 노트의 조직 태그와 이름이 같은 세력 노드를 잇는다 (본문 링크가 없어도)
  const factions = factionIndex(data)
  const memberPairs = new Set<string>()
  for (const [id, details] of data.entries()) {
    for (const tag of details.tags ?? []) {
      const org = factions.get(normalizeName(tag))
      if (!org || org === id || memberPairs.has(pairKey(id, org))) continue
      memberPairs.add(pairKey(id, org))
      links.push({ source: id, target: org, member: true })
    }
  }

  // 세력 관계 선: 세력 노트의 관계 태그(동맹/·협력/·경쟁/·적대/ + 상대 세력 이름)로 잇는다.
  // 관계 태그가 없으면 세력끼리는 선을 긋지 않는다. 양쪽에 모두 적혀 있으면 한 번만 긋는다.
  const relationPairs = new Map<string, SimpleLinkData>()
  for (const [id, details] of data.entries()) {
    if (!id.startsWith("03-세력/")) continue
    for (const tag of details.tags ?? []) {
      const m = tag.match(RELATION_TAG)
      if (!m) continue
      const other = factions.get(normalizeName(m[2]))
      if (!other || other === id) continue
      const key = pairKey(id, other)
      if (relationPairs.has(key)) continue
      const link = { source: id, target: other, relation: m[1] }
      relationPairs.set(key, link)
      // 세력 페이지에서 관계 세력도 이웃으로 보이게
      links.push(link)
    }
  }

  // 사건 인연 선: 일지 표 📰·🔥 행의 관련 인물 칸에 함께 적힌 인물끼리.
  // 이웃 계산에도 넣어서, 사건으로 엮인 인물이 그 인물 페이지 그래프에 보이게 한다
  const eventLinks = await tableEventPairs(fullSlug, data, resolveLink, isPersonNode)
  for (const l of eventLinks.values()) links.push({ source: l.source, target: l.target })

  const neighbourhood = new Set<SimpleSlug>()
  if (depth >= 0) {
    const wl: (SimpleSlug | "__SENTINEL")[] = [slug, "__SENTINEL"]
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
    for (const id of data.keys()) neighbourhood.add(id)
  }

  // 정보 노드(인물·세력·장소)만 남긴다
  for (const id of [...neighbourhood]) {
    if (!isInfoNode(id)) neighbourhood.delete(id)
  }

  const nodes: NodeData[] = [...neighbourhood].map((id) => ({
    id,
    text: nodeLabel(data.get(id)?.title ?? id),
    tags: data.get(id)?.tags ?? [],
  }))
  const nodeById = new Map(nodes.map((n) => [n.id, n]))

  const drawnLinks: SimpleLinkData[] = [
    ...links.filter((l) => l.member),
    ...relationPairs.values(),
    ...eventLinks.values(),
  ]
  const graphData: { nodes: NodeData[]; links: LinkData[] } = {
    nodes,
    links: drawnLinks
      .filter((l) => nodeById.has(l.source) && nodeById.has(l.target))
      .map((l) => ({ ...l, source: nodeById.get(l.source)!, target: nodeById.get(l.target)! })),
  }

  const width = graph.offsetWidth
  const height = Math.max(graph.offsetHeight, 250)

  // we virtualize the simulation and use pixi to actually render it
  const simulation: Simulation<NodeData, LinkData> = forceSimulation<NodeData>(graphData.nodes)
    .force("charge", forceManyBody().strength(-100 * repelForce))
    .force("center", forceCenter().strength(centerForce))
    // 사건 인연 선: 함께 엮인 사건이 많을수록 더 가깝게
    .force(
      "link",
      forceLink(graphData.links.filter((l) => !l.member && !l.relation)).distance(
        (l: LinkData) => linkDistance / (1 + 0.3 * ((l.weight ?? 1) - 1)),
      ),
    )
    // 세력 관계: 관계 종류에 따라 거리를 둔다 (동맹 가깝게 … 적대 멀리)
    .force(
      "relation",
      forceLink(graphData.links.filter((l) => l.relation))
        .distance((l: LinkData) => linkDistance * (RELATION_STYLES[l.relation!]?.distance ?? 1))
        .strength(0.7),
    )
    // 소속: 더 세게, 더 가깝게 당긴다 (세력 주위에 소속 인물이 모이게)
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

  const color = (d: NodeData) => categoryColor(d.tags, computedStyleMap["--dark"])

  function nodeRadius(d: NodeData) {
    const numLinks = graphData.links.filter(
      (l) => l.source.id === d.id || l.target.id === d.id,
    ).length
    return 2 + Math.sqrt(numLinks)
  }

  let hoveredNodeId: string | null = null
  // 마우스가 올라가 있는 선 (노드 위에서는 노드가 우선)
  let hoveredLink: LinkRenderData | null = null
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

  // 선 색: 세력 관계는 관계별 색, 하이라이트된 선은 가장 진하게, 소속 점선은 진하게,
  // 사건 인연 선은 사건 수에 따라 (굵기가 최대가 된 뒤부터 조금씩 진해짐)
  function linkColor(l: LinkRenderData): string {
    const { relation, member, weight } = l.simulationData
    if (relation) return RELATION_STYLES[relation]?.color ?? computedStyleMap["--gray"]
    if (l.active || l === hoveredLink) return computedStyleMap["--dark"]
    if (member) return computedStyleMap["--darkgray"]
    return eventLinkColor(weight ?? 1, computedStyleMap["--gray"], computedStyleMap["--dark"])
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
      } else if (hoveredLink) {
        alpha = l === hoveredLink ? 1 : 0.2
      }

      l.color = linkColor(l)
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

    // 현재 확대 배율을 나눠서, 화면에서 보이는 글자 크기를 일정하게
    const defaultScale = 1 / currentTransform.k
    const activeScale = defaultScale * 1.1
    for (const n of nodeRenderData) {
      const s = hoveredNodeId === n.simulationData.id ? activeScale : defaultScale
      tweenGroup.add(new Tweened<Text>(n.label).to({ scale: { x: s, y: s } }, 100))
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
      } else if (hoveredNodeId === null && hoveredLink) {
        // 선에 마우스를 올리면 양 끝 두 노드만 또렷하게
        const { source, target } = hoveredLink.simulationData
        const id = n.simulationData.id
        alpha = id === source.id || id === target.id ? 1 : 0.2
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

  const tweens = new Map<string, TweenNode>()

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
      alpha: 1,
      anchor: { x: 0.5, y: 1.2 },
      style: {
        // 화면에 보일 크기 그대로 그린다 (확대 배율은 scale로 되돌린다)
        fontSize: (fontSize * 15) / scale,
        fill: computedStyleMap["--dark"],
        fontFamily: computedStyleMap["--bodyFont"],
        // 배경색 테두리로 선·점 위에서도 글자가 묻히지 않게
        fontWeight: "600",
        stroke: { color: computedStyleMap["--light"], width: 3, join: "round" },
      },
      resolution: window.devicePixelRatio,
    })
    label.scale.set(1)

    const gfx = new Graphics({
      interactive: true,
      label: nodeId,
      eventMode: "static",
      hitArea: new Circle(0, 0, nodeRadius(n)),
      cursor: "pointer",
    })
      .circle(0, 0, nodeRadius(n))
      .fill({ color: color(n) })
      .on("pointerover", (e) => {
        updateHoverInfo(e.target.label)
        if (!dragging) renderPixiFromD3()
      })
      .on("pointerleave", () => {
        updateHoverInfo(null)
        if (!dragging) renderPixiFromD3()
      })

    // 지금 보고 있는 페이지는 테두리로 표시
    if (nodeId === slug) {
      gfx.stroke({ width: 2, color: computedStyleMap["--secondary"] })
    }

    nodesContainer.addChild(gfx)
    labelsContainer.addChild(label)

    nodeRenderData.push({
      simulationData: n,
      gfx,
      label,
      color: color(n),
      alpha: 1,
      active: false,
    })
  }

  for (const l of graphData.links) {
    const gfx = new Graphics({ interactive: false, eventMode: "none" })
    linkContainer.addChild(gfx)
    const linkRenderDatum: LinkRenderData = {
      simulationData: l,
      gfx,
      color: "",
      alpha: 1,
      active: false,
    }
    linkRenderDatum.color = linkColor(linkRenderDatum)
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
        // 이름표는 항상 보이고, 확대·축소해도 화면에서 글자 크기가 그대로
        for (const n of nodeRenderData) {
          n.label.scale.set(1 / transform.k)
        }
      })

    const canvasSelection = select<HTMLCanvasElement, NodeData>(app.canvas)
    canvasSelection.call(zoomBehavior)

    // 사이드바 그래프는 가운데를 기준으로 확대한 채 시작
    if (!isGlobal && INITIAL_ZOOM !== 1) {
      const k = INITIAL_ZOOM
      canvasSelection.call(
        zoomBehavior.transform,
        zoomIdentity.translate((width / 2) * (1 - k), (height / 2) * (1 - k)).scale(k),
      )
    }
  }

  // 선 위에 마우스를 올리면 하이라이트, 누르면 창
  function setHoveredLink(l: LinkRenderData | null) {
    if (l === hoveredLink) return
    hoveredLink = l
    app.canvas.style.cursor = l ? "pointer" : ""
    renderPixiFromD3()
  }

  // 어떤 선이든 양 끝이 함께 엮인 사건·이벤트 표 (일지 표 관련 인물 칸 기준).
  // 소속 선은 조직이 주체인 사건도 넣는다: 일지 표에 조직만 적혀 있어도,
  // 그 사건 노트의 `가담인물`에 이 조직원이 있으면 가담한 것이다.
  function openLinkPopup(ld: LinkData) {
    const { source: a, target: b } = ld
    const person = isPersonNode(a.id) ? a.id : b.id
    void showLinkPopup({
      title: `${a.text} ─ ${b.text}`,
      kind: ld.member ? "소속" : ld.relation ? `세력 관계 · ${ld.relation}` : undefined,
      currentSlug: fullSlug,
      data,
      resolveLink,
      a: a.id,
      b: b.id,
      knownEvents: ld.events,
      member: ld.member
        ? { person, faction: person === a.id ? b.id : a.id }
        : undefined,
    })
  }

  app.canvas.addEventListener("pointermove", (e) => {
    const over =
      dragging || hoveredNodeId !== null
        ? null
        : nearestLink(linkRenderData, e.offsetX, e.offsetY, currentTransform, width, height)
    setHoveredLink(over)
  })
  app.canvas.addEventListener("pointerleave", () => setHoveredLink(null))
  app.canvas.addEventListener("click", () => {
    if (hoveredNodeId === null && hoveredLink) openLinkPopup(hoveredLink.simulationData)
  })

  let stopAnimation = false
  function animate(time: number) {
    if (stopAnimation) return
    for (const n of nodeRenderData) {
      const { x, y } = n.simulationData
      if (!x || !y) continue
      n.gfx.position.set(x + width / 2, y + height / 2)
      n.label.position.set(x + width / 2, y + height / 2)
    }

    for (const l of linkRenderData) {
      const linkData = l.simulationData
      const extra = l === hoveredLink ? HOVER_EXTRA_WIDTH : 0
      l.gfx.clear()
      const x1 = linkData.source.x! + width / 2
      const y1 = linkData.source.y! + height / 2
      const x2 = linkData.target.x! + width / 2
      const y2 = linkData.target.y! + height / 2

      if (linkData.member) {
        // 소속 선은 점선 (Pixi에 점선 기능이 없어 짧은 선분으로 나눠 그린다).
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
          l.gfx.stroke({ alpha: l.alpha, width: 1.5 + extra, color: l.color })
        }
      } else {
        // 세력 관계 선은 관계별 굵기, 사건 인연 선은 함께 엮인 사건 수에 따라 굵게
        const base = linkData.relation
          ? (RELATION_STYLES[linkData.relation]?.width ?? 2)
          : eventLinkWidth(linkData.weight ?? 1)
        l.gfx
          .moveTo(x1, y1)
          .lineTo(x2, y2)
          .stroke({ alpha: l.alpha, width: base + extra, color: l.color })
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
