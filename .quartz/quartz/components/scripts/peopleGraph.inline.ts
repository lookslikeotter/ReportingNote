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
import {
  ContentData,
  HOVER_EXTRA_WIDTH,
  applyGraphMode,
  eventLinkColor,
  eventLinkWidth,
  tableEventPairs,
  factionColors,
  factionIndex,
  focusBox,
  personColor,
  linkResolver,
  loadContentIndex,
  nearestLink,
  nodeLabel,
  normalizeName,
  showLinkPopup,
} from "./bongnudo"

// 봉누도2 — 인물 그래프 스크립트 (그래프 상자 GraphBox.tsx의 '인물' 탭과 크게 보기 창). Quartz v4.5.2 graph.inline.ts를 바탕으로 했다.
// 원본은 볼트의 .quartz/quartz/components/scripts/peopleGraph.inline.ts. '이 페이지' 그래프와 함께 쓰는 규칙은 bongnudo.ts.
// 탭이 숨겨져 있으면 그리지 않고, 탭을 바꾸거나 휴대폰에서 펼칠 때(bn-graph-mode) 그린다.
//   - 노드는 PERSON_TAG 태그가 붙은 인물 노트만. 색은 소속 세력의 색(없으면 분류 태그 색), 지금 페이지는 테두리
//   - 이름표는 처음부터 보이고, 확대·축소해도 화면에서 글자 크기가 그대로다
//   - 선은 사건 인연 선만 (일지 표 📰·🔥 행 관련 인물 칸에 함께 적힌 두 인물, 사건이 많을수록 굵고 가깝게).
//     명총희는 인물 태그가 없어 노드도 선도 없다.
//     같은 소속끼리는 선 없이 보이지 않는 힘으로 가까이 모은다
//   - 배치를 미리 계산해 인물이 모여 있는 곳(bongnudo.ts focusBox)이 화면에 들어오게 맞춘 뒤, 노드를 처음 위치로 되돌려
//     흔들리며 자리 잡는 모습을 보여 준다. 인물 페이지로 가면 그 인물 쪽으로 옮기며 확대한다 (미리 계산한 위치 기준)
//   - 페이지를 옮겨도 다시 그리지 않는다 (크기·테마가 바뀔 때만)
//   - 선에 마우스를 올리면 하이라이트, 누르면 두 인물이 함께 엮인 사건 표 창
const PERSON_TAG = "인물"

// 같은 소속끼리 모으는 힘의 세기
const CLUSTER_STRENGTH = 0.15

// 처음 배율: 노드 둘레 여백(그래프 좌표)과 확대 상한
const FIT_PAD = 40
const FIT_MAX = 2

// 인물로 이동할 때 확대할 배율 (이미 더 확대돼 있으면 그대로 둔다)
const FOCUS_ZOOM = 1.6

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

type LinkData = {
  source: NodeData
  target: NodeData
  // 함께 엮인 사건 수와 그 사건 노트들
  weight: number
  events: SimpleSlug[]
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
  // 페이지를 옮겨도 그래프를 다시 그리지 않으므로, 링크는 지금 페이지 기준으로 계산한다 (setCurrent가 갱신)
  let currentFullSlug = fullSlug
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

  const data: ContentData = new Map(
    Object.entries<ContentDetails>(await loadContentIndex()).map(([k, v]) => [
      simplifySlug(k as FullSlug),
      v,
    ]),
  )
  const resolveLink = linkResolver(data)

  const people = new Set<SimpleSlug>()
  for (const [id, details] of data.entries()) {
    if ((details.tags ?? []).includes(PERSON_TAG)) people.add(id)
  }

  const fcolors = await factionColors(fullSlug)

  // 소속: 조직 태그 = 세력 노트 이름과 같은 태그
  const factions = factionIndex(data)
  const orgOf = new Map<SimpleSlug, string>()
  for (const id of people) {
    const org = (data.get(id)?.tags ?? []).map(normalizeName).find((t) => factions.has(t))
    if (org) orgOf.set(id, org)
  }

  const nodes: NodeData[] = [...people].map((id) => ({
    id,
    text: nodeLabel(data.get(id)?.title ?? id),
    tags: data.get(id)?.tags ?? [],
  }))
  const nodeById = new Map(nodes.map((n) => [n.id, n]))
  // 인물이 셋 미만이면 안내 글을 보인다 (custom.scss .bn-graph-box.bn-few)
  graph.closest(".graph")?.classList.toggle("bn-few", nodes.length < 3)
  const graphData: { nodes: NodeData[]; links: LinkData[] } = {
    nodes,
    links: [
      ...(await tableEventPairs(fullSlug, data, resolveLink, (id) => people.has(id))).values(),
    ].map((p) => ({
      ...p,
      source: nodeById.get(p.source)!,
      target: nodeById.get(p.target)!,
    })),
  }

  // 같은 소속끼리 모으는 힘: 소속별 무게중심 쪽으로 조금씩 당긴다 (선은 그리지 않음)
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
    // 함께 엮인 사건이 많을수록 더 가깝게
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
  // 자리 잡은 뒤의 위치. 아래에서 노드를 처음 위치로 되돌려 흔들리며 모이는 모습을 보여 주므로,
  // 인물 쪽으로 옮기는 계산(panToNode)은 이 값을 쓴다 (초기 위치와 힘이 같아서 같은 자리로 모인다)
  const finalPos = new Map(graphData.nodes.map((n) => [n.id, { x: n.x ?? 0, y: n.y ?? 0 }]))

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

  // 인물 색은 소속 세력의 색 (아래 그래프와 같은 규칙)
  const color = (d: NodeData) => personColor(d.tags, fcolors, factions, computedStyleMap["--dark"])
  const eventColor = (l: LinkData) =>
    eventLinkColor(l.weight, computedStyleMap["--gray"], computedStyleMap["--dark"])

  // 노드에 이어진 선 수
  function degree(d: NodeData) {
    return graphData.links.filter((l) => l.source.id === d.id || l.target.id === d.id).length
  }

  function nodeRadius(d: NodeData) {
    return 4 + Math.sqrt(degree(d))
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

  let dragStartTime = 0
  let dragging = false

  function renderLinks() {
    tweens.get("link")?.stop()
    const tweenGroup = new TweenGroup()

    for (const l of linkRenderData) {
      let alpha = 1

      if (hoveredNodeId) {
        alpha = l.active ? 1 : 0.2
      } else if (hoveredLink) {
        alpha = l === hoveredLink ? 1 : 0.2
      }

      // 하이라이트된 선은 가장 진하게, 나머지는 사건 수에 따라 (굵기가 최대가 된 뒤부터 조금씩 진해짐)
      l.color = l.active || l === hoveredLink ? computedStyleMap["--dark"] : eventColor(l.simulationData)
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

      if (hoveredNodeId !== null && focusOnHover) {
        alpha = n.active ? 1 : 0.2
      } else if (hoveredNodeId === null && hoveredLink) {
        // 선에 마우스를 올리면 양 끝 두 인물만 또렷하게
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

  // 노드 원 + 지금 페이지 테두리 (페이지를 옮기면 setCurrent가 다시 그린다)
  function drawNode(gfx: Graphics, n: NodeData, current: SimpleSlug) {
    gfx.clear().circle(0, 0, nodeRadius(n)).fill({ color: color(n) })
    if (n.id === current) {
      gfx.stroke({ width: 2, color: computedStyleMap["--secondary"] })
    }
  }

  for (const n of graphData.nodes) {
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
      label: n.id,
      eventMode: "static",
      hitArea: new Circle(0, 0, nodeRadius(n)),
      cursor: "pointer",
    })
      .on("pointerover", (e) => {
        updateHoverInfo(e.target.label)
        if (!dragging) renderPixiFromD3()
      })
      .on("pointerleave", () => {
        updateHoverInfo(null)
        if (!dragging) renderPixiFromD3()
      })
    drawNode(gfx, n, slug)

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
    linkRenderData.push({
      simulationData: l,
      gfx,
      color: eventColor(l),
      alpha: 1,
      active: false,
    })
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

  // 인물 페이지에 들어가면 그 인물이 가운데 오도록 화면을 옮긴다
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

    // 인물이 모여 있는 곳이 화면에 들어오도록 배율과 위치를 맞춰서 시작 (bongnudo.ts focusBox). 지금 페이지 인물은 항상 담는다
    const box = focusBox(graphData.nodes, (n) => 1 + degree(n), {
      keep: graphData.nodes.filter((n) => n.id === slug),
      pad: FIT_PAD,
    })
    if (box) {
      const { minX, maxX, minY, maxY } = box
      const fitK = Math.min(width / (maxX - minX), height / (maxY - minY))
      const k = Math.max(0.25, Math.min(FIT_MAX, fitK))
      const cx = (minX + maxX) / 2 + width / 2
      const cy = (minY + maxY) / 2 + height / 2
      canvasSelection.call(
        zoomBehavior.transform,
        zoomIdentity.translate(width / 2 - k * cx, height / 2 - k * cy).scale(k),
      )
    }

    let panFrame = 0
    panToNode = (id: string, zoomIn = false) => {
      const node = finalPos.get(id as SimpleSlug)
      if (!node) return
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

    // 처음 그릴 때(새로고침·첫 방문)도 인물 페이지면 전체 화면에서 그 인물 쪽으로 옮기며 확대한다
    panToNode(slug, true)
  }

  // 배율을 맞췄으니 처음 위치로 되돌리고 다시 움직이게 한다 ('이 페이지' 그래프와 같은 방식)
  for (const n of graphData.nodes) {
    n.x = n.y = n.vx = n.vy = undefined
  }
  simulation.nodes(graphData.nodes).alpha(1).restart()

  // 선 위에 마우스를 올리면 하이라이트, 누르면 사건 표 창
  function setHoveredLink(l: LinkRenderData | null) {
    if (l === hoveredLink) return
    hoveredLink = l
    app.canvas.style.cursor = l ? "pointer" : ""
    renderPixiFromD3()
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
    if (hoveredNodeId !== null || !hoveredLink) return
    const { source, target, events } = hoveredLink.simulationData
    void showLinkPopup({
      title: `${source.text} ─ ${target.text}`,
      currentSlug: currentFullSlug,
      data,
      resolveLink,
      a: source.id,
      b: target.id,
      knownEvents: events,
    })
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
      l.gfx
        .clear()
        .moveTo(linkData.source.x! + width / 2, linkData.source.y! + height / 2)
        .lineTo(linkData.target.x! + width / 2, linkData.target.y! + height / 2)
        .stroke({ alpha: l.alpha, width: eventLinkWidth(linkData.weight) + extra, color: l.color })
    }

    tweens.forEach((t) => t.update(time))
    app.renderer.render(stage)
    requestAnimationFrame(animate)
  }

  requestAnimationFrame(animate)

  // 페이지를 옮기면 그래프는 그대로 두고 '지금 페이지' 테두리만 옮긴 뒤, 그 인물 쪽으로 옮기며 확대한다
  function setCurrent(newFullSlug: FullSlug) {
    currentFullSlug = newFullSlug
    const cur = simplifySlug(newFullSlug)
    for (const n of nodeRenderData) {
      drawNode(n.gfx, n.simulationData, cur)
    }
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

// 자동 갱신으로 새 기록이 오면 그려 둔 그래프를 버린다 (이어지는 페이지 갱신 때 새 데이터로 다시 그린다)
document.addEventListener("bn-content-updated", () => destroyPersistentPeopleGraph())

function cleanupPeopleGlobalGraphs() {
  for (const cleanup of peopleGlobalGraphCleanups) {
    cleanup()
  }
  peopleGlobalGraphCleanups = []
}

document.addEventListener("nav", async (e: CustomEventMap["nav"]) => {
  const slug = e.detail.url
  applyGraphMode()

  async function renderPeopleGraphs(force = false) {
    const container = document.querySelector(".people-graph-container") as HTMLElement | null
    // 숨겨진 탭이면(너비 0) 그리지 않는다 — 탭을 바꿀 때 다시 온다
    if (!container || container.offsetWidth === 0) return
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
  const handleMode = () => {
    void renderPeopleGraphs()
  }

  document.addEventListener("themechange", handleThemeChange)
  document.addEventListener("bn-graph-mode", handleMode)
  window.addCleanup(() => {
    document.removeEventListener("themechange", handleThemeChange)
    document.removeEventListener("bn-graph-mode", handleMode)
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
