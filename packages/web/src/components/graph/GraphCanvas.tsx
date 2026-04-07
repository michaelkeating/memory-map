import { useEffect, useRef, useCallback } from "react";
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
}

interface SimLink extends SimulationLinkDatum<SimNode> {
  type: string;
  weight: number;
}

export function GraphCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const simRef = useRef<ReturnType<typeof forceSimulation<SimNode>> | null>(null);
  const nodesRef = useRef<SimNode[]>([]);
  const linksRef = useRef<SimLink[]>([]);
  const animRef = useRef<number>(0);
  const { nodes, edges, freshNodes } = useGraphStore();

  // Map graph store data to simulation data, preserving positions
  useEffect(() => {
    const oldNodeMap = new Map(nodesRef.current.map((n) => [n.id, n]));

    const simNodes: SimNode[] = nodes.map((n) => {
      const old = oldNodeMap.get(n.id);
      return {
        id: n.id,
        title: n.title,
        tags: n.tags,
        linkCount: n.linkCount,
        isFresh: freshNodes.has(n.id),
        // Preserve existing position or randomize
        x: old?.x ?? undefined,
        y: old?.y ?? undefined,
        vx: old?.vx ?? undefined,
        vy: old?.vy ?? undefined,
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

    // Update or create simulation
    if (simRef.current) {
      simRef.current.nodes(simNodes);
      const linkForce = simRef.current.force("link") as ReturnType<typeof forceLink> | undefined;
      if (linkForce) {
        (linkForce as any).links(simLinks);
      }
      simRef.current.alpha(0.3).restart();
    }
  }, [nodes, edges, freshNodes]);

  // Initialize simulation and render loop
  useEffect(() => {
    const canvas = canvasRef.current!;
    const container = containerRef.current!;

    const resize = () => {
      canvas.width = container.clientWidth * devicePixelRatio;
      canvas.height = container.clientHeight * devicePixelRatio;
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
          .distance(120)
          .strength((d) => d.weight * 0.3)
      )
      .force("charge", forceManyBody().strength(-300))
      .force(
        "center",
        forceCenter(container.clientWidth / 2, container.clientHeight / 2)
      )
      .force("collide", forceCollide(35))
      .alphaDecay(0.02);

    simRef.current = sim;

    // Render loop
    const ctx = canvas.getContext("2d")!;
    function render() {
      const w = canvas.width;
      const h = canvas.height;
      const dpr = devicePixelRatio;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const currentNodes = nodesRef.current;
      const currentLinks = linksRef.current;

      // Draw edges
      for (const link of currentLinks) {
        const source = link.source as SimNode;
        const target = link.target as SimNode;
        if (source.x == null || target.x == null) continue;

        ctx.beginPath();
        ctx.moveTo(source.x, source.y!);
        ctx.lineTo(target.x, target.y!);

        if (link.type === "explicit") {
          ctx.strokeStyle = "rgba(148, 163, 184, 0.4)";
          ctx.lineWidth = 1.5;
          ctx.setLineDash([]);
        } else {
          ctx.strokeStyle = `rgba(59, 130, 246, ${link.weight * 0.6})`;
          ctx.lineWidth = 1 + link.weight * 2;
          ctx.setLineDash([4, 4]);
        }
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Draw nodes
      for (const node of currentNodes) {
        if (node.x == null) continue;
        const radius = 8 + Math.min(node.linkCount * 2, 16);
        const isFresh = node.isFresh;

        // Glow for fresh nodes
        if (isFresh) {
          ctx.beginPath();
          ctx.arc(node.x, node.y!, radius + 6, 0, 2 * Math.PI);
          ctx.fillStyle = "rgba(251, 191, 36, 0.3)";
          ctx.fill();
        }

        ctx.beginPath();
        ctx.arc(node.x, node.y!, radius, 0, 2 * Math.PI);
        ctx.fillStyle = isFresh ? "#f59e0b" : getNodeColor(node.tags);
        ctx.fill();
        ctx.strokeStyle = "rgba(255, 255, 255, 0.8)";
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Label
        ctx.fillStyle = "#e5e7eb";
        ctx.font = "11px Inter, -apple-system, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(node.title, node.x, node.y! + radius + 14);
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

  // Handle hover tooltip
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    let hovering = false;
    for (const node of nodesRef.current) {
      if (node.x == null) continue;
      const dx = node.x - x;
      const dy = node.y! - y;
      const radius = 8 + Math.min(node.linkCount * 2, 16);
      if (dx * dx + dy * dy < radius * radius) {
        canvas.style.cursor = "pointer";
        canvas.title = node.title;
        hovering = true;
        break;
      }
    }
    if (!hovering) {
      canvas.style.cursor = "default";
      canvas.title = "";
    }
  }, []);

  return (
    <div ref={containerRef} className="w-full h-full bg-gray-950 relative">
      <canvas ref={canvasRef} onMouseMove={handleMouseMove} />
      {nodes.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center text-gray-600">
          <p>Your knowledge graph will appear here</p>
        </div>
      )}
    </div>
  );
}

function getNodeColor(tags: string[]): string {
  if (tags.includes("person")) return "#a78bfa"; // purple
  if (tags.includes("project")) return "#34d399"; // green
  if (tags.includes("company")) return "#fb923c"; // orange
  return "#3b82f6"; // blue default
}
