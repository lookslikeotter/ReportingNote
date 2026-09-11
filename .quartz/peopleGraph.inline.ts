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
import { FullSlug, SimpleSlug, resolveRelative, simplifySlug } from "../../util/path"
import { D3Config } from "../Graph"

// 봉누도2 — 인물 그래프 스크립트. 원본은 볼트의 .quartz/peopleGraph.inline.ts.
// Quartz v4.5.2 graph.inline.ts를 바탕으로, PERSON_TAG 태그가 붙은 노트만 노드로 그린다.
// 선은 인물 노트끼리 서로 링크한 경우에만 생긴다. 이름표는 처음부터 보이고, 앞의 번호(001 등)는 뗀다.
const PERSON_TAG = "인물"
// 분류 태그별 노드 색 (graph.inline.ts 수정본과 같은 값, 앞에 있는 태그가 우선)
const CATEGORY_COLORS: [string, string][] = [
  ["갱", "#e03131"],
  ["기관", "#0075de"],
  ["시민", "#1aae39"],
]
// 처음에는 모든 인물이 한 화면에 들어오도록 배율을 자동으로 맞추고,
// 확대·축소해도 이름표 글자 크기는 화면에서 그대로 유지한다.

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
  // 사건 인연: 두 사람이 함께 엮인 📰 사건·🔥 특종의 수
  weight: number
}

type LinkData = {
  source: NodeData
  target: NodeData
  weight: number
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

type TweenNode = {
  update: (time: number) => void
  stop: () => void
}

async function renderGraph(graph: HTMLElement, fullSlug: FullSlug) {
  const slug = simplifySlug(fullSlug)
  // 페이지를 옮겨도 그래프를 다시 그리지 않으므로, 노드 클릭 링크는 지금 페이지 기준으로 계산한다
  let currentFullSlug = fullSlug
  const visited = getVisited()
  removeAllChildren(graph)
  // 글꼴을 다 불러온 뒤에 그려야 이름표가 대체 글꼴로 그려지지 않는다
  await document.fonts?.ready

  let {
    drag: enableDrag,
    zoom: enableZoom,
    scale,
    repelForce,
    centerForce,
    linkDistance,
    fontSize,
    focusOnHover,
    enableRadial,
  } = JSON.parse(graph.dataset["cfg"]!) as D3Config

  const data: Map<SimpleSlug, ContentDetails> = new Map(
    Object.entries<ContentDetails>(await fetchData).map(([k, v]) => [
      simplifySlug(k as FullSlug),
      v,
    ]),
  )

  // 별칭·짧은 이름 링크를 실제 노트 주소로 되돌린다 (graph.inline.ts 수정본과 같은 방식).
  // Quartz는 파일명과 같은 별칭이 있으면 [[표민수]]를 별칭 주소('표민수')로 풀어서 실제 인물 노드와 어긋난다.
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

  // 인물 태그가 붙은 노트만 고른다
  const people = new Set<SimpleSlug>()
  for (const [id, details] of data.entries()) {
    if ((details.tags ?? []).includes(PERSON_TAG)) {
      people.add(id)
    }
  }

  // 선은 '사건 인연'만: 사건 노트 중 📰 사건·🔥 특종 태그가 붙은 노트에 함께 링크된 두 인물을 잇는다.
  // 함께 엮인 사건이 많을수록 weight가 커져 선이 굵어진다.
  // 인물 노트끼리의 링크, ☕ 일상 사건(태그 없음)은 선을 만들지 않는다.
  const EVENT_TAGS = ["사건", "특종"]
  const pairKey = (a: string, b: string) => (a < b ? a + "|" + b : b + "|" + a)
  const pairWeight = new Map<string, SimpleLinkData>()
  for (const [, details] of data.entries()) {
    if (!(details.tags ?? []).some((t) => EVENT_TAGS.includes(t))) continue
    const involved = [
      ...new Set((details.links ?? []).map(resolveLink).filter((d) => people.has(d))),
    ]
    for (let i = 0; i < involved.length; i++) {
      for (let j = i + 1; j < involved.length; j++) {
        const key = pairKey(involved[i], involved[j])
        const entry = pairWeight.get(key)
        if (entry) {
          entry.weight++
        } else {
          pairWeight.set(key, { source: involved[i], target: involved[j], weight: 1 })
        }
      }
    }
  }
  const links: SimpleLinkData[] = [...pairWeight.values()]

  // 같은 소속끼리는 선을 그리지 않고, 보이지 않는 힘으로 가까이 모은다.
  // 조직 태그 = 세력 노트 이름과 같은 태그 (띄어쓰기·하이픈을 빼고 비교: 판도라연구소 = 판도라-연구소)
  const normalizeName = (s: string) => s.replace(/[\s-]/g, "")
  const orgNames = new Set<string>()
  for (const [id, details] of data.entries()) {
    if (id.startsWith("03-세력/") && !id.endsWith("/") && !id.endsWith("세력-목록")) {
      const base = id.split("/").pop() ?? ""
      if (base) orgNames.add(normalizeName(base))
      if (details.title) orgNames.add(normalizeName(details.title))
    }
  }
  const orgOf = new Map<SimpleSlug, string>()
  for (const id of people) {
    const org = (data.get(id)?.tags ?? []).map(normalizeName).find((t) => t && orgNames.has(t))
    if (org) orgOf.set(id, org)
  }

  const tweens = new Map<string, TweenNode>()

  const nodes = [...people].map((url) => {
    const title = data.get(url)?.title ?? url
    return {
      id: url,
      text: title.replace(/^\d{3}\s+/, ""),
      tags: data.get(url)?.tags ?? [],
    }
  })
  const graphData: { nodes: NodeData[]; links: LinkData[] } = {
    nodes,
    links: links.map((l) => ({
      source: nodes.find((n) => n.id === l.source)!,
      target: nodes.find((n) => n.id === l.target)!,
      weight: l.weight,
    })),
  }

  // 같은 소속끼리 모으는 힘: 소속별 무게중심 쪽으로 조금씩 당긴다 (선은 그리지 않음)
  const CLUSTER_STRENGTH = 0.15
  const clusterForce = (alpha: number) => {
    const sums = new Map<string, { x: number; y: number; n: number }>()
    for (const n of graphData.nodes) {
      const org = orgOf.get(n.id)
      if (!org) continue
      const s = sums.get(org) ?? { x: 0, y: 0, n: 0 }
      s.x += n.x ?? 0
      s.y += n.y ?? 0
      s.n++
      sums.set(org, s)
    }
    for (const n of graphData.nodes) {
      const org = orgOf.get(n.id)
      if (!org) continue
      const s = sums.get(org)!
      if (s.n < 2) continue
      n.vx = (n.vx ?? 0) + (s.x / s.n - (n.x ?? 0)) * CLUSTER_STRENGTH * alpha
      n.vy = (n.vy ?? 0) + (s.y / s.n - (n.y ?? 0)) * CLUSTER_STRENGTH * alpha
    }
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
      forceLink(graphData.links).distance(
        (l: LinkData) => linkDistance / (1 + 0.3 * (l.weight - 1)),
      ),
    )
    .force("cluster", clusterForce)
    .force("collide", forceCollide<NodeData>((n) => nodeRadius(n)).iterations(3))

  const radius = (Math.min(width, height) / 2) * 0.8
  if (enableRadial) simulation.force("radial", forceRadial(radius).strength(0.2))

  // 배치를 미리 계산해 두고 시작한다 (한 화면에 맞추려면 최종 위치가 필요)
  simulation.stop()
  for (let i = 0; i < 300; i++) simulation.tick()

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

  // 노드 색은 분류 태그 기준 (갱 빨강 · 기관 파랑 · 시민 초록 · 그 외 기본 글자색)
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
    return 4 + Math.sqrt(numLinks)
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

      if (hoveredNodeId) {
        alpha = l.active ? 1 : 0.2
      }

      // 사건 인연 선은 의미 있는 선만 남으므로 기본보다 진하게, 마우스를 올리면 더 진하게
      l.color = l.active ? computedStyleMap["--darkgray"] : computedStyleMap["--gray"]
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

    // 이름표는 처음부터 보이게 (기본 그래프는 확대해야 보임)
    const label = new Text({
      interactive: false,
      eventMode: "none",
      text: n.text,
      alpha: 1,
      anchor: { x: 0.5, y: 1.2 },
      style: {
        // 화면에 보일 크기 그대로 그린다 (축소하며 흐려지지 않게)
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

    let oldLabelOpacity = 1
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

    // 지금 보고 있는 페이지는 테두리로 표시
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
      color: computedStyleMap["--gray"],
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
            const targ = resolveRelative(currentFullSlug, node.id)
            window.spaNavigate(new URL(targ, window.location.toString()))
          }
        }),
    )
  } else {
    for (const node of nodeRenderData) {
      node.gfx.on("click", () => {
        const targ = resolveRelative(currentFullSlug, node.simulationData.id)
        window.spaNavigate(new URL(targ, window.location.toString()))
      })
    }
  }

  // 인물 페이지에 들어가면 그 인물이 가운데 오도록 화면을 옮긴다 (배율은 그대로)
  let panToNode: ((id: string, zoomIn?: boolean) => void) | null = null

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

        // 확대·축소해도 이름표 글자 크기는 화면에서 그대로
        for (const n of nodeRenderData) {
          n.label.scale.set(1 / transform.k)
        }
      })

    const canvasSelection = select<HTMLCanvasElement, NodeData>(app.canvas)
    canvasSelection.call(zoomBehavior)

    // 모든 인물이 한 화면에 들어오도록 배율과 위치를 맞춰서 시작
    if (graphData.nodes.length > 0) {
      const pad = 40
      const xs = graphData.nodes.map((n) => n.x ?? 0)
      const ys = graphData.nodes.map((n) => n.y ?? 0)
      const minX = Math.min(...xs) - pad
      const maxX = Math.max(...xs) + pad
      const minY = Math.min(...ys) - pad
      const maxY = Math.max(...ys) + pad
      const fitK = Math.min(width / (maxX - minX), height / (maxY - minY))
      const k = Math.max(0.25, Math.min(2, fitK))
      const cx = (minX + maxX) / 2 + width / 2
      const cy = (minY + maxY) / 2 + height / 2
      canvasSelection.call(
        zoomBehavior.transform,
        zoomIdentity.translate(width / 2 - k * cx, height / 2 - k * cy).scale(k),
      )
    }

    // 인물로 이동할 때 확대할 배율 (이미 더 확대돼 있으면 그대로 둔다)
    const FOCUS_ZOOM = 1.6
    let panFrame = 0
    panToNode = (id: string, zoomIn = false) => {
      const node = graphData.nodes.find((n) => n.id === id)
      if (!node || node.x === undefined || node.y === undefined) return
      const k0 = currentTransform.k
      const k1 = zoomIn ? Math.max(k0, FOCUS_ZOOM) : k0
      // 지금 화면 가운데가 가리키는 그래프 좌표 → 목표 노드 좌표로, 배율과 함께 부드럽게 옮긴다
      const c0x = (width / 2 - currentTransform.x) / k0
      const c0y = (height / 2 - currentTransform.y) / k0
      const c1x = node.x + width / 2
      const c1y = node.y + height / 2
      const startTime = performance.now()
      const duration = 500
      cancelAnimationFrame(panFrame)
      const step = (now: number) => {
        const t = Math.min(1, (now - startTime) / duration)
        const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
        const k = k0 + (k1 - k0) * e
        const cx = c0x + (c1x - c0x) * e
        const cy = c0y + (c1y - c0y) * e
        canvasSelection.call(
          zoomBehavior.transform,
          zoomIdentity.translate(width / 2 - k * cx, height / 2 - k * cy).scale(k),
        )
        if (t < 1) panFrame = requestAnimationFrame(step)
      }
      panFrame = requestAnimationFrame(step)
    }

    // 처음 그릴 때도 인물 페이지면 그 인물 쪽으로
    panToNode(slug)
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
      l.gfx.moveTo(linkData.source.x! + width / 2, linkData.source.y! + height / 2)
      l.gfx
        .lineTo(linkData.target.x! + width / 2, linkData.target.y! + height / 2)
        .stroke({
          alpha: l.alpha,
          // 함께 엮인 사건 수에 따라 굵게: 1건 1.8px, 2건 2.6px, 3건 3.4px, 최대 4px
          width: Math.min(1 + 0.8 * l.simulationData.weight, 4),
          color: l.color,
        })
    }

    tweens.forEach((t) => t.update(time))
    app.renderer.render(stage)
    requestAnimationFrame(animate)
  }

  requestAnimationFrame(animate)

  // 페이지를 옮기면 그래프는 그대로 두고 '지금 페이지' 테두리만 옮긴다
  function setCurrent(newFullSlug: FullSlug) {
    currentFullSlug = newFullSlug
    const cur = simplifySlug(newFullSlug)
    for (const n of nodeRenderData) {
      const r = nodeRadius(n.simulationData)
      n.gfx.clear().circle(0, 0, r).fill({ color: color(n.simulationData) })
      if (n.simulationData.id === cur) {
        n.gfx.stroke({ width: 2, color: computedStyleMap["--secondary"] })
      }
    }
    // 페이지를 옮겨 인물로 갈 때는 이동하면서 확대도 한다
    panToNode?.(cur, true)
  }

  return {
    canvas: app.canvas as HTMLCanvasElement,
    setCurrent,
    cleanup: () => {
      stopAnimation = true
      app.destroy()
    },
  }
}

// 사이드바 인물 그래프는 한 번 그린 것을 계속 쓴다 (페이지 이동 때 다시 그리지 않음).
// 크기가 바뀌거나 테마가 바뀔 때만 새로 그린다.
type PersistentGraph = {
  canvas: HTMLCanvasElement
  setCurrent: (slug: FullSlug) => void
  cleanup: () => void
  width: number
  height: number
}
let persistentPeopleGraph: PersistentGraph | null = null
let peopleGlobalGraphCleanups: (() => void)[] = []

function destroyPersistentPeopleGraph() {
  persistentPeopleGraph?.cleanup()
  persistentPeopleGraph = null
}

function cleanupPeopleGlobalGraphs() {
  for (const cleanup of peopleGlobalGraphCleanups) {
    cleanup()
  }
  peopleGlobalGraphCleanups = []
}

document.addEventListener("nav", async (e: CustomEventMap["nav"]) => {
  const slug = e.detail.url

  async function renderPeopleGraphs(force = false) {
    const container = document.querySelector(".people-graph-container") as HTMLElement | null
    if (!container) return
    const width = container.offsetWidth
    const height = Math.max(container.offsetHeight, 250)

    // 이미 그려 둔 그래프가 있고 크기가 같으면: 그대로 다시 붙이고 '지금 페이지' 표시만 옮긴다
    const kept = persistentPeopleGraph
    if (!force && kept && kept.width === width && kept.height === height) {
      if (kept.canvas.parentElement !== container) {
        removeAllChildren(container)
        container.appendChild(kept.canvas)
      }
      kept.setCurrent(slug)
      return
    }

    destroyPersistentPeopleGraph()
    const rendered = await renderGraph(container, slug)
    persistentPeopleGraph = { ...rendered, width, height }
  }

  await renderPeopleGraphs()
  const handleThemeChange = () => {
    void renderPeopleGraphs(true)
  }

  document.addEventListener("themechange", handleThemeChange)
  window.addCleanup(() => {
    document.removeEventListener("themechange", handleThemeChange)
  })

  // 오른쪽 위 버튼: 인물 그래프 크게 보기 (Esc나 바깥 클릭으로 닫기)
  const outers = [
    ...document.getElementsByClassName("people-global-graph-outer"),
  ] as HTMLElement[]

  async function showPeopleGlobalGraph() {
    for (const outer of outers) {
      outer.classList.add("active")
      const sidebar = outer.closest(".sidebar") as HTMLElement
      if (sidebar) {
        sidebar.style.zIndex = "1"
      }

      const container = outer.querySelector(".people-global-graph-container") as HTMLElement
      registerEscapeHandler(outer, hidePeopleGlobalGraph)
      if (container) {
        peopleGlobalGraphCleanups.push((await renderGraph(container, slug)).cleanup)
      }
    }
  }

  function hidePeopleGlobalGraph() {
    cleanupPeopleGlobalGraphs()
    for (const outer of outers) {
      outer.classList.remove("active")
      const sidebar = outer.closest(".sidebar") as HTMLElement
      if (sidebar) {
        sidebar.style.zIndex = ""
      }
    }
  }

  const icons = document.getElementsByClassName("people-global-graph-icon")
  Array.from(icons).forEach((icon) => {
    icon.addEventListener("click", showPeopleGlobalGraph)
    window.addCleanup(() => icon.removeEventListener("click", showPeopleGlobalGraph))
  })

  window.addCleanup(() => {
    cleanupPeopleGlobalGraphs()
  })
})
