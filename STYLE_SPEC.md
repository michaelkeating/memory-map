# Graph Style Spec Template

A reference for designing new Memory Map graph styles. Copy the template at the bottom and fill in whatever you care about — anything you leave blank, I'll pick a sensible default for.

---

## Quick template

```
Style name: <a short distinctive name>
Mood / inspiration: <a sentence or two — paintings, products, films, eras, anything>

Background: <color or texture description>
Grid: <none / lines / dots / something else>

Edges:
  Routing: <straight / orthogonal / 45° / curved / sketchy>
  Color: <single color / per-edge palette / by-type / by-weight>
  Width: <thin/medium/thick — or px>
  Effects: <glow / shadow / dashes / none>

Semantic (LLM-inferred) edges:
  How they should differ from explicit edges: <thinner / dashed / dimmer / different color>

Nodes:
  Shape: <circle / rounded square / star / icon-by-type>
  Fill: <by tag / single color / gradient>
  Border: <color, width, style>
  Effects: <glow / inner highlight / outer ring>

Tag colors (person / project / company / concept):
  Person: <color>
  Project: <color>
  Company: <color>
  Concept (default): <color>

Labels:
  Font: <serif / sans / mono / handwritten / google font name>
  Style: <regular / italic / bold>
  Size: <small / medium / large>
  Color: <color>
  Background: <none / matching panel / contrasting>

Floating UI (tooltip + controls):
  Background tone: <matching the theme>
  Text color: <>
  Border: <>

Engine notes (optional):
  <If you want a specific rendering engine, name it. Otherwise I'll pick.>
```

---

## What every variable means (and what's possible)

### `Background`
- Any CSS color (hex, rgb, hsl, named)
- Examples: `#ffffff`, `cream`, `deep navy`, `warm beige #f5efe0`
- Not yet possible: image textures, gradients (could be added)

### `Grid`
- `none` — no grid
- `lines` — light parallel lines (horizontal + vertical)
- `dots` — dot grid like a bullet journal or PCB
- Color and density adjustable
- Future: hex grid, isometric grid, polar — would need new code

### `Edges` — routing
What shape the connector lines take. Pick one:
- **`straight`** — direct line from node to node (default, the "Clean" look)
- **`sketchy`** — slightly imperfect hand-drawn line via rough.js (Excalidraw style)
- **`orthogonal`** — right-angle routing with rounded 90° corners (the "Circuit" look)
- **`45°` / `subway`** — straight runs joined by a single 45° diagonal kink (the "Subway" look)
- **`curved`** — smooth bezier curves between nodes *(not implemented yet, but easy to add)*

### `Edges` — color
- **`single`** — every edge the same color
- **`per-edge palette`** — each edge picks from a list, stable per edge (the Subway look — I can use any palette you give me)
- **`by-type`** — explicit links one color, semantic associations another
- **`by-weight`** — opacity or color mapped to association weight

### `Edges` — width
- Any pixel value, or descriptive: `hairline (1px)`, `thin (1.5)`, `medium (2-3)`, `thick (5-7)`, `chunky (8+)`
- Different widths for explicit vs semantic edges supported

### `Edges` — effects
- **`glow`** — soft halo around the line (cyan trace effect, neon)
- **`shadow`** — drop shadow underneath (subtle depth)
- **`dashes`** — `[3, 4]`-style pattern. Useful for distinguishing semantic edges
- **`stroke caps/joins`** — round, square, butt
- Not yet possible (without new code): textures (real chalk grain, watercolor), arrowheads, animated dashes

### `Edges` — semantic vs explicit
Semantic edges (LLM-inferred associations) can be styled differently from explicit `[[wikilinks]]`. Common patterns:
- Same color, dashed
- Lower opacity
- Different color entirely
- Thinner

### `Nodes` — shape
- **`circle`** — default
- **`star`** — multi-point bright shape (the Star Chart look)
- **`solder pad`** — circle + outer ring + inner dark dot (Circuit look)
- **`station`** — circle with thick border (Subway look)
- **`rounded square`** *(not built yet — easy add)*
- **`icon by tag`** *(would need icon set picked per tag — buildable)*

### `Nodes` — fill
- **`by tag`** — different color per page tag (person/project/company/concept)
- **`single`** — all nodes one color
- **`gradient`** *(not built yet)*
- **`hachure / cross-hatch`** — only available in `sketchy` engine via rough.js

### `Nodes` — border
- Any color, width
- Pinned nodes can have a distinct border (currently thicker; could be different color too)

### `Nodes` — effects
- **`glow`** — outer halo via shadowBlur (Circuit, Star Chart)
- **`outer ring`** — concentric ring around the node
- **`inner dot`** — small dark center for depth (Circuit pads)
- **`diffraction spike`** — 4-point cross overlay (Star Chart bright stars)
- **`drop shadow`** — soft shadow underneath
- Not yet possible: animation/twinkle, image fills, complex composite icons

### `Labels`
- **Font**: any web-safe font, system font, or Google Font (I'll add the import). Try "JetBrains Mono", "Cormorant Garamond", "Caveat", "Patrick Hand", "Inter", "Playfair Display", "Space Mono", "Orbitron", "DM Serif Display", etc.
- **Weight**: `300` (light) / `400` (regular) / `500` / `600` / `700` (bold)
- **Style**: regular or italic
- **Size**: separate values for `default` and `hover` (typically 11/12 or 13/15)
- **Color**: any color
- **Background**: a translucent rect behind the text for readability — color + opacity, or `none`

### `Floating UI` (tooltip + controls)
The hover tooltip and the bottom-right buttons. I style these with Tailwind classes that match the theme:
- Background tone (light/dark, transparency, blur)
- Border color
- Text color
- Shadow/glow

Just describe the vibe — I'll pick the classes.

### `Engine` (optional)
You can name a specific rendering engine if you want, or leave it blank and I'll pick:

| Engine | Use for |
|---|---|
| `clean` | Crisp vector aesthetics, data viz |
| `sketchy` | Hand-drawn / Excalidraw / whiteboard / chalkboard feel |
| `circuit` | Orthogonal routing, glow, dot grid |
| `subway` | 45° kinks, per-edge color palette, station nodes |
| `starchart` | Starfield background + glowing star nodes |

---

## Future engines I can build for ambitious styles

These are patterns I can add as new engines if you have a style that needs them. Just describe the style and I'll either fit it into an existing engine or build a new one.

- **`vector`** — gradients, drop shadows, smooth bezier curves, layered fills (think published infographic aesthetic)
- **`isometric`** — 30° projection of nodes and edges (a "city plan" feel)
- **`tree`** — tree/cluster layouts with hierarchical routing
- **`circular`** — radial layout with arc-routed edges (chord diagrams)
- **`watercolor`** — semi-transparent layered shapes with soft edges (would use Canvas filters or off-screen compositing)
- **`blueprint`** — white lines on dark blue, technical drawing annotations (line labels, dimension marks)
- **`comic`** — flat colors with bold black outlines (like ben-day dot fills)
- **`textile`** — fabric/thread inspired with overlapping woven lines
- **`stained glass`** — bold black outlines with bright translucent fills

If something I can do well already exists in another tool you can show me a screenshot of, that helps a lot.

---

## What's NOT yet supported (and what it would take)

| Feature | Status | Effort to add |
|---|---|---|
| Background image / texture | Not yet | Easy (canvas pattern fill) |
| Gradient fills on nodes | Not yet | Easy (canvas gradient) |
| Animated pulses / twinkles | Not yet | Medium (per-frame state) |
| Arrowheads on directed edges | Not yet | Easy |
| Edge labels (text along the line) | Not yet | Medium |
| Custom node shapes / icons per tag | Not yet | Medium |
| True force layouts (cluster, hierarchical) | Not yet | Medium (different d3 forces) |
| 3D rendering | Not yet | Big (would need Three.js/WebGL) |
| Real chalk/pencil/marker textures | Skipped intentionally | Medium (stamped brush sprites) |

If you want any of these, just ask and I'll add the capability before/while building the style.

---

## Minimal example

Here's the kind of brief I can work from:

> **Style name**: Notebook
> **Mood**: A page from a beautifully kept Moleskine — cream paper, fountain pen ink, slightly musical
>
> Background: warm cream `#fbf6e9`
> Grid: light dot grid, very faint
>
> Edges: straight lines, dark blue ink (`#1e3a5f`), medium width. Semantic edges thinner and dashed.
>
> Nodes: small filled circles, by-tag colors but muted/desaturated. Thin dark ink border.
>
> Tag colors:
>   Person: muted rose `#a85d5d`
>   Project: muted teal `#3d7a7e`
>   Company: muted gold `#a87f3d`
>   Concept: muted indigo `#4a5d8a`
>
> Labels: "Iowan Old Style" or any classic book serif, regular weight, dark blue, no background
>
> Floating UI: cream-tinted glass with thin dark borders

That's enough for me to build a complete style.

---

## Even more minimal

If you don't want to fill out a whole template, just give me:
- A name
- A vibe / inspiration
- Any 2–3 properties you really care about

I'll fill in the rest and we can iterate.
