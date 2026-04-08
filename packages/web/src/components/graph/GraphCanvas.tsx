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
import { useGraphStore } from "../../hooks/useGraph.js";

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
  const adjacencyRef = useRef<Map<string, Set<string>>>(new Map());
  const pinnedRef = useRef<Set<string>>(new Set());
  const [hoveredNode, setHoveredNode] = useState<SimNode | null>(null);

  const { nodes, edges, freshNodes } = useGraphStore();

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
      const isPinned = pinnedRef.current.has(n.id);
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
        fx: isPinned ? old?.x : undefined,
        fy: isPinned ? old?.y : undefined,
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
  }, [nodes, edges, freshNodes]);

  // Initialize simulation + render loop
  useEffect(() => {
    const canvas = canvasRef.current!;
    const container = containerRef.current!;

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
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      // Background grid (subtle)
      drawGrid(ctx, container.clientWidth, container.clientHeight, viewportRef.current);

      // Apply pan/zoom
      const vp = viewportRef.current;
      ctx.translate(vp.x, vp.y);
      ctx.scale(vp.scale, vp.scale);

      const currentNodes = nodesRef.current;
      const currentLinks = linksRef.current;
      const hoveredId = hoveredIdRef.current;
      const adj = adjacencyRef.current;
      const showLabels = vp.scale > 0.55;

      // Determine highlight set
      let highlightSet: Set<string> | null = null;
      if (hoveredId) {
        highlightSet = new Set([hoveredId]);
        const neighbors = adj.get(hoveredId);
        if (neighbors) for (const n of neighbors) highlightSet.add(n);
      }

      // Draw edges
      for (const link of currentLinks) {
        const source = link.source as SimNode;
        const target = link.target as SimNode;
        if (source.x == null || target.x == null) continue;

        const isHighlighted =
          !highlightSet ||
          (highlightSet.has(source.id) && highlightSet.has(target.id));
        const opacity = isHighlighted ? 1 : 0.15;

        ctx.beginPath();
        ctx.moveTo(source.x, source.y!);
        ctx.lineTo(target.x, target.y!);

        if (link.type === "explicit") {
          ctx.strokeStyle = `rgba(82, 82, 91, ${0.7 * opacity})`;
          ctx.lineWidth = 1.2;
          ctx.setLineDash([]);
        } else {
          ctx.strokeStyle = `rgba(63, 63, 70, ${link.weight * 0.6 * opacity})`;
          ctx.lineWidth = 0.8 + link.weight * 1.5;
          ctx.setLineDash([3, 4]);
        }
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Draw nodes
      for (const node of currentNodes) {
        if (node.x == null) continue;
        const isHovered = node.id === hoveredId;
        const isHighlighted = !highlightSet || highlightSet.has(node.id);
        const opacity = isHighlighted ? 1 : 0.25;

        const baseRadius = 7 + Math.min(node.linkCount * 1.6, 14);
        const radius = isHovered ? baseRadius * 1.15 : baseRadius;

        // Glow for fresh nodes
        if (node.isFresh) {
          ctx.beginPath();
          ctx.arc(node.x, node.y!, radius + 8, 0, 2 * Math.PI);
          ctx.fillStyle = `rgba(251, 191, 36, ${0.35 * opacity})`;
          ctx.fill();
        }

        ctx.beginPath();
        ctx.arc(node.x, node.y!, radius, 0, 2 * Math.PI);
        ctx.fillStyle = node.isFresh
          ? `rgba(245, 158, 11, ${opacity})`
          : applyOpacity(getNodeColor(node.tags), opacity);
        ctx.fill();
        ctx.strokeStyle = node.fixed
          ? `rgba(24, 24, 27, ${0.9 * opacity})`
          : `rgba(255, 255, 255, ${0.95 * opacity})`;
        ctx.lineWidth = node.fixed ? 2 : 1.5;
        ctx.stroke();

        // Label
        if (showLabels && (isHighlighted || isHovered)) {
          const fontSize = isHovered ? 12 : 11;
          ctx.font = `${isHovered ? "600" : "500"} ${fontSize}px -apple-system, Inter, sans-serif`;
          ctx.textAlign = "center";

          // Background for readability
          const text = node.title;
          const metrics = ctx.measureText(text);
          const padX = 4;
          const labelY = node.y! + radius + 4;
          ctx.fillStyle = `rgba(255, 255, 255, ${0.92 * opacity})`;
          ctx.fillRect(
            node.x - metrics.width / 2 - padX,
            labelY,
            metrics.width + padX * 2,
            fontSize + 4
          );
          ctx.fillStyle = `rgba(24, 24, 27, ${opacity})`;
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
          // Real drag — pin the node
          pinnedRef.current.add(wasDragging.id);
          wasDragging.fixed = true;
        } else {
          // No mouse movement — treat as click
          if (!pinnedRef.current.has(wasDragging.id)) {
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
      const { x, y } = toGraphCoords(e.clientX, e.clientY);
      const node = findNodeAt(x, y);
      if (node && pinnedRef.current.has(node.id)) {
        // Unpin
        pinnedRef.current.delete(node.id);
        node.fx = undefined;
        node.fy = undefined;
        node.fixed = false;
        if (simRef.current) simRef.current.alpha(0.3).restart();
      }
    },
    [toGraphCoords, findNodeAt]
  );

  const resetView = useCallback(() => {
    viewportRef.current = { x: 0, y: 0, scale: 1 };
    if (simRef.current) simRef.current.alpha(0.5).restart();
  }, []);

  return (
    <div ref={containerRef} className="w-full h-full bg-zinc-950 relative overflow-hidden">
      <canvas
        ref={canvasRef}
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
        <div className="absolute inset-0 flex items-center justify-center text-zinc-600 pointer-events-none">
          <p className="text-sm">Your knowledge graph will appear here</p>
        </div>
      )}

      {/* Hover tooltip */}
      {hoveredNode && (
        <div className="absolute bottom-4 left-4 px-3 py-2 rounded-md bg-zinc-900/90 backdrop-blur border border-zinc-700 text-xs text-zinc-100 pointer-events-none max-w-xs">
          <div className="font-medium">{hoveredNode.title}</div>
          {hoveredNode.tags.length > 0 && (
            <div className="text-zinc-400 text-[10px] mt-0.5">
              {hoveredNode.tags.join(" · ")}
            </div>
          )}
          <div className="text-zinc-500 text-[10px] mt-0.5">
            {hoveredNode.linkCount} connection{hoveredNode.linkCount !== 1 ? "s" : ""}
          </div>
        </div>
      )}

      {/* Controls */}
      <div className="absolute bottom-4 right-4 flex flex-col gap-2">
        <button
          onClick={resetView}
          className="px-2.5 py-1.5 rounded-md bg-zinc-900/80 backdrop-blur border border-zinc-700 text-xs text-zinc-200 hover:bg-zinc-800 transition"
        >
          Reset view
        </button>
      </div>

      {/* Legend */}
      <div className="absolute top-4 left-4 px-3 py-2.5 rounded-md bg-zinc-900/80 backdrop-blur border border-zinc-700 text-[10px] text-zinc-300 space-y-1.5 pointer-events-none">
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-violet-400" />
          <span>Person</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
          <span>Project</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-orange-400" />
          <span>Company</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-blue-400" />
          <span>Concept</span>
        </div>
      </div>
    </div>
  );
}

function getNodeColor(tags: string[]): { r: number; g: number; b: number } {
  if (tags.includes("person")) return { r: 167, g: 139, b: 250 }; // violet
  if (tags.includes("project")) return { r: 52, g: 211, b: 153 }; // emerald
  if (tags.includes("company") || tags.includes("organization"))
    return { r: 251, g: 146, b: 60 }; // orange
  return { r: 96, g: 165, b: 250 }; // blue
}

function applyOpacity(c: { r: number; g: number; b: number }, opacity: number): string {
  return `rgba(${c.r}, ${c.g}, ${c.b}, ${opacity})`;
}

function drawGrid(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  vp: Viewport
) {
  const baseSize = 50;
  const size = baseSize * vp.scale;
  const offsetX = vp.x % size;
  const offsetY = vp.y % size;

  ctx.strokeStyle = "rgba(63, 63, 70, 0.15)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = offsetX; x < width; x += size) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
  }
  for (let y = offsetY; y < height; y += size) {
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
  }
  ctx.stroke();
}
