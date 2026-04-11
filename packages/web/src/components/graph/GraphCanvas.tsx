import { useEffect, useRef, useCallback, useState } from "react";
import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
  forceCollide,
  type SimulationNodeDatum,
  type SimulationLinkDatum,
} from "d3-force";
import rough from "roughjs";
import type { RoughCanvas } from "roughjs/bin/canvas";
import { useGraphStore } from "../../hooks/useGraph.js";
import {
  GRAPH_STYLES,
  getStyleById,
  rgba,
  hashSeed,
  drawOrthogonalPath,
  drawSubwayPath,
  drawStarfield,
  pickFromPalette,
  type GraphStyle,
  type RGB,
} from "./styles.js";
import {
  type Category,
  isNodeVisible as isCategoryVisible,
  getNodeCategoryColor,
} from "./categories.js";

interface SimNode extends SimulationNodeDatum {
  id: string;
  title: string;
  tags: string[];
  linkCount: number;
  isFresh?: boolean;
  fixed?: boolean;
}

interface SimLink extends SimulationLinkDatum<SimNode> {
  type: string;
  weight: number;
}

interface GraphCanvasProps {
  onNodeClick?: (id: string) => void;
}

interface Viewport {
  x: number;
  y: number;
  scale: number;
}

export function GraphCanvas({ onNodeClick }: GraphCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const simRef = useRef<ReturnType<typeof forceSimulation<SimNode>> | null>(null);
  const nodesRef = useRef<SimNode[]>([]);
  const linksRef = useRef<SimLink[]>([]);
  const animRef = useRef<number>(0);
  const viewportRef = useRef<Viewport>({ x: 0, y: 0, scale: 1 });
  const hoveredIdRef = useRef<string | null>(null);
  const draggingRef = useRef<SimNode | null>(null);
  const dragStartRef = useRef<{ clientX: number; clientY: number } | null>(null);
  const dragMovedRef = useRef<boolean>(false);
  const panningRef = useRef<{ startX: number; startY: number } | null>(null);
  // Touch state for mobile gestures
  interface TouchSession {
    mode: "tap-or-pan" | "panning" | "dragging" | "pinching";
    startX: number; // initial pointer screen X
    startY: number;
    startTime: number;
    moved: boolean;
    node: SimNode | null; // pressed node, if any
    // Pinch
    initialPinchDist: number;
    initialScale: number;
    initialPinchCenter: { x: number; y: number };
  }
  const touchSessionRef = useRef<TouchSession | null>(null);
  const adjacencyRef = useRef<Map<string, Set<string>>>(new Map());
  const pinnedIdsRef = useRef<Set<string>>(new Set());
  const styleRef = useRef<GraphStyle>(getStyleById("clean"));
  const roughRef = useRef<RoughCanvas | null>(null);
  const labelsVisibleRef = useRef<boolean>(true);
  const focusedIdsRef = useRef<Set<string>>(new Set());
  const activePageIdRef = useRef<string | null>(null);
  /** Last time the user wheeled — used to pause focus tracking briefly */
  const lastWheelTimeRef = useRef<number>(0);
  const categoriesRef = useRef<Category[]>([]);
  const [hoveredNode, setHoveredNode] = useState<SimNode | null>(null);
  const [labelsVisible, setLabelsVisible] = useState<boolean>(true);

  const {
    nodes,
    edges,
    freshNodes,
    pinnedIds,
    pin,
    graphStyleId,
    setGraphStyle,
    focusedIds,
    activePageId,
    clearFocus,
    categories,
    toggleCategoryVisibility,
    addCustomCategory,
    removeCategory,
  } = useGraphStore();

  // Mirror reactive state into refs for the rAF render loop
  useEffect(() => {
    pinnedIdsRef.current = pinnedIds;
  }, [pinnedIds]);

  useEffect(() => {
    styleRef.current = getStyleById(graphStyleId);
  }, [graphStyleId]);

  useEffect(() => {
    labelsVisibleRef.current = labelsVisible;
  }, [labelsVisible]);

  useEffect(() => {
    focusedIdsRef.current = focusedIds;
  }, [focusedIds]);

  useEffect(() => {
    activePageIdRef.current = activePageId;
  }, [activePageId]);

  useEffect(() => {
    categoriesRef.current = categories;
  }, [categories]);

  // Build adjacency map for hover highlighting
  useEffect(() => {
    const adj = new Map<string, Set<string>>();
    for (const e of edges) {
      if (!adj.has(e.source)) adj.set(e.source, new Set());
      if (!adj.has(e.target)) adj.set(e.target, new Set());
      adj.get(e.source)!.add(e.target);
      adj.get(e.target)!.add(e.source);
    }
    adjacencyRef.current = adj;
  }, [edges]);

  // Sync graph data → simulation, preserving positions
  useEffect(() => {
    const oldNodeMap = new Map(nodesRef.current.map((n) => [n.id, n]));

    const simNodes: SimNode[] = nodes.map((n) => {
      const old = oldNodeMap.get(n.id);
      const isPinned = pinnedIds.has(n.id);
      // For previously-pinned nodes the old node already has fx/fy set.
      // For newly pinned nodes we use the current x/y as the fixed position.
      // For newly unpinned nodes we leave fx/fy undefined to release them.
      const fx = isPinned ? (old?.fx ?? old?.x) : undefined;
      const fy = isPinned ? (old?.fy ?? old?.y) : undefined;
      return {
        id: n.id,
        title: n.title,
        tags: n.tags,
        linkCount: n.linkCount,
        isFresh: freshNodes.has(n.id),
        x: old?.x,
        y: old?.y,
        vx: old?.vx,
        vy: old?.vy,
        fx,
        fy,
        fixed: isPinned,
      };
    });

    const nodeIdSet = new Set(simNodes.map((n) => n.id));
    const simLinks: SimLink[] = edges
      .filter((e) => nodeIdSet.has(e.source) && nodeIdSet.has(e.target))
      .map((e) => ({
        source: e.source,
        target: e.target,
        type: e.type,
        weight: e.weight,
      }));

    nodesRef.current = simNodes;
    linksRef.current = simLinks;

    if (simRef.current) {
      simRef.current.nodes(simNodes);
      const linkForce = simRef.current.force("link") as ReturnType<typeof forceLink> | undefined;
      if (linkForce) {
        (linkForce as any).links(simLinks);
      }
      simRef.current.alpha(0.3).restart();
    }
  }, [nodes, edges, freshNodes, pinnedIds]);

  // Initialize simulation + render loop
  useEffect(() => {
    const canvas = canvasRef.current!;
    const container = containerRef.current!;
    roughRef.current = rough.canvas(canvas);

    const resize = () => {
      const dpr = devicePixelRatio || 1;
      canvas.width = container.clientWidth * dpr;
      canvas.height = container.clientHeight * dpr;
      canvas.style.width = container.clientWidth + "px";
      canvas.style.height = container.clientHeight + "px";
    };
    resize();

    const observer = new ResizeObserver(resize);
    observer.observe(container);

    const sim = forceSimulation<SimNode>(nodesRef.current)
      .force(
        "link",
        forceLink<SimNode, SimLink>(linksRef.current)
          .id((d) => d.id)
          .distance(140)
          .strength((d) => d.weight * 0.4)
      )
      .force("charge", forceManyBody().strength(-400))
      .force(
        "center",
        forceCenter(container.clientWidth / 2, container.clientHeight / 2)
      )
      .force("collide", forceCollide(40))
      .alphaDecay(0.02);

    simRef.current = sim;

    const ctx = canvas.getContext("2d")!;
    function render() {
      const dpr = devicePixelRatio || 1;
      const w = canvas.width;
      const h = canvas.height;
      const s = styleRef.current;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // ── Continuous viewport tracking for focused nodes ──
      // If chat focus or an open page is set, gently lerp the viewport
      // toward fitting those nodes in the panel. Pause when the user is
      // actively interacting so we don't fight them.
      {
        const focusSeed = new Set<string>();
        for (const id of focusedIdsRef.current) focusSeed.add(id);
        if (activePageIdRef.current) focusSeed.add(activePageIdRef.current);

        const userInteracting =
          panningRef.current !== null ||
          draggingRef.current !== null ||
          touchSessionRef.current !== null ||
          Date.now() - lastWheelTimeRef.current < 800;

        if (focusSeed.size > 0 && !userInteracting) {
          const screenW = w / dpr;
          const screenH = h / dpr;

          // Collect focused nodes that have valid positions
          const focusedNodes: SimNode[] = [];
          for (const node of nodesRef.current) {
            if (focusSeed.has(node.id) && node.x != null && node.y != null) {
              focusedNodes.push(node);
            }
          }

          if (focusedNodes.length > 0) {
            // Compute bounding box in graph space
            let minX = Infinity;
            let maxX = -Infinity;
            let minY = Infinity;
            let maxY = -Infinity;
            for (const node of focusedNodes) {
              if (node.x! < minX) minX = node.x!;
              if (node.x! > maxX) maxX = node.x!;
              if (node.y! < minY) minY = node.y!;
              if (node.y! > maxY) maxY = node.y!;
            }
            // Pad and minimum size for single-node case
            const padding = 80;
            const minSize = 200;
            const bboxW = Math.max(maxX - minX + padding * 2, minSize);
            const bboxH = Math.max(maxY - minY + padding * 2, minSize);
            const bboxCx = (minX + maxX) / 2;
            const bboxCy = (minY + maxY) / 2;

            // Target scale to fit bbox into the panel
            const fitScale = Math.min(screenW / bboxW, screenH / bboxH);
            const targetScale = Math.max(0.4, Math.min(1.8, fitScale));

            // Target pan so the bbox center is the panel center
            const targetX = screenW / 2 - bboxCx * targetScale;
            const targetY = screenH / 2 - bboxCy * targetScale;

            // Lerp current viewport toward target
            const vpRef = viewportRef.current;
            const lerp = 0.08;
            vpRef.x += (targetX - vpRef.x) * lerp;
            vpRef.y += (targetY - vpRef.y) * lerp;
            vpRef.scale += (targetScale - vpRef.scale) * lerp;
          }
        }
      }

      // Background fill
      ctx.fillStyle = s.background;
      ctx.fillRect(0, 0, w / dpr, h / dpr);

      // Starfield (drawn in screen space, before pan/zoom transform)
      if (s.engine === "starchart" && s.starchart) {
        const vp0 = viewportRef.current;
        drawStarfield(
          ctx,
          w / dpr,
          h / dpr,
          vp0.x,
          vp0.y,
          120,
          s.starchart.bgStarDensity,
          s.starchart.bgStarColors
        );
      }

      // Background grid
      if (s.grid) {
        const vp = viewportRef.current;
        const baseSize = s.engine === "circuit" ? 24 : 50;
        const size = baseSize * vp.scale;
        const offsetX = vp.x % size;
        const offsetY = vp.y % size;
        const useDots = s.engine === "circuit" && (s.circuit?.dotGrid ?? false);

        if (useDots) {
          ctx.fillStyle = s.grid.color;
          const r = Math.max(0.6, 0.9 * vp.scale);
          for (let y = offsetY; y < h / dpr; y += size) {
            for (let x = offsetX; x < w / dpr; x += size) {
              ctx.beginPath();
              ctx.arc(x, y, r, 0, 2 * Math.PI);
              ctx.fill();
            }
          }
        } else {
          ctx.strokeStyle = s.grid.color;
          ctx.lineWidth = 1;
          ctx.beginPath();
          for (let x = offsetX; x < w / dpr; x += size) {
            ctx.moveTo(x, 0);
            ctx.lineTo(x, h / dpr);
          }
          for (let y = offsetY; y < h / dpr; y += size) {
            ctx.moveTo(0, y);
            ctx.lineTo(w / dpr, y);
          }
          ctx.stroke();
        }
      }

      // Apply pan/zoom
      const vp = viewportRef.current;
      ctx.translate(vp.x, vp.y);
      ctx.scale(vp.scale, vp.scale);

      const currentNodes = nodesRef.current;
      const currentLinks = linksRef.current;
      const hoveredId = hoveredIdRef.current;
      const adj = adjacencyRef.current;
      const showLabels = vp.scale > 0.55;

      // Build a quick "is this node visible (per category)" set for the
      // edge filter. Nodes whose category is hidden don't render.
      const cats = categoriesRef.current;
      const hiddenNodeIds = new Set<string>();
      for (const node of currentNodes) {
        if (!isCategoryVisible(node.tags, cats)) {
          hiddenNodeIds.add(node.id);
        }
      }

      // Determine highlight set:
      // - hover takes priority (1st-degree neighborhood)
      // - else: union of (chat-focused IDs) + (active page ID) plus
      //   their 1st-degree neighbors
      // - else null (everything full opacity)
      let highlightSet: Set<string> | null = null;
      if (hoveredId) {
        highlightSet = new Set([hoveredId]);
        const neighbors = adj.get(hoveredId);
        if (neighbors) for (const n of neighbors) highlightSet.add(n);
      } else {
        const focusSeed = new Set<string>();
        for (const id of focusedIdsRef.current) focusSeed.add(id);
        if (activePageIdRef.current) focusSeed.add(activePageIdRef.current);

        if (focusSeed.size > 0) {
          highlightSet = new Set(focusSeed);
          for (const fid of focusSeed) {
            const neighbors = adj.get(fid);
            if (neighbors) for (const n of neighbors) highlightSet.add(n);
          }
        }
      }

      // Draw edges
      const rc = roughRef.current;
      for (const link of currentLinks) {
        const source = link.source as SimNode;
        const target = link.target as SimNode;
        if (source.x == null || target.x == null) continue;
        // Skip edges where either endpoint is hidden by category filter
        if (hiddenNodeIds.has(source.id) || hiddenNodeIds.has(target.id))
          continue;

        const isHighlighted =
          !highlightSet ||
          (highlightSet.has(source.id) && highlightSet.has(target.id));
        const dimFactor = isHighlighted ? 1 : s.edge.dimOpacity;

        let strokeColor: string;
        let strokeWidth: number;
        let dash: number[];
        if (link.type === "explicit") {
          strokeColor = rgba(s.edge.explicit.color, s.edge.explicit.opacity * dimFactor);
          strokeWidth = s.edge.explicit.width;
          dash = s.edge.explicit.dash;
        } else {
          strokeColor = rgba(
            s.edge.semantic.color,
            link.weight * s.edge.semantic.opacityScale * dimFactor
          );
          strokeWidth = s.edge.semantic.widthBase + link.weight * s.edge.semantic.widthScale;
          dash = s.edge.semantic.dash;
        }

        // Per-edge color override for subway (each "line" gets its own palette color)
        if (s.engine === "subway" && s.subway) {
          const lineColor = pickFromPalette(
            s.subway.palette,
            hashSeed(source.id, target.id)
          );
          strokeColor = rgba(lineColor, dimFactor);
          strokeWidth =
            link.type === "explicit"
              ? s.subway.lineWidth
              : s.subway.lineWidth * 0.7;
        }

        if (s.engine === "sketchy" && rc) {
          rc.line(source.x, source.y!, target.x, target.y!, {
            stroke: strokeColor,
            strokeWidth,
            roughness: s.sketchy?.roughness ?? 1.5,
            bowing: s.sketchy?.bowing ?? 1,
            seed: hashSeed(source.id, target.id, link.type),
            strokeLineDash: dash.length > 0 ? dash : undefined,
            disableMultiStroke: true,
          });
        } else if (s.engine === "circuit") {
          ctx.strokeStyle = strokeColor;
          ctx.lineWidth = strokeWidth;
          ctx.lineCap = "round";
          ctx.lineJoin = "round";
          ctx.setLineDash(dash);
          if (s.circuit?.glow && s.circuit.glow > 0) {
            ctx.shadowColor = strokeColor;
            ctx.shadowBlur = s.circuit.glow * dimFactor;
          }
          drawOrthogonalPath(
            ctx,
            source.x,
            source.y!,
            target.x,
            target.y!,
            s.circuit?.cornerRadius ?? 10,
            hashSeed(source.id, target.id, link.type)
          );
          ctx.shadowBlur = 0;
          ctx.setLineDash([]);
          ctx.lineCap = "butt";
          ctx.lineJoin = "miter";
        } else if (s.engine === "subway") {
          ctx.strokeStyle = strokeColor;
          ctx.lineWidth = strokeWidth;
          ctx.lineCap = "round";
          ctx.lineJoin = "round";
          ctx.setLineDash([]);
          drawSubwayPath(
            ctx,
            source.x,
            source.y!,
            target.x,
            target.y!,
            s.subway?.cornerRadius ?? 14,
            hashSeed(source.id, target.id, link.type)
          );
          ctx.lineCap = "butt";
          ctx.lineJoin = "miter";
        } else if (s.engine === "starchart") {
          ctx.strokeStyle = strokeColor;
          ctx.lineWidth = strokeWidth;
          ctx.lineCap = "round";
          ctx.setLineDash(dash);
          ctx.beginPath();
          ctx.moveTo(source.x, source.y!);
          ctx.lineTo(target.x, target.y!);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.lineCap = "butt";
        } else {
          ctx.strokeStyle = strokeColor;
          ctx.lineWidth = strokeWidth;
          ctx.setLineDash(dash);
          ctx.beginPath();
          ctx.moveTo(source.x, source.y!);
          ctx.lineTo(target.x, target.y!);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }

      // Draw nodes
      for (const node of currentNodes) {
        if (node.x == null) continue;
        // Skip nodes whose category is hidden
        if (hiddenNodeIds.has(node.id)) continue;

        const isHovered = node.id === hoveredId;
        const isHighlighted = !highlightSet || highlightSet.has(node.id);
        const opacity = isHighlighted ? 1 : s.node.dimOpacity;
        const isPinned = pinnedIdsRef.current.has(node.id);

        const baseRadius = 7 + Math.min(node.linkCount * 1.6, 14);
        const radius = isHovered ? baseRadius * 1.15 : baseRadius;

        // Glow for fresh nodes
        if (node.isFresh) {
          ctx.beginPath();
          ctx.arc(node.x, node.y!, radius + 8, 0, 2 * Math.PI);
          ctx.fillStyle = rgba(s.node.freshGlow, 0.35 * opacity);
          ctx.fill();
        }

        const nodeColor = node.isFresh
          ? s.node.freshFill
          : getNodeCategoryColor(node.tags, cats, s);
        const fill = rgba(nodeColor, opacity);
        const bc = isPinned ? s.node.pinnedBorderColor : s.node.borderColor;
        const bw = isPinned ? s.node.pinnedBorderWidth : s.node.borderWidth;
        const stroke = rgba(bc, (isPinned ? 0.95 : 0.5) * opacity);

        if (s.engine === "sketchy" && rc) {
          rc.circle(node.x, node.y!, radius * 2, {
            fill,
            fillStyle: s.sketchy?.fillStyle ?? "solid",
            fillWeight: s.sketchy?.fillWeight,
            hachureGap: s.sketchy?.hachureGap,
            hachureAngle: s.sketchy?.hachureAngle,
            stroke,
            strokeWidth: bw,
            roughness: s.sketchy?.roughness ?? 1.5,
            bowing: s.sketchy?.bowing ?? 1,
            seed: hashSeed(node.id),
          });
        } else if (s.engine === "circuit") {
          // Glow halo
          if (s.circuit?.glow && s.circuit.glow > 0) {
            ctx.shadowColor = rgba(nodeColor, opacity);
            ctx.shadowBlur = s.circuit.glow * 1.5 * (isHovered ? 1.5 : 1);
          }
          ctx.beginPath();
          ctx.arc(node.x, node.y!, radius, 0, 2 * Math.PI);
          ctx.fillStyle = fill;
          ctx.fill();
          ctx.shadowBlur = 0;
          ctx.strokeStyle = stroke;
          ctx.lineWidth = bw;
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(node.x, node.y!, radius * 0.35, 0, 2 * Math.PI);
          ctx.fillStyle = `rgba(10, 14, 26, ${0.6 * opacity})`;
          ctx.fill();
        } else if (s.engine === "subway" && s.subway) {
          // White-filled station with thick black border
          const stationFill = rgba(s.subway.stationFill, opacity);
          const stationStroke = rgba(s.subway.stationStroke, opacity);
          ctx.beginPath();
          ctx.arc(node.x, node.y!, radius, 0, 2 * Math.PI);
          ctx.fillStyle = stationFill;
          ctx.fill();
          ctx.strokeStyle = stationStroke;
          ctx.lineWidth = isPinned ? bw + 1.5 : bw;
          ctx.stroke();
        } else if (s.engine === "starchart" && s.starchart) {
          // Star: bright center with strong glow
          const starColor = pickFromPalette(s.starchart.starColors, hashSeed(node.id));
          // Outer glow
          ctx.shadowColor = rgba(starColor, opacity);
          ctx.shadowBlur = s.starchart.glow * (isHovered ? 1.8 : 1);
          ctx.beginPath();
          ctx.arc(node.x, node.y!, radius * 0.6, 0, 2 * Math.PI);
          ctx.fillStyle = rgba(starColor, opacity);
          ctx.fill();
          ctx.shadowBlur = 0;
          // Bright core
          ctx.beginPath();
          ctx.arc(node.x, node.y!, radius * 0.3, 0, 2 * Math.PI);
          ctx.fillStyle = `rgba(255, 255, 255, ${opacity})`;
          ctx.fill();
          // Cross diffraction spike for prominent (highly connected) nodes
          if (node.linkCount > 2) {
            ctx.strokeStyle = rgba(starColor, 0.45 * opacity);
            ctx.lineWidth = 0.8;
            const spike = radius * 2.2;
            ctx.beginPath();
            ctx.moveTo(node.x - spike, node.y!);
            ctx.lineTo(node.x + spike, node.y!);
            ctx.moveTo(node.x, node.y! - spike);
            ctx.lineTo(node.x, node.y! + spike);
            ctx.stroke();
          }
          // Pinned ring
          if (isPinned) {
            ctx.strokeStyle = rgba(s.node.pinnedBorderColor, opacity);
            ctx.lineWidth = bw;
            ctx.beginPath();
            ctx.arc(node.x, node.y!, radius * 1.4, 0, 2 * Math.PI);
            ctx.stroke();
          }
        } else {
          ctx.beginPath();
          ctx.arc(node.x, node.y!, radius, 0, 2 * Math.PI);
          ctx.fillStyle = fill;
          ctx.fill();
          ctx.strokeStyle = stroke;
          ctx.lineWidth = bw;
          ctx.stroke();
        }

        // Label (skipped entirely when demo mode hides labels)
        if (
          labelsVisibleRef.current &&
          showLabels &&
          (isHighlighted || isHovered)
        ) {
          const fontSize = isHovered ? s.label.hoverSize : s.label.size;
          const fontWeight = isHovered ? s.label.hoverFontWeight : s.label.fontWeight;
          ctx.font = `${fontWeight} ${fontSize}px ${s.label.font}`;
          ctx.textAlign = "center";

          const text = node.title;
          const metrics = ctx.measureText(text);
          const padX = 4;
          const labelY = node.y! + radius + 4;

          ctx.fillStyle = s.label.bgColor;
          ctx.fillRect(
            node.x - metrics.width / 2 - padX,
            labelY,
            metrics.width + padX * 2,
            fontSize + 4
          );

          ctx.fillStyle = rgba(s.label.color, opacity);
          ctx.fillText(text, node.x, labelY + fontSize);
        }
      }

      animRef.current = requestAnimationFrame(render);
    }

    animRef.current = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animRef.current);
      sim.stop();
      observer.disconnect();
    };
  }, []);

  // Convert client coords to graph coords
  const toGraphCoords = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const vp = viewportRef.current;
    return {
      x: (x - vp.x) / vp.scale,
      y: (y - vp.y) / vp.scale,
    };
  }, []);

  // Find node under cursor
  const findNodeAt = useCallback((gx: number, gy: number): SimNode | null => {
    for (const node of nodesRef.current) {
      if (node.x == null) continue;
      const dx = node.x - gx;
      const dy = node.y! - gy;
      const radius = 7 + Math.min(node.linkCount * 1.6, 14);
      if (dx * dx + dy * dy < radius * radius) {
        return node;
      }
    }
    return null;
  }, []);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current!;

      // Pan
      if (panningRef.current) {
        const dx = e.clientX - panningRef.current.startX;
        const dy = e.clientY - panningRef.current.startY;
        viewportRef.current.x += dx;
        viewportRef.current.y += dy;
        panningRef.current.startX = e.clientX;
        panningRef.current.startY = e.clientY;
        return;
      }

      // Drag node
      if (draggingRef.current) {
        // Detect if this drag has actually moved
        if (dragStartRef.current) {
          const dx = e.clientX - dragStartRef.current.clientX;
          const dy = e.clientY - dragStartRef.current.clientY;
          if (dx * dx + dy * dy > 16) {
            dragMovedRef.current = true;
          }
        }
        const { x, y } = toGraphCoords(e.clientX, e.clientY);
        draggingRef.current.fx = x;
        draggingRef.current.fy = y;
        if (simRef.current) simRef.current.alpha(0.3).restart();
        return;
      }

      // Hover
      const { x, y } = toGraphCoords(e.clientX, e.clientY);
      const node = findNodeAt(x, y);
      const newId = node?.id ?? null;
      if (newId !== hoveredIdRef.current) {
        hoveredIdRef.current = newId;
        setHoveredNode(node);
        canvas.style.cursor = node ? "pointer" : "default";
      }
    },
    [toGraphCoords, findNodeAt]
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const { x, y } = toGraphCoords(e.clientX, e.clientY);
      const node = findNodeAt(x, y);
      if (node) {
        // Start drag (might turn out to be a click)
        draggingRef.current = node;
        dragStartRef.current = { clientX: e.clientX, clientY: e.clientY };
        dragMovedRef.current = false;
        node.fx = node.x;
        node.fy = node.y;
        canvasRef.current!.style.cursor = "grabbing";
      } else {
        // Start pan
        panningRef.current = { startX: e.clientX, startY: e.clientY };
        canvasRef.current!.style.cursor = "grabbing";
      }
    },
    [toGraphCoords, findNodeAt]
  );

  const handleMouseUp = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const wasDragging = draggingRef.current;
      const moved = dragMovedRef.current;

      if (wasDragging) {
        if (moved) {
          // Real drag — pin the node at its dragged position
          wasDragging.fixed = true;
          pin(wasDragging.id);
        } else {
          // No mouse movement — treat as click
          if (!pinnedIds.has(wasDragging.id)) {
            wasDragging.fx = undefined;
            wasDragging.fy = undefined;
            wasDragging.fixed = false;
          }
          if (onNodeClick) onNodeClick(wasDragging.id);
        }
      }

      draggingRef.current = null;
      dragStartRef.current = null;
      dragMovedRef.current = false;
      panningRef.current = null;

      const { x, y } = toGraphCoords(e.clientX, e.clientY);
      const node = findNodeAt(x, y);
      canvasRef.current!.style.cursor = node ? "pointer" : "default";
    },
    [toGraphCoords, findNodeAt, onNodeClick]
  );

  const handleWheel = useCallback(
    (e: React.WheelEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      lastWheelTimeRef.current = Date.now();
      const { x: gx, y: gy } = toGraphCoords(e.clientX, e.clientY);
      const vp = viewportRef.current;
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      const newScale = Math.max(0.2, Math.min(4, vp.scale * factor));
      // Zoom about cursor
      vp.x = e.clientX - canvasRef.current!.getBoundingClientRect().left - gx * newScale;
      vp.y = e.clientY - canvasRef.current!.getBoundingClientRect().top - gy * newScale;
      vp.scale = newScale;
    },
    [toGraphCoords]
  );

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      // Reserved for future shortcuts. Single click currently fires first
      // and opens the page viewer, so we don't unpin here.
      void e;
    },
    []
  );

  const resetView = useCallback(() => {
    viewportRef.current = { x: 0, y: 0, scale: 1 };
    if (simRef.current) simRef.current.alpha(0.5).restart();
  }, []);

  // ─── Touch handling ─────────────────────────────────────────
  // Touch events use native listeners with { passive: false } so we can
  // call preventDefault() — required to stop the browser from scrolling
  // or pinch-zooming the page itself.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const pinchDistance = (t1: Touch, t2: Touch): number => {
      const dx = t1.clientX - t2.clientX;
      const dy = t1.clientY - t2.clientY;
      return Math.sqrt(dx * dx + dy * dy);
    };

    const pinchCenter = (t1: Touch, t2: Touch): { x: number; y: number } => ({
      x: (t1.clientX + t2.clientX) / 2,
      y: (t1.clientY + t2.clientY) / 2,
    });

    const handleTouchStart = (e: TouchEvent) => {
      e.preventDefault();

      if (e.touches.length === 1) {
        const touch = e.touches[0];
        const { x, y } = toGraphCoords(touch.clientX, touch.clientY);
        const node = findNodeAt(x, y);
        touchSessionRef.current = {
          mode: "tap-or-pan",
          startX: touch.clientX,
          startY: touch.clientY,
          startTime: Date.now(),
          moved: false,
          node,
          initialPinchDist: 0,
          initialScale: 1,
          initialPinchCenter: { x: 0, y: 0 },
        };
      } else if (e.touches.length === 2) {
        // Cancel any single-touch interaction and start pinch
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        touchSessionRef.current = {
          mode: "pinching",
          startX: 0,
          startY: 0,
          startTime: Date.now(),
          moved: true,
          node: null,
          initialPinchDist: pinchDistance(t1, t2),
          initialScale: viewportRef.current.scale,
          initialPinchCenter: pinchCenter(t1, t2),
        };
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      const session = touchSessionRef.current;
      if (!session) return;

      // Pinch-to-zoom
      if (session.mode === "pinching" && e.touches.length === 2) {
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        const dist = pinchDistance(t1, t2);
        if (session.initialPinchDist > 0) {
          const scaleFactor = dist / session.initialPinchDist;
          const newScale = Math.max(0.2, Math.min(4, session.initialScale * scaleFactor));
          // Zoom about the initial pinch center (in screen coords)
          const rect = canvas.getBoundingClientRect();
          const cx = session.initialPinchCenter.x - rect.left;
          const cy = session.initialPinchCenter.y - rect.top;
          // Convert center to graph coords using OLD viewport
          const oldVp = viewportRef.current;
          const gx = (cx - oldVp.x) / oldVp.scale;
          const gy = (cy - oldVp.y) / oldVp.scale;
          // Set new viewport so that gx,gy stays under the pinch center
          oldVp.x = cx - gx * newScale;
          oldVp.y = cy - gy * newScale;
          oldVp.scale = newScale;
        }
        return;
      }

      // Single-touch handling
      if (e.touches.length !== 1) return;
      const touch = e.touches[0];
      const dx = touch.clientX - session.startX;
      const dy = touch.clientY - session.startY;
      const distSq = dx * dx + dy * dy;

      // Promote tap-or-pan to a real interaction once moved enough
      if (session.mode === "tap-or-pan" && distSq > 36) {
        session.moved = true;
        if (session.node) {
          // Drag the node
          session.mode = "dragging";
          session.node.fx = session.node.x;
          session.node.fy = session.node.y;
        } else {
          session.mode = "panning";
        }
      }

      if (session.mode === "panning") {
        // Move viewport by delta from last position
        const lastDx = touch.clientX - session.startX;
        const lastDy = touch.clientY - session.startY;
        // Apply delta and update startX/startY for incremental panning
        viewportRef.current.x += lastDx;
        viewportRef.current.y += lastDy;
        session.startX = touch.clientX;
        session.startY = touch.clientY;
      } else if (session.mode === "dragging" && session.node) {
        const { x, y } = toGraphCoords(touch.clientX, touch.clientY);
        session.node.fx = x;
        session.node.fy = y;
        if (simRef.current) simRef.current.alpha(0.3).restart();
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      e.preventDefault();
      const session = touchSessionRef.current;
      if (!session) return;

      // If a finger lifted from a pinch, leave the remaining finger as
      // a fresh single-touch session (don't continue pinch with one finger)
      if (session.mode === "pinching") {
        if (e.touches.length === 1) {
          const touch = e.touches[0];
          touchSessionRef.current = {
            mode: "panning",
            startX: touch.clientX,
            startY: touch.clientY,
            startTime: Date.now(),
            moved: true,
            node: null,
            initialPinchDist: 0,
            initialScale: 1,
            initialPinchCenter: { x: 0, y: 0 },
          };
          return;
        }
        if (e.touches.length === 0) {
          touchSessionRef.current = null;
          return;
        }
        return;
      }

      if (e.touches.length > 0) {
        // Some fingers still down — wait for the last lift
        return;
      }

      // All fingers up. If it was a quick stationary touch, treat as tap.
      const elapsed = Date.now() - session.startTime;
      if (
        session.mode === "tap-or-pan" &&
        !session.moved &&
        elapsed < 500
      ) {
        if (session.node && onNodeClick) {
          onNodeClick(session.node.id);
        }
      } else if (session.mode === "dragging" && session.node) {
        // Pin the node where it was dragged
        pin(session.node.id);
      }

      touchSessionRef.current = null;
    };

    const handleTouchCancel = () => {
      touchSessionRef.current = null;
    };

    canvas.addEventListener("touchstart", handleTouchStart, { passive: false });
    canvas.addEventListener("touchmove", handleTouchMove, { passive: false });
    canvas.addEventListener("touchend", handleTouchEnd, { passive: false });
    canvas.addEventListener("touchcancel", handleTouchCancel, { passive: false });

    return () => {
      canvas.removeEventListener("touchstart", handleTouchStart);
      canvas.removeEventListener("touchmove", handleTouchMove);
      canvas.removeEventListener("touchend", handleTouchEnd);
      canvas.removeEventListener("touchcancel", handleTouchCancel);
    };
  }, [toGraphCoords, findNodeAt, onNodeClick, pin]);

  const activeStyle = getStyleById(graphStyleId);
  const sc = activeStyle.controls;
  const st = activeStyle.tooltip;
  const nc = activeStyle.node.colors;

  return (
    <div ref={containerRef} className="w-full h-full relative overflow-hidden">
      <canvas
        ref={canvasRef}
        style={{ touchAction: "none" }}
        onMouseMove={handleMouseMove}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onMouseLeave={() => {
          draggingRef.current = null;
          dragStartRef.current = null;
          dragMovedRef.current = false;
          panningRef.current = null;
          hoveredIdRef.current = null;
          setHoveredNode(null);
        }}
        onWheel={handleWheel}
        onDoubleClick={handleDoubleClick}
      />

      {nodes.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-50">
          <p className="text-sm">Your knowledge graph will appear here</p>
        </div>
      )}

      {/* Chat-focus indicator */}
      {focusedIds.size > 0 && !hoveredNode && (
        <div className="absolute top-4 right-4 flex items-center gap-2 px-3 py-1.5 rounded-md bg-amber-100/95 backdrop-blur border border-amber-300 text-[11px] text-amber-900 shadow-sm">
          <span>
            Chat focus: {focusedIds.size} page{focusedIds.size === 1 ? "" : "s"}
          </span>
          <button
            onClick={clearFocus}
            className="text-amber-700 hover:text-amber-900 text-base leading-none"
            title="Clear chat focus"
          >
            ×
          </button>
        </div>
      )}

      {/* Hover tooltip */}
      {hoveredNode && (
        <div
          className={`absolute bottom-4 left-4 px-3 py-2 rounded-md ${st.bg} ${st.border} ${st.shadow} text-xs ${st.text} pointer-events-none max-w-xs`}
        >
          <div className="font-medium">{hoveredNode.title}</div>
          {hoveredNode.tags.length > 0 && (
            <div className={`${st.muted} text-[10px] mt-0.5`}>
              {hoveredNode.tags.join(" · ")}
            </div>
          )}
          <div className={`${st.muted} text-[10px] mt-0.5`}>
            {hoveredNode.linkCount} connection{hoveredNode.linkCount !== 1 ? "s" : ""}
          </div>
        </div>
      )}

      {/* Controls */}
      <div className="absolute bottom-4 right-4 flex flex-col gap-2 items-end">
        {/* Style selector */}
        <select
          value={graphStyleId}
          onChange={(e) => setGraphStyle(e.target.value)}
          className={`px-2.5 py-1.5 rounded-md ${sc.bg} border ${sc.border} text-xs ${sc.text} ${sc.hoverBg} ${sc.hoverBorder} transition cursor-pointer outline-none`}
        >
          {GRAPH_STYLES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <button
          onClick={() => setLabelsVisible((v) => !v)}
          title={labelsVisible ? "Hide labels for demo" : "Show labels"}
          className={`px-2.5 py-1.5 rounded-md border text-xs transition flex items-center gap-1.5 ${
            !labelsVisible
              ? "bg-amber-100/90 border-amber-300 text-amber-900 hover:bg-amber-100"
              : `${sc.bg} ${sc.border} ${sc.text} ${sc.hoverBg} ${sc.hoverBorder}`
          }`}
        >
          {labelsVisible ? "Labels: on" : "Labels: off"}
        </button>
        <button
          onClick={resetView}
          className={`px-2.5 py-1.5 rounded-md ${sc.bg} border ${sc.border} text-xs ${sc.text} ${sc.hoverBg} ${sc.hoverBorder} transition`}
        >
          Reset view
        </button>
      </div>

      {/* Legend (interactive) */}
      <Legend
        categories={categories}
        styleColors={nc}
        controls={sc}
        nodes={nodes}
        onToggle={toggleCategoryVisibility}
        onAdd={addCustomCategory}
        onRemove={removeCategory}
      />
    </div>
  );
}

function Legend({
  categories,
  styleColors,
  controls,
  nodes,
  onToggle,
  onAdd,
  onRemove,
}: {
  categories: Category[];
  styleColors: GraphStyle["node"]["colors"];
  controls: GraphStyle["controls"];
  nodes: Array<{ tags: string[] }>;
  onToggle: (id: string) => void;
  onAdd: (label: string, tag: string) => void;
  onRemove: (id: string) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);

  // Resolve a category to its display color
  const colorForCategory = (cat: Category): RGB => {
    if (cat.builtin) {
      switch (cat.id) {
        case "person":
          return styleColors.person;
        case "project":
          return styleColors.project;
        case "company":
          return styleColors.company;
        default:
          return styleColors.default;
      }
    }
    return cat.customColor ?? styleColors.default;
  };

  // Build the list of distinct tags currently in use across all nodes,
  // excluding tags that already have a category.
  const claimedTags = new Set<string>();
  for (const c of categories) {
    for (const t of c.tags) claimedTags.add(t);
  }
  const allTags = new Map<string, number>();
  for (const node of nodes) {
    for (const t of node.tags) {
      allTags.set(t, (allTags.get(t) ?? 0) + 1);
    }
  }
  const availableTags = [...allTags.entries()]
    .filter(([t]) => !claimedTags.has(t))
    .sort((a, b) => b[1] - a[1]);

  return (
    <div
      className={`absolute top-4 left-4 px-3 py-2.5 rounded-md ${controls.bg} border ${controls.border} text-[10px] ${controls.text} space-y-1.5`}
    >
      {categories.map((cat) => {
        const color = colorForCategory(cat);
        return (
          <div key={cat.id} className="flex items-center gap-2 group">
            <button
              onClick={() => onToggle(cat.id)}
              className="flex items-center gap-2 cursor-pointer"
              title={cat.visible ? "Hide" : "Show"}
            >
              <div
                className="w-2.5 h-2.5 rounded-full transition-opacity"
                style={{
                  background: `rgb(${color.r},${color.g},${color.b})`,
                  opacity: cat.visible ? 1 : 0.25,
                }}
              />
              <span
                className={`transition-opacity ${
                  cat.visible ? "" : "line-through opacity-40"
                }`}
              >
                {cat.label}
              </span>
            </button>
            {!cat.builtin && (
              <button
                onClick={() => onRemove(cat.id)}
                className="opacity-0 group-hover:opacity-100 hover:opacity-100 transition-opacity ml-1 leading-none text-current"
                title="Remove category"
              >
                ×
              </button>
            )}
          </div>
        );
      })}

      <div className="pt-1 border-t border-current/10">
        <button
          onClick={() => setPickerOpen((v) => !v)}
          className="flex items-center gap-1.5 cursor-pointer hover:opacity-100 opacity-60 transition-opacity"
          title="Add a category"
        >
          <span className="text-[12px] leading-none">+</span>
          <span>Category</span>
        </button>
      </div>

      {pickerOpen && (
        <CategoryPicker
          availableTags={availableTags}
          onPick={(tag) => {
            onAdd(capitalize(tag), tag);
            setPickerOpen(false);
          }}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}

function CategoryPicker({
  availableTags,
  onPick,
  onClose,
}: {
  availableTags: Array<[string, number]>;
  onPick: (tag: string) => void;
  onClose: () => void;
}) {
  const [filter, setFilter] = useState("");
  const filtered = availableTags.filter(([t]) =>
    t.toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <div className="absolute top-full left-0 mt-2 w-56 bg-white border border-zinc-200 rounded-md shadow-lg p-2 text-zinc-900 z-10">
      <div className="flex items-center justify-between mb-2 px-1">
        <span className="text-[10px] uppercase tracking-wider text-zinc-500">
          Add category from tag
        </span>
        <button
          onClick={onClose}
          className="text-zinc-400 hover:text-zinc-900 text-base leading-none"
          aria-label="Close picker"
        >
          ×
        </button>
      </div>
      <input
        type="text"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Filter tags…"
        className="w-full px-2 py-1 mb-2 text-[11px] rounded border border-zinc-200 focus:outline-none focus:border-zinc-400"
      />
      <div className="max-h-48 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="text-[11px] text-zinc-400 px-1 py-2">
            No matching tags. Add tags to your pages first.
          </div>
        ) : (
          filtered.map(([tag, count]) => (
            <button
              key={tag}
              onClick={() => onPick(tag)}
              className="w-full flex items-center justify-between px-2 py-1.5 text-[11px] text-left rounded hover:bg-zinc-100 transition"
            >
              <span className="truncate">{tag}</span>
              <span className="text-zinc-400 tabular-nums ml-2">{count}</span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

