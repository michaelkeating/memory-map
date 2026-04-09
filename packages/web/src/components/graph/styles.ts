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
  engine: "clean" | "sketchy" | "circuit" | "subway" | "starchart";

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

  subway?: {
    palette: RGB[];          // line colors, picked per-edge by hash
    lineWidth: number;       // base line thickness
    cornerRadius: number;    // 45° corner radius
    stationFill: RGB;        // node fill color
    stationStroke: RGB;      // node border color
  };

  starchart?: {
    bgStarDensity: number;   // approximate stars per 1000px²
    bgStarColors: RGB[];     // palette for background stars
    constellationOpacity: number;
    glow: number;
    starColors: RGB[];       // palette for foreground (graph node) stars
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

// ─── Subway (NYC) ─────────────────────────────────────────────

const SUBWAY: GraphStyle = {
  id: "subway",
  name: "Subway",

  background: "#f5efe0",  // warm cream like the Vignelli map paper

  grid: null,

  edge: {
    explicit: {
      color: { r: 0, g: 0, b: 0 },  // overridden per edge
      opacity: 1,
      width: 6,
      dash: [],
    },
    semantic: {
      color: { r: 0, g: 0, b: 0 },
      opacityScale: 1,
      widthBase: 4,
      widthScale: 2,
      dash: [],
    },
    dimOpacity: 0.18,
  },

  node: {
    colors: {
      person: { r: 30, g: 30, b: 30 },
      project: { r: 30, g: 30, b: 30 },
      company: { r: 30, g: 30, b: 30 },
      default: { r: 30, g: 30, b: 30 },
    },
    borderColor: { r: 30, g: 30, b: 30 },
    borderWidth: 3,
    pinnedBorderColor: { r: 30, g: 30, b: 30 },
    pinnedBorderWidth: 4.5,
    dimOpacity: 0.25,
    freshGlow: { r: 251, g: 191, b: 36 },
    freshFill: { r: 251, g: 191, b: 36 },
  },

  label: {
    font: "'Helvetica Neue', Helvetica, Arial, sans-serif",
    fontWeight: "700",
    hoverFontWeight: "700",
    size: 11,
    hoverSize: 13,
    color: { r: 30, g: 30, b: 30 },
    bgColor: "rgba(245, 239, 224, 0.95)",
    bgOpacity: 0.95,
  },

  tooltip: {
    bg: "bg-[#f5efe0]/95 backdrop-blur",
    border: "border border-zinc-800",
    text: "text-zinc-900",
    muted: "text-zinc-600",
    shadow: "shadow-md",
  },

  controls: {
    bg: "bg-[#f5efe0]/95 backdrop-blur",
    border: "border-zinc-800",
    text: "text-zinc-900",
    hoverBg: "hover:bg-[#ebe2c8]",
    hoverBorder: "hover:border-zinc-900",
  },

  engine: "subway",
  subway: {
    // MTA-inspired palette
    palette: [
      { r: 238, g: 53, b: 36 },    // 1/2/3 red
      { r: 0, g: 147, b: 60 },     // 4/5/6 green
      { r: 185, g: 51, b: 173 },   // 7 purple
      { r: 0, g: 57, b: 166 },     // A/C/E blue
      { r: 255, g: 99, b: 25 },    // B/D/F/M orange
      { r: 252, g: 204, b: 10 },   // N/Q/R/W yellow
      { r: 167, g: 169, b: 172 },  // L gray
      { r: 153, g: 99, b: 54 },    // J/Z brown
      { r: 108, g: 190, b: 69 },   // G lime
    ],
    lineWidth: 6,
    cornerRadius: 18,
    stationFill: { r: 255, g: 255, b: 255 },
    stationStroke: { r: 30, g: 30, b: 30 },
  },
};

// ─── Star Chart ───────────────────────────────────────────────

const STARCHART: GraphStyle = {
  id: "starchart",
  name: "Star Chart",

  background: "#06091a",  // deep space

  grid: null,

  edge: {
    explicit: {
      color: { r: 200, g: 220, b: 255 },
      opacity: 0.55,
      width: 0.8,
      dash: [],
    },
    semantic: {
      color: { r: 200, g: 220, b: 255 },
      opacityScale: 0.4,
      widthBase: 0.6,
      widthScale: 0.8,
      dash: [2, 5],
    },
    dimOpacity: 0.1,
  },

  node: {
    colors: {
      person: { r: 255, g: 220, b: 200 },   // warm white
      project: { r: 200, g: 230, b: 255 },  // cool white
      company: { r: 255, g: 240, b: 180 },  // pale yellow
      default: { r: 240, g: 240, b: 255 },  // pure white
    },
    borderColor: { r: 255, g: 255, b: 255 },
    borderWidth: 0,
    pinnedBorderColor: { r: 200, g: 220, b: 255 },
    pinnedBorderWidth: 2,
    dimOpacity: 0.3,
    freshGlow: { r: 255, g: 240, b: 200 },
    freshFill: { r: 255, g: 240, b: 200 },
  },

  label: {
    font: "'Cormorant Garamond', 'Iowan Old Style', Georgia, serif",
    fontWeight: "400",
    hoverFontWeight: "600",
    size: 14,
    hoverSize: 16,
    color: { r: 220, g: 230, b: 255 },
    bgColor: "rgba(6, 9, 26, 0.85)",
    bgOpacity: 0.85,
  },

  tooltip: {
    bg: "bg-[#06091a]/95 backdrop-blur",
    border: "border border-indigo-900/50",
    text: "text-indigo-100",
    muted: "text-indigo-400/60",
    shadow: "shadow-[0_0_24px_rgba(99,102,241,0.2)]",
  },

  controls: {
    bg: "bg-[#06091a]/90 backdrop-blur",
    border: "border-indigo-900/50",
    text: "text-indigo-200",
    hoverBg: "hover:bg-[#0d1130]",
    hoverBorder: "hover:border-indigo-700",
  },

  engine: "starchart",
  starchart: {
    bgStarDensity: 0.0008,
    bgStarColors: [
      { r: 255, g: 255, b: 255 },
      { r: 220, g: 230, b: 255 },
      { r: 255, g: 240, b: 220 },
      { r: 200, g: 220, b: 255 },
    ],
    constellationOpacity: 0.55,
    glow: 8,
    starColors: [
      { r: 255, g: 255, b: 255 },
      { r: 220, g: 230, b: 255 },
      { r: 255, g: 240, b: 200 },
    ],
  },
};

// ─── Exports ──────────────────────────────────────────────────

export const GRAPH_STYLES: GraphStyle[] = [
  CLEAN,
  CHALKBOARD,
  WHITEBOARD,
  CIRCUIT,
  SUBWAY,
  STARCHART,
];

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
 * Draw a subway-style path: short straight runs joined by a 45° diagonal.
 * The Vignelli NYC subway aesthetic — never an arbitrary angle.
 * The elbow direction (HV vs VH) is picked by seed.
 */
export function drawSubwayPath(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  cornerRadius: number,
  seed: number
) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const adx = Math.abs(dx);
  const ady = Math.abs(dy);

  if (adx < 2 || ady < 2) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    return;
  }

  const diag = Math.min(adx, ady);
  const sx = Math.sign(dx);
  const sy = Math.sign(dy);
  const horizontalFirst = (seed & 1) === 0;

  ctx.beginPath();
  ctx.moveTo(x1, y1);
  if (horizontalFirst) {
    const breakX = x2 - sx * diag;
    ctx.lineTo(breakX, y1);
    ctx.lineTo(x2, y1 + sy * diag);
    ctx.lineTo(x2, y2);
  } else {
    const breakY = y2 - sy * diag;
    ctx.lineTo(x1, breakY);
    ctx.lineTo(x1 + sx * diag, y2);
    ctx.lineTo(x2, y2);
  }
  void cornerRadius;
  ctx.stroke();
}

/** Pick a stable item from a palette by seed */
export function pickFromPalette<T>(palette: T[], seed: number): T {
  return palette[seed % palette.length];
}

/**
 * Deterministic background starfield rendered in SCREEN coordinates.
 * Stars are placed in a grid of cells, position+brightness seeded by
 * the cell index so they don't shift around with pan/zoom.
 */
export function drawStarfield(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  panX: number,
  panY: number,
  cellSize: number,
  density: number,
  colors: RGB[]
) {
  const starsPerCell = Math.max(1, Math.round(density * cellSize * cellSize));
  // World coords visible on screen — use pan offset (no zoom for bg stars)
  const minX = Math.floor(-panX / cellSize) - 1;
  const minY = Math.floor(-panY / cellSize) - 1;
  const maxX = Math.ceil((-panX + width) / cellSize) + 1;
  const maxY = Math.ceil((-panY + height) / cellSize) + 1;

  for (let cy = minY; cy <= maxY; cy++) {
    for (let cx = minX; cx <= maxX; cx++) {
      let h = (cx * 374761393) ^ (cy * 668265263);
      h = ((h << 13) ^ h) >>> 0;
      const baseSeed = (h * 1274126177) >>> 0;

      for (let i = 0; i < starsPerCell; i++) {
        const s1 = ((baseSeed + i * 2654435761) >>> 0) / 0xffffffff;
        const s2 = ((baseSeed + i * 1597463007) >>> 0) / 0xffffffff;
        const s3 = ((baseSeed + i * 2246822519) >>> 0) / 0xffffffff;
        const s4 = ((baseSeed + i * 3266489917) >>> 0) / 0xffffffff;

        const px = cx * cellSize + s1 * cellSize + panX;
        const py = cy * cellSize + s2 * cellSize + panY;
        if (px < 0 || px > width || py < 0 || py > height) continue;

        const brightness = 0.3 + s3 * 0.7;
        const radius = 0.4 + s4 * 1.2;
        const color = colors[Math.floor(s3 * colors.length) % colors.length];
        ctx.fillStyle = `rgba(${color.r}, ${color.g}, ${color.b}, ${brightness})`;
        ctx.beginPath();
        ctx.arc(px, py, radius, 0, 2 * Math.PI);
        ctx.fill();
      }
    }
  }
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
