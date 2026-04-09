export interface RGB {
  r: number;
  g: number;
  b: number;
}

export interface GraphStyle {
  id: string;
  name: string;

  background: string;

  grid: {
    color: string;
    opacity: number;
  } | null;

  edge: {
    explicit: { color: RGB; opacity: number; width: number; dash: number[] };
    semantic: {
      color: RGB;
      opacityScale: number;
      widthBase: number;
      widthScale: number;
      dash: number[];
    };
    dimOpacity: number;
  };

  node: {
    colors: { person: RGB; project: RGB; company: RGB; default: RGB };
    borderColor: RGB;
    borderWidth: number;
    pinnedBorderColor: RGB;
    pinnedBorderWidth: number;
    dimOpacity: number;
    freshGlow: RGB;
    freshFill: RGB;
  };

  label: {
    font: string;
    fontWeight: string;
    hoverFontWeight: string;
    size: number;
    hoverSize: number;
    color: RGB;
    bgColor: string; // rgba string
    bgOpacity: number;
  };

  tooltip: {
    bg: string;
    border: string;
    text: string;
    muted: string;
    shadow: string;
  };

  controls: {
    bg: string;
    border: string;
    text: string;
    hoverBg: string;
    hoverBorder: string;
  };

  // Visual effects
  handDrawn: boolean; // Adds jitter to lines and node outlines
  jitterAmount: number;
}

// ─── Clean (default) ──────────────────────────────────────────

const CLEAN: GraphStyle = {
  id: "clean",
  name: "Clean",

  background: "#ffffff",

  grid: { color: "rgba(228, 228, 231, 0.6)", opacity: 1 },

  edge: {
    explicit: {
      color: { r: 24, g: 24, b: 27 },
      opacity: 0.55,
      width: 1.2,
      dash: [],
    },
    semantic: {
      color: { r: 24, g: 24, b: 27 },
      opacityScale: 0.5,
      widthBase: 0.8,
      widthScale: 1.5,
      dash: [3, 4],
    },
    dimOpacity: 0.15,
  },

  node: {
    colors: {
      person: { r: 167, g: 139, b: 250 },
      project: { r: 52, g: 211, b: 153 },
      company: { r: 251, g: 146, b: 60 },
      default: { r: 96, g: 165, b: 250 },
    },
    borderColor: { r: 24, g: 24, b: 27 },
    borderWidth: 1,
    pinnedBorderColor: { r: 24, g: 24, b: 27 },
    pinnedBorderWidth: 2.5,
    dimOpacity: 0.25,
    freshGlow: { r: 251, g: 191, b: 36 },
    freshFill: { r: 245, g: 158, b: 11 },
  },

  label: {
    font: "-apple-system, Inter, sans-serif",
    fontWeight: "500",
    hoverFontWeight: "600",
    size: 11,
    hoverSize: 12,
    color: { r: 24, g: 24, b: 27 },
    bgColor: "rgba(255, 255, 255, 0.95)",
    bgOpacity: 0.95,
  },

  tooltip: {
    bg: "bg-white/95 backdrop-blur",
    border: "border border-zinc-200",
    text: "text-zinc-900",
    muted: "text-zinc-400",
    shadow: "shadow-sm",
  },

  controls: {
    bg: "bg-white/95 backdrop-blur",
    border: "border-zinc-200",
    text: "text-zinc-700",
    hoverBg: "hover:bg-zinc-50",
    hoverBorder: "hover:border-zinc-300",
  },

  handDrawn: false,
  jitterAmount: 0,
};

// ─── Chalkboard ───────────────────────────────────────────────

const CHALKBOARD: GraphStyle = {
  id: "chalkboard",
  name: "Chalkboard",

  background: "#2a473a",

  grid: null,

  edge: {
    explicit: {
      color: { r: 220, g: 215, b: 200 },
      opacity: 0.45,
      width: 1.5,
      dash: [],
    },
    semantic: {
      color: { r: 220, g: 215, b: 200 },
      opacityScale: 0.5,
      widthBase: 1,
      widthScale: 1.5,
      dash: [5, 6],
    },
    dimOpacity: 0.12,
  },

  node: {
    colors: {
      person: { r: 255, g: 182, b: 193 },  // pastel pink
      project: { r: 152, g: 251, b: 190 },  // pastel green
      company: { r: 255, g: 218, b: 140 },  // pastel yellow
      default: { r: 162, g: 200, b: 255 },  // pastel blue
    },
    borderColor: { r: 220, g: 215, b: 200 },
    borderWidth: 1.5,
    pinnedBorderColor: { r: 255, g: 255, b: 240 },
    pinnedBorderWidth: 3,
    dimOpacity: 0.2,
    freshGlow: { r: 255, g: 255, b: 200 },
    freshFill: { r: 255, g: 240, b: 150 },
  },

  label: {
    font: "'Caveat', cursive",
    fontWeight: "600",
    hoverFontWeight: "700",
    size: 15,
    hoverSize: 17,
    color: { r: 230, g: 225, b: 210 },
    bgColor: "rgba(42, 71, 58, 0.85)",
    bgOpacity: 0.85,
  },

  tooltip: {
    bg: "bg-[#1e3529]/95 backdrop-blur",
    border: "border border-[#3d6b52]",
    text: "text-[#e6e1d2]",
    muted: "text-[#8aad9a]",
    shadow: "shadow-lg",
  },

  controls: {
    bg: "bg-[#1e3529]/90 backdrop-blur",
    border: "border-[#3d6b52]",
    text: "text-[#c8c3b4]",
    hoverBg: "hover:bg-[#2a473a]",
    hoverBorder: "hover:border-[#5a9473]",
  },

  handDrawn: true,
  jitterAmount: 2.5,
};

// ─── Whiteboard ───────────────────────────────────────────────

const WHITEBOARD: GraphStyle = {
  id: "whiteboard",
  name: "Whiteboard",

  background: "#f8f8f6",

  grid: { color: "rgba(180, 190, 200, 0.25)", opacity: 1 },

  edge: {
    explicit: {
      color: { r: 30, g: 30, b: 30 },
      opacity: 0.7,
      width: 2,
      dash: [],
    },
    semantic: {
      color: { r: 30, g: 30, b: 30 },
      opacityScale: 0.6,
      widthBase: 1,
      widthScale: 2,
      dash: [4, 5],
    },
    dimOpacity: 0.1,
  },

  node: {
    colors: {
      person: { r: 220, g: 50, b: 50 },   // red
      project: { r: 30, g: 140, b: 60 },   // green
      company: { r: 230, g: 160, b: 0 },   // yellow-orange
      default: { r: 35, g: 100, b: 210 },  // blue
    },
    borderColor: { r: 30, g: 30, b: 30 },
    borderWidth: 2,
    pinnedBorderColor: { r: 0, g: 0, b: 0 },
    pinnedBorderWidth: 3.5,
    dimOpacity: 0.2,
    freshGlow: { r: 255, g: 200, b: 50 },
    freshFill: { r: 255, g: 180, b: 0 },
  },

  label: {
    font: "'Patrick Hand', cursive",
    fontWeight: "400",
    hoverFontWeight: "400",
    size: 14,
    hoverSize: 16,
    color: { r: 30, g: 30, b: 30 },
    bgColor: "rgba(248, 248, 246, 0.9)",
    bgOpacity: 0.9,
  },

  tooltip: {
    bg: "bg-white/95 backdrop-blur",
    border: "border border-zinc-300",
    text: "text-zinc-900",
    muted: "text-zinc-500",
    shadow: "shadow-md",
  },

  controls: {
    bg: "bg-white/95 backdrop-blur",
    border: "border-zinc-300",
    text: "text-zinc-800",
    hoverBg: "hover:bg-zinc-100",
    hoverBorder: "hover:border-zinc-400",
  },

  handDrawn: true,
  jitterAmount: 3,
};

// ─── Exports ──────────────────────────────────────────────────

export const GRAPH_STYLES: GraphStyle[] = [CLEAN, CHALKBOARD, WHITEBOARD];

export function getStyleById(id: string): GraphStyle {
  return GRAPH_STYLES.find((s) => s.id === id) ?? CLEAN;
}

// ─── Drawing helpers ──────────────────────────────────────────

export function rgba(c: RGB, opacity: number): string {
  return `rgba(${c.r}, ${c.g}, ${c.b}, ${opacity})`;
}

/** Draw a line with optional hand-drawn jitter */
export function drawLine(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  style: GraphStyle
) {
  if (!style.handDrawn) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    return;
  }

  const j = style.jitterAmount;
  const mx = (x1 + x2) / 2 + (Math.random() - 0.5) * j * 3;
  const my = (y1 + y2) / 2 + (Math.random() - 0.5) * j * 3;
  ctx.beginPath();
  ctx.moveTo(x1 + (Math.random() - 0.5) * j, y1 + (Math.random() - 0.5) * j);
  ctx.quadraticCurveTo(mx, my, x2 + (Math.random() - 0.5) * j, y2 + (Math.random() - 0.5) * j);
  ctx.stroke();
}

/** Draw a circle with optional hand-drawn jitter */
export function drawCircle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  style: GraphStyle
) {
  if (!style.handDrawn) {
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, 2 * Math.PI);
    return;
  }

  const j = style.jitterAmount * 0.4;
  const steps = 24;
  ctx.beginPath();
  for (let i = 0; i <= steps; i++) {
    const angle = (i / steps) * 2 * Math.PI;
    const r = radius + (Math.random() - 0.5) * j * 2;
    const px = x + Math.cos(angle) * r;
    const py = y + Math.sin(angle) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}
