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

  // Rendering engine — controls HOW shapes get drawn
  engine: "clean" | "sketchy" | "circuit";

  // Engine-specific tuning (optional)
  sketchy?: {
    roughness: number;       // 0 = clean, 1 = normal, 3 = very rough
    bowing: number;          // line curvature amount
    fillStyle?: "solid" | "hachure" | "cross-hatch" | "dots" | "zigzag" | "zigzag-line";
    fillWeight?: number;
    hachureGap?: number;
    hachureAngle?: number;
  };

  circuit?: {
    cornerRadius: number;    // radius for rounded 90° bends
    glow: number;            // glow blur amount, 0 to disable
    traceColor: RGB;         // override edge color (used for glow)
    dotGrid: boolean;        // use dot grid instead of line grid
  };
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

  engine: "clean",
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

  engine: "sketchy",
  sketchy: {
    roughness: 1.2,
    bowing: 1,
    fillStyle: "solid",
  },
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

  engine: "sketchy",
  sketchy: {
    roughness: 1.4,
    bowing: 1.2,
    fillStyle: "solid",
  },
};

// ─── Circuit ──────────────────────────────────────────────────

const CIRCUIT: GraphStyle = {
  id: "circuit",
  name: "Circuit",

  background: "#0a0e1a",

  grid: { color: "rgba(56, 189, 248, 0.18)", opacity: 1 },

  edge: {
    explicit: {
      color: { r: 56, g: 189, b: 248 },  // cyan trace
      opacity: 0.85,
      width: 1.5,
      dash: [],
    },
    semantic: {
      color: { r: 56, g: 189, b: 248 },
      opacityScale: 0.7,
      widthBase: 1,
      widthScale: 1,
      dash: [2, 4],
    },
    dimOpacity: 0.15,
  },

  node: {
    colors: {
      person: { r: 244, g: 114, b: 182 },  // hot pink
      project: { r: 74, g: 222, b: 128 },   // bright green
      company: { r: 251, g: 191, b: 36 },   // amber
      default: { r: 56, g: 189, b: 248 },   // cyan
    },
    borderColor: { r: 240, g: 250, b: 255 },
    borderWidth: 1.5,
    pinnedBorderColor: { r: 255, g: 255, b: 255 },
    pinnedBorderWidth: 3,
    dimOpacity: 0.2,
    freshGlow: { r: 56, g: 189, b: 248 },
    freshFill: { r: 125, g: 211, b: 252 },
  },

  label: {
    font: "'JetBrains Mono', 'SF Mono', 'Consolas', monospace",
    fontWeight: "500",
    hoverFontWeight: "600",
    size: 11,
    hoverSize: 12,
    color: { r: 224, g: 242, b: 254 },
    bgColor: "rgba(10, 14, 26, 0.92)",
    bgOpacity: 0.92,
  },

  tooltip: {
    bg: "bg-[#0a0e1a]/95 backdrop-blur",
    border: "border border-cyan-900/50",
    text: "text-cyan-100",
    muted: "text-cyan-400/60",
    shadow: "shadow-[0_0_20px_rgba(56,189,248,0.15)]",
  },

  controls: {
    bg: "bg-[#0a0e1a]/90 backdrop-blur",
    border: "border-cyan-900/50",
    text: "text-cyan-200",
    hoverBg: "hover:bg-[#111729]",
    hoverBorder: "hover:border-cyan-700",
  },

  engine: "circuit",
  circuit: {
    cornerRadius: 12,
    glow: 6,
    traceColor: { r: 56, g: 189, b: 248 },
    dotGrid: true,
  },
};

// ─── Exports ──────────────────────────────────────────────────

export const GRAPH_STYLES: GraphStyle[] = [CLEAN, CHALKBOARD, WHITEBOARD, CIRCUIT];

export function getStyleById(id: string): GraphStyle {
  return GRAPH_STYLES.find((s) => s.id === id) ?? CLEAN;
}

// ─── Drawing helpers ──────────────────────────────────────────

export function rgba(c: RGB, opacity: number): string {
  return `rgba(${c.r}, ${c.g}, ${c.b}, ${opacity})`;
}

/**
 * Stable seed for a string ID. rough.js takes a numeric seed and produces
 * deterministic output for the same seed — so an edge always wobbles the
 * same way regardless of frame.
 */
export function hashSeed(...parts: string[]): number {
  const str = parts.join("|");
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = (h * 33) ^ str.charCodeAt(i);
  }
  return Math.abs(h) % 2147483647;
}

/**
 * Draw an orthogonal (right-angle) path from (x1,y1) to (x2,y2) with
 * a single elbow and a rounded corner of the given radius. The elbow
 * direction (horizontal-first vs vertical-first) is chosen by the seed.
 */
export function drawOrthogonalPath(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  radius: number,
  seed: number
) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const sx = Math.sign(dx);
  const sy = Math.sign(dy);
  const horizontalFirst = (seed & 1) === 0;

  // If shapes are essentially aligned, just draw a straight line
  if (Math.abs(dx) < 1 || Math.abs(dy) < 1) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    return;
  }

  // Clamp radius so it never overshoots either leg
  const r = Math.min(radius, Math.abs(dx) / 2, Math.abs(dy) / 2);

  ctx.beginPath();
  ctx.moveTo(x1, y1);
  if (horizontalFirst) {
    // Horizontal leg, then vertical leg, with rounded corner at (x2, y1)
    ctx.lineTo(x2 - sx * r, y1);
    ctx.quadraticCurveTo(x2, y1, x2, y1 + sy * r);
    ctx.lineTo(x2, y2);
  } else {
    // Vertical leg, then horizontal leg, with rounded corner at (x1, y2)
    ctx.lineTo(x1, y2 - sy * r);
    ctx.quadraticCurveTo(x1, y2, x1 + sx * r, y2);
    ctx.lineTo(x2, y2);
  }
  ctx.stroke();
}
