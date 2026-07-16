import { Layer, AnimatableProperty, GradientDef, PROPERTY_DEFAULTS, ALL_PROPERTIES, MotionPath, PathPoint, PathKeyframe } from '../types';
import { easingToCss } from './easing';
import { unpackColor } from './interpolate';
import { interpolatePathPoints } from './pathPoints';

function cssId(str: string): string {
  return str.replace(/[^a-zA-Z0-9_-]/g, '_');
}

// Build a path `d` string using ONLY C commands so all sampled frames share the same
// command structure — required for SMIL calcMode="linear" to interpolate correctly.
function buildPathSmil(points: PathPoint[], closed: boolean): string {
  if (points.length === 0) return '';
  const f = (n: number) => n.toFixed(3);
  let d = `M ${f(points[0].x)} ${f(points[0].y)}`;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    d += ` C ${f(prev.cpOutX)} ${f(prev.cpOutY)} ${f(curr.cpInX)} ${f(curr.cpInY)} ${f(curr.x)} ${f(curr.y)}`;
  }
  if (closed && points.length > 1) {
    const last = points[points.length - 1];
    const first = points[0];
    d += ` C ${f(last.cpOutX)} ${f(last.cpOutY)} ${f(first.cpInX)} ${f(first.cpInY)} ${f(first.x)} ${f(first.y)} Z`;
  }
  return d;
}

// Append a SMIL <animate> element to `el` for shape/anchor-point animation.
// Works for both <path> (attributeName="d") and <polygon>/<polyline> (attributeName="points").
// SMIL has universal SVG browser support (Chrome, Firefox, Safari).
function appendSmilShapeAnimation(
  doc: XMLDocument,
  el: Element,
  tag: string,
  keyframes: PathKeyframe[],
  duration: number,
  loop: 'none' | 'infinite'
): void {
  const sorted = [...keyframes].sort((a, b) => a.time - b.time);
  if (!sorted.every(kf => kf.points.length === sorted[0].points.length)) return;
  const closed = sorted[0].closed;
  const isPoly = tag === 'polygon' || tag === 'polyline';

  // Sample uniformly — interpolatePathPoints applies easing correctly at each t
  const SAMPLES = Math.max(60, Math.round(duration * 60));
  const keyTimesArr: string[] = [];
  const valuesArr: string[] = [];

  for (let i = 0; i <= SAMPLES; i++) {
    const t = (i / SAMPLES) * duration;
    const pts = interpolatePathPoints(sorted, t);
    if (!pts) continue;
    keyTimesArr.push((t / duration).toFixed(5));
    if (isPoly) {
      valuesArr.push(pts.map(p => `${p.x.toFixed(3)},${p.y.toFixed(3)}`).join(' '));
    } else {
      valuesArr.push(buildPathSmil(pts, closed));
    }
  }

  const animEl = doc.createElementNS('http://www.w3.org/2000/svg', 'animate');
  animEl.setAttribute('attributeName', isPoly ? 'points' : 'd');
  animEl.setAttribute('dur', `${duration}s`);
  animEl.setAttribute('calcMode', 'linear');
  animEl.setAttribute('keyTimes', keyTimesArr.join(';'));
  animEl.setAttribute('values', valuesArr.join(';'));
  animEl.setAttribute('fill', loop === 'infinite' ? 'remove' : 'freeze');
  if (loop === 'infinite') animEl.setAttribute('repeatCount', 'indefinite');
  el.appendChild(animEl);
}

function embedGradient(doc: XMLDocument, svgEl: Element, gradId: string, grad: GradientDef): string {
  const ns = 'http://www.w3.org/2000/svg';
  let defs = svgEl.querySelector('defs');
  if (!defs) { defs = doc.createElementNS(ns, 'defs'); svgEl.insertBefore(defs, svgEl.firstChild); }
  const existing = defs.querySelector(`#${CSS.escape(gradId)}`);
  if (existing) existing.remove();
  const el = doc.createElementNS(ns, 'linearGradient');
  el.setAttribute('id', gradId);
  el.setAttribute('gradientUnits', 'objectBoundingBox');
  const rad = (grad.angle * Math.PI) / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  el.setAttribute('x1', String(0.5 - cos / 2));
  el.setAttribute('y1', String(0.5 - sin / 2));
  el.setAttribute('x2', String(0.5 + cos / 2));
  el.setAttribute('y2', String(0.5 + sin / 2));
  for (const stop of grad.stops) {
    const s = doc.createElementNS(ns, 'stop');
    s.setAttribute('offset', String(stop.offset));
    s.setAttribute('stop-color', stop.color);
    s.setAttribute('stop-opacity', String(stop.opacity));
    el.appendChild(s);
  }
  defs.appendChild(el);
  return `url(#${gradId})`;
}

const COLOR_PROPS = new Set<AnimatableProperty>(['fillColor', 'strokeColor']);
const TRIM_PROPS = new Set<AnimatableProperty>(['trimStart', 'trimEnd']);
const MOTION_PROPS = new Set<AnimatableProperty>(['motionOffset']);

function buildPropertyAnimation(
  layer: Layer,
  property: AnimatableProperty,
  duration: number
): { atProperty: string; atKeyframes: string; varName: string } | null {
  const kfs = layer.tracks[property];
  if (kfs.length < 2) return null;

  const sorted = [...kfs].sort((a, b) => a.time - b.time);
  const varName = `--svga-${property}-${cssId(layer.elementId)}`;
  const animName = `svga_${property}_${cssId(layer.elementId)}`;
  const defaultVal = PROPERTY_DEFAULTS[property];

  let atProperty: string;
  let kfLines: string[];

  if (COLOR_PROPS.has(property)) {
    const defaultHex = unpackColor(defaultVal);
    atProperty = `@property ${varName} { syntax: '<color>'; inherits: false; initial-value: ${defaultHex}; }`;
    kfLines = sorted.map((kf, i) => {
      const pct = ((kf.time / duration) * 100).toFixed(3);
      const timingFn = i < sorted.length - 1 ? easingToCss(kf.easing) : null;
      const timingLine = timingFn ? `  animation-timing-function: ${timingFn};` : '';
      return `  ${pct}% { ${varName}: ${unpackColor(kf.value)}; ${timingLine} }`;
    });
    // Ensure there's an explicit 100% keyframe so the browser doesn't interpolate
    // back to @property initial-value during the tail of the animation
    const lastKf = sorted[sorted.length - 1];
    if ((lastKf.time / duration) < 0.9999) {
      kfLines.push(`  100.000% { ${varName}: ${unpackColor(lastKf.value)}; }`);
    }
  } else {
    atProperty = `@property ${varName} { syntax: '<number>'; inherits: false; initial-value: ${defaultVal}; }`;
    kfLines = sorted.map((kf, i) => {
      const pct = ((kf.time / duration) * 100).toFixed(3);
      const timingFn = i < sorted.length - 1 ? easingToCss(kf.easing) : null;
      const timingLine = timingFn ? `  animation-timing-function: ${timingFn};` : '';
      return `  ${pct}% { ${varName}: ${kf.value.toFixed(6)}; ${timingLine} }`;
    });
    // Same fix for numeric properties
    const lastKf = sorted[sorted.length - 1];
    if ((lastKf.time / duration) < 0.9999) {
      kfLines.push(`  100.000% { ${varName}: ${lastKf.value.toFixed(6)}; }`);
    }
  }

  const atKeyframes = `@keyframes ${animName} {\n${kfLines.join('\n')}\n}`;
  return { atProperty, atKeyframes, varName };
}

export interface ProjectMetadata {
  version: number;
  layers: Layer[];
  duration: number;
  canvasWidth: number;
  canvasHeight: number;
  motionPaths: MotionPath[];
}

export function exportAnimatedSvg(
  svgSource: string,
  layers: Layer[],
  duration: number,
  projectMetadata?: ProjectMetadata,
  motionPaths: MotionPath[] = [],
  // layerId → origin adjustment to keep element at natural position at motionOffset=0
  motionAdjustments: Map<string, { x: number; y: number }> = new Map(),
  loop: 'none' | 'infinite' = 'none'
): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgSource, 'image/svg+xml');
  const svgEl = doc.documentElement;
  const cssBlocks: string[] = [];

  for (const layer of layers) {
    if (!layer.visible) continue;
    const el = doc.getElementById(layer.elementId);
    if (!el) continue;

    const hasAny = ALL_PROPERTIES.some((p) => layer.tracks[p].length >= 2);
    const hasGradient = !!(layer.fillGradient || layer.strokeGradient);
    const hasPathKfs = (layer.pathKeyframes?.length ?? 0) >= 2;
    if (!hasAny && !hasGradient && !hasPathKfs) continue;

    // Shape / anchor-point animation — SMIL works universally (Chrome, Firefox, Safari)
    if (hasPathKfs) {
      const tag = layer.tagName.toLowerCase();
      appendSmilShapeAnimation(doc, el, tag, layer.pathKeyframes!, duration, loop);
    }

    // Embed static gradient fills/strokes directly on the element
    if (layer.fillGradient) {
      const gradId = `svga-fill-grad-${cssId(layer.elementId)}`;
      el.setAttribute('fill', embedGradient(doc, svgEl, gradId, layer.fillGradient));
    }
    if (layer.strokeGradient) {
      const gradId = `svga-stroke-grad-${cssId(layer.elementId)}`;
      el.setAttribute('stroke', embedGradient(doc, svgEl, gradId, layer.strokeGradient));
    }

    if (!hasAny) continue;

    const varNames: Partial<Record<AnimatableProperty, string>> = {};
    const animParts: string[] = [];

    for (const property of ALL_PROPERTIES) {
      // Skip trim and motion props here — handle separately below
      if (TRIM_PROPS.has(property)) continue;
      if (MOTION_PROPS.has(property)) continue;

      const result = buildPropertyAnimation(layer, property, duration);
      if (!result) continue;
      cssBlocks.push(result.atProperty);
      cssBlocks.push(result.atKeyframes);
      varNames[property] = result.varName;
      animParts.push(`svga_${property}_${cssId(layer.elementId)} ${duration}s linear`);
    }

    // Handle trim path properties
    const hasTrimStart = layer.tracks.trimStart.length >= 2;
    const hasTrimEnd = layer.tracks.trimEnd.length >= 2;
    let trimTotalLength: number | null = null;
    if (hasTrimStart || hasTrimEnd) {
      try {
        trimTotalLength = (el as unknown as SVGGeometryElement).getTotalLength();
      } catch {
        // element doesn't support getTotalLength
      }
    }

    if (trimTotalLength !== null) {
      for (const property of ['trimStart', 'trimEnd'] as AnimatableProperty[]) {
        const result = buildPropertyAnimation(layer, property, duration);
        if (!result) continue;
        cssBlocks.push(result.atProperty);
        cssBlocks.push(result.atKeyframes);
        varNames[property] = result.varName;
        animParts.push(`svga_${property}_${cssId(layer.elementId)} ${duration}s linear`);
      }
    }

    function v(p: AnimatableProperty, unit: string): string {
      return varNames[p]
        ? `calc(var(${varNames[p]}) * 1${unit})`
        : `${PROPERTY_DEFAULTS[p]}${unit}`;
    }

    const extraRules: string[] = [];

    // Trim path CSS
    if (trimTotalLength !== null) {
      const tsVar = varNames['trimStart'] ? `var(${varNames['trimStart']})` : `${PROPERTY_DEFAULTS.trimStart}`;
      const teVar = varNames['trimEnd'] ? `var(${varNames['trimEnd']})` : `${PROPERTY_DEFAULTS.trimEnd}`;
      const tl = trimTotalLength;
      extraRules.push(`  stroke-dasharray: calc((${teVar} - ${tsVar}) * ${tl}px) ${tl}px;`);
      extraRules.push(`  stroke-dashoffset: calc(-1 * ${tsVar} * ${tl}px);`);
    }

    // Fill / stroke color CSS
    if (varNames['fillColor']) {
      extraRules.push(`  fill: var(${varNames['fillColor']});`);
    }
    if (varNames['strokeColor']) {
      extraRules.push(`  stroke: var(${varNames['strokeColor']});`);
    }

    // Motion path CSS
    const mp = layer.motionPathId ? motionPaths.find(p => p.id === layer.motionPathId) : null;
    if (mp && mp.d) {
      const hasMotionKfs = layer.tracks.motionOffset.length >= 2;
      if (hasMotionKfs) {
        const result = buildPropertyAnimation(layer, 'motionOffset', duration);
        if (result) {
          cssBlocks.push(result.atProperty);
          cssBlocks.push(result.atKeyframes);
          varNames['motionOffset'] = result.varName;
          animParts.push(`svga_motionOffset_${cssId(layer.elementId)} ${duration}s linear`);
        }
      }
      const moVar = varNames['motionOffset'] ? `var(${varNames['motionOffset']})` : `${PROPERTY_DEFAULTS.motionOffset}`;
      extraRules.push(`  offset-path: path('${mp.d}');`);
      extraRules.push(`  offset-distance: calc(${moVar} * 100%);`);
      extraRules.push(`  offset-rotate: ${(layer.autoRotate ?? false) ? 'auto' : '0deg'};`);
    }

    if (animParts.length === 0) continue;

    // Build transform values
    const tx = v('x', 'px'), ty = v('y', 'px'), rot = v('rotation', 'deg');
    const sx = varNames['scaleX'] ? `var(${varNames['scaleX']})` : `${PROPERTY_DEFAULTS.scaleX}`;
    const sy = varNames['scaleY'] ? `var(${varNames['scaleY']})` : `${PROPERTY_DEFAULTS.scaleY}`;
    const op = varNames['opacity'] ? `var(${varNames['opacity']})` : `${PROPERTY_DEFAULTS.opacity}`;

    // Motion path origin adjustment (same calc as applyTransforms in Canvas.tsx)
    const adj = mp ? (motionAdjustments.get(layer.id) ?? { x: 0, y: 0 }) : { x: 0, y: 0 };
    const txFull = adj.x !== 0 ? `calc(${tx} + ${adj.x.toFixed(3)}px)` : tx;
    const tyFull = adj.y !== 0 ? `calc(${ty} + ${adj.y.toFixed(3)}px)` : ty;

    // Anchor / transform-origin
    const anchorX = layer.anchorX ?? 0;
    const anchorY = layer.anchorY ?? 0;
    const transformOrigin = (anchorX === 0 && anchorY === 0)
      ? 'center center'
      : `calc(50% + ${anchorX}px) calc(50% + ${anchorY}px)`;

    const extraCss = extraRules.length > 0 ? '\n' + extraRules.join('\n') : '';

    cssBlocks.push(
      `#${CSS.escape(layer.elementId)} {\n  animation: ${animParts.join(', ')};\n  animation-iteration-count: ${loop === 'infinite' ? 'infinite' : '1'};\n  animation-fill-mode: ${loop === 'infinite' ? 'none' : 'forwards'};\n  transform-box: fill-box;\n  transform-origin: ${transformOrigin};\n  transform: translate(${txFull}, ${tyFull}) rotate(${rot}) scale(${sx}, ${sy});\n  opacity: ${op};${extraCss}\n}`
    );
  }

  if (cssBlocks.length === 0) {
    return new XMLSerializer().serializeToString(doc);
  }

  const existingStyle = svgEl.querySelector('style');
  const styleEl = existingStyle ?? doc.createElementNS('http://www.w3.org/2000/svg', 'style');
  if (!existingStyle) svgEl.insertBefore(styleEl, svgEl.firstChild);

  styleEl.textContent =
    (styleEl.textContent ? styleEl.textContent + '\n' : '') +
    '/* SVG Animator export */\n' +
    cssBlocks.join('\n\n');

  if (projectMetadata) {
    const existing = svgEl.querySelector('metadata[data-svga]');
    if (existing) existing.remove();
    const metaEl = doc.createElementNS('http://www.w3.org/2000/svg', 'metadata');
    metaEl.setAttribute('data-svga', '1');
    metaEl.textContent = JSON.stringify(projectMetadata);
    svgEl.appendChild(metaEl);
  }

  return new XMLSerializer().serializeToString(doc);
}

export function extractProjectMetadata(svgSource: string): ProjectMetadata | null {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgSource, 'image/svg+xml');
    const metaEl = doc.querySelector('metadata[data-svga]');
    if (!metaEl) return null;
    return JSON.parse(metaEl.textContent ?? '') as ProjectMetadata;
  } catch {
    return null;
  }
}

export function downloadSvg(svgString: string, filename = 'animation.svg') {
  const blob = new Blob([svgString], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
