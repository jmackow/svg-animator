# SVG Animator

A browser-based SVG animation editor built with React 18 and TypeScript. Import any SVG, animate its elements with a keyframe timeline, assign motion paths, add gradients, and export a self-contained animated SVG that plays natively in any browser or Webflow embed — no JavaScript required.

---

## Features

### Timeline & Keyframes
- Per-property keyframe tracks for every layer
- Drag keyframes on the timeline to reposition them
- Marquee selection for multi-keyframe editing
- Snap-to-keyframe with toggle
- Playback with play / pause / stop controls
- **Loop toggle** — preview and export as looped or one-shot animation
- Configurable animation duration

### Animatable Properties
| Property | Notes |
|---|---|
| Position X / Y | Translate in px |
| Scale X / Y | Per-axis scale |
| Rotation | Degrees |
| Opacity | 0–1 |
| Fill Color | Keyframeable hex color |
| Stroke Color | Keyframeable hex color |
| Fill Opacity / Stroke Opacity | 0–1 |
| Trim Start / Trim End | Path trim (stroke-dasharray) |
| Motion Offset | Position along a motion path (0–1) |

### Easing
- Built-in presets: `linear`, `ease`, `ease-in`, `ease-out`, `ease-in-out`
- Custom cubic-bezier editor with interactive graph
- Spring physics easing (stiffness / damping / mass)
- Per-keyframe in/out easing

### Motion Paths
- Draw freehand motion paths directly on the canvas
- Bezier curve support with editable handles
- Smooth drag-to-draw or click-to-corner modes
- Assign multiple layers to the same path
- **Auto-rotate** option — element follows path direction
- Paths stored in SVG user-space coordinates for accurate export

### Colors & Gradients
- Solid fill and stroke with alpha control
- **Linear gradient** fill and stroke with:
  - Draggable color stops
  - Per-stop color and opacity
  - Angle slider
  - Add / remove stops
- Gradients embedded in exported SVG `<defs>`

### Quick Animations (Presets)
One-click 500 ms animations applied at the current playhead position:
- Fade In / Fade Out
- Slide In / Out from all four directions (with opacity)

### Canvas
- Infinite scroll canvas with zoom (10–400 %)
- Transform overlay — drag to move, scale handles, rotation handle
- Anchor point control per layer
- Cmd+hover bounding box highlight
- Pure black canvas background

### Panels
- **Left panel** — layer list with visibility/lock toggles, layer rename, thumbnail previews
- **Right panel** — properties, colors, motion path assignment, quick animations, keyframe easing
- **Motion Paths panel** — create, rename, delete paths; assign layers with thumbnail previews
- All panels (left, right, timeline) are **resizable by dragging**

### Export
- Exports a fully self-contained SVG with embedded CSS animations
- Uses `@property` + `@keyframes` for smooth interpolation of all property types
- Motion path via CSS `offset-path` / `offset-distance`
- Trim path via `stroke-dasharray` / `stroke-dashoffset`
- Project metadata embedded in `<metadata>` — re-import to continue editing
- Loop mode: `animation-iteration-count: infinite` or one-shot with `forwards` fill
- Works as a static embed in Webflow, Framer, HTML `<img>` tags, and `<iframe>`

### Undo / Redo
- Full undo/redo history (Cmd+Z / Cmd+Shift+Z)
- Drag operations use silent actions to avoid polluting history

---

## Tech Stack

- **React 18** + **TypeScript**
- **Vite** (dev server + build)
- **Phosphor Icons** (`@phosphor-icons/react`)
- No animation libraries — all rendering via native SVG DOM + CSS
- No backend — runs entirely in the browser

---

## Getting Started

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

Requires Node 18+.

---

## Usage

1. Click **Import SVG** and select any `.svg` file
2. Click a layer in the left panel to select it
3. Move the playhead and click **◆** next to a property to add a keyframe
4. Adjust the value — the animation is previewed in real time
5. Use the **Loop** toggle to preview looping
6. Click **Export SVG** to download the animated file

### Re-importing / Continuing Work

Exported SVGs embed the full project state. Re-importing an exported file restores all layers, keyframes, and motion paths exactly.

### Embedding the Export

The exported SVG is self-contained and requires no JavaScript:

```html
<!-- Inline -->
<img src="animation.svg" />

<!-- As iframe for loop control via CSS -->
<iframe src="animation.svg" frameborder="0"></iframe>
```

For Webflow: upload the SVG as an asset and embed with an `<img>` tag, or use an HTML embed block with an `<iframe>`.

---

## Project Structure

```
src/
├── components/
│   ├── Canvas.tsx          # SVG host, transform overlay, gradient DOM
│   ├── MotionPathOverlay.tsx  # Draw & edit motion paths (Bezier)
│   ├── TransformOverlay.tsx   # Drag/scale/rotate handles
│   ├── CmdHoverOverlay.tsx    # Cmd+hover bounding box
│   ├── LayerPanel.tsx         # Layer list, visibility, lock, rename
│   ├── LeftPanel.tsx          # Tab container (Layers / Motion Paths)
│   ├── MotionPathPanel.tsx    # Motion path management
│   ├── PropertiesPanel.tsx    # Properties, colors, gradients, presets
│   ├── Timeline.tsx           # Keyframe timeline, playback loop
│   ├── Toolbar.tsx            # Import, export, playback, loop, zoom
│   └── EasingPicker.tsx       # Preset / bezier / spring easing UI
├── context/
│   └── AppContext.tsx       # useReducer state + undo/redo history
├── utils/
│   ├── exporter.ts         # Animated SVG export + project metadata
│   ├── interpolate.ts      # Keyframe interpolation, color pack/unpack
│   ├── easing.ts           # Easing → CSS string conversion
│   └── svgParser.ts        # SVG import → layer extraction
├── types.ts                # All shared TypeScript types
└── index.css               # Full UI theme (pure grayscale)
```

---

## License

MIT
