import {
  Layer,
  PropertyTracks,
  PropertyKeyframe,
  AnimatableProperty,
  EasingConfig,
  DEFAULT_EASING,
  PROPERTY_DEFAULTS,
} from '../types';
import { packColor } from './interpolate';

export interface AnimationImportResult {
  layerTracks: Map<string, Partial<PropertyTracks>>;
  maxDuration: number;
  strippedSource: string;
}

// ─── Duration parsing ─────────────────────────────────────────────────────────

function parseSmilDuration(dur: string): number {
  if (!dur || dur === 'indefinite' || dur === 'media') return 0;
  // HH:MM:SS or MM:SS
  if (dur.includes(':')) {
    const parts = dur.split(':').map(Number);
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return 0;
  }
  const n = parseFloat(dur);
  if (isNaN(n)) return 0;
  if (dur.endsWith('min')) return n * 60;
  if (dur.endsWith('h')) return n * 3600;
  return n; // default is seconds
}

// ─── Easing helpers ───────────────────────────────────────────────────────────

function cssTimingToEasing(timing: string): EasingConfig {
  const t = timing.trim();
  if (t === 'linear') return { type: 'preset', name: 'linear' };
  if (t === 'ease') return { type: 'preset', name: 'ease' };
  if (t === 'ease-in') return { type: 'preset', name: 'ease-in' };
  if (t === 'ease-out') return { type: 'preset', name: 'ease-out' };
  if (t === 'ease-in-out') return { type: 'preset', name: 'ease-in-out' };
  const cbMatch = t.match(/^cubic-bezier\(\s*([\d.+-]+)\s*,\s*([\d.+-]+)\s*,\s*([\d.+-]+)\s*,\s*([\d.+-]+)\s*\)$/);
  if (cbMatch) {
    return { type: 'bezier', x1: parseFloat(cbMatch[1]), y1: parseFloat(cbMatch[2]), x2: parseFloat(cbMatch[3]), y2: parseFloat(cbMatch[4]) };
  }
  return { type: 'preset', name: 'ease' };
}

function smilCalcModeToEasing(calcMode: string, keySplines: string, segIndex: number): EasingConfig {
  if (calcMode === 'spline' && keySplines) {
    const segs = keySplines.split(';').map(s => s.trim()).filter(Boolean);
    const seg = segs[segIndex] ?? segs[segs.length - 1];
    if (seg) {
      const nums = seg.trim().split(/[\s,]+/).map(Number);
      if (nums.length === 4) return { type: 'bezier', x1: nums[0], y1: nums[1], x2: nums[2], y2: nums[3] };
    }
  }
  return { type: 'preset', name: 'linear' };
}

function makeKf(time: number, value: number, easing: EasingConfig = DEFAULT_EASING): PropertyKeyframe {
  return { id: `kf-${Date.now()}-${Math.random().toString(36).slice(2)}`, time, value, easing };
}

// ─── CSS transform parsing ────────────────────────────────────────────────────

function parseCssTransform(value: string): Partial<Record<'x' | 'y' | 'rotation' | 'scaleX' | 'scaleY', number>> {
  const result: Partial<Record<'x' | 'y' | 'rotation' | 'scaleX' | 'scaleY', number>> = {};
  const fnRe = /(\w+)\(([^)]*)\)/g;
  let m: RegExpExecArray | null;
  while ((m = fnRe.exec(value)) !== null) {
    const fn = m[1];
    const args = m[2].split(/[\s,]+/).map(a => parseFloat(a));
    switch (fn) {
      case 'translateX': result.x = args[0] ?? 0; break;
      case 'translateY': result.y = args[0] ?? 0; break;
      case 'translate':  result.x = args[0] ?? 0; result.y = args[1] ?? 0; break;
      case 'rotate': {
        const raw = m[2].trim();
        if (raw.endsWith('rad')) result.rotation = (args[0] ?? 0) * (180 / Math.PI);
        else result.rotation = args[0] ?? 0;
        break;
      }
      case 'scale':
        result.scaleX = args[0] ?? 1;
        result.scaleY = args.length > 1 ? args[1] : (args[0] ?? 1);
        break;
      case 'scaleX': result.scaleX = args[0] ?? 1; break;
      case 'scaleY': result.scaleY = args[0] ?? 1; break;
    }
  }
  return result;
}

// ─── Color parsing ────────────────────────────────────────────────────────────

function parseColor(value: string): number | null {
  const v = value.trim();
  if (!v || v === 'none' || v === 'transparent' || v === 'currentColor') return null;
  // hex
  if (v.startsWith('#')) {
    try { return packColor(v); } catch { return null; }
  }
  // rgb(r,g,b)
  const rgb = v.match(/^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/);
  if (rgb) {
    const r = parseInt(rgb[1]), g = parseInt(rgb[2]), b = parseInt(rgb[3]);
    return (r << 16) | (g << 8) | b;
  }
  // named color — use a temporary canvas to resolve
  try {
    const ctx = document.createElement('canvas').getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = v;
    const resolved = ctx.fillStyle; // browser normalises to #rrggbb
    if (resolved.startsWith('#')) return packColor(resolved);
  } catch { /* ignore */ }
  return null;
}

// ─── SMIL value list helpers ──────────────────────────────────────────────────

function parseValues(attr: string): string[] {
  return attr.split(';').map(s => s.trim()).filter(Boolean);
}

function parseKeyTimes(attr: string, count: number): number[] {
  if (attr) {
    const kts = attr.split(';').map(s => parseFloat(s.trim()));
    if (kts.length === count) return kts;
  }
  // evenly spaced
  return Array.from({ length: count }, (_, i) => i / Math.max(1, count - 1));
}

// ─── SMIL per-element parsing ─────────────────────────────────────────────────

type TrackAccum = Partial<PropertyTracks>;

function mergeKfs(accum: TrackAccum, prop: AnimatableProperty, kfs: PropertyKeyframe[]) {
  if (!kfs.length) return;
  const existing = accum[prop] ?? [];
  accum[prop] = [...existing, ...kfs];
}

function parseSmilAnimate(el: Element, dur: number, calcMode: string, keySplines: string): Array<{ prop: AnimatableProperty; kfs: PropertyKeyframe[] }> {
  const attrName = el.getAttribute('attributeName') ?? '';
  let appProp: AnimatableProperty | null = null;
  let toNumber: (v: string) => number | null = () => null;

  switch (attrName) {
    case 'opacity':        appProp = 'opacity';       toNumber = v => parseFloat(v); break;
    case 'fill-opacity':   appProp = 'fillOpacity';   toNumber = v => parseFloat(v); break;
    case 'stroke-opacity': appProp = 'strokeOpacity'; toNumber = v => parseFloat(v); break;
    case 'fill':           appProp = 'fillColor';     toNumber = parseColor; break;
    case 'stroke':         appProp = 'strokeColor';   toNumber = parseColor; break;
    default: return [];
  }

  const results: Array<{ prop: AnimatableProperty; kfs: PropertyKeyframe[] }> = [];
  const valuesAttr = el.getAttribute('values');
  const keyTimesAttr = el.getAttribute('keyTimes') ?? '';
  const fromAttr = el.getAttribute('from');
  const toAttr = el.getAttribute('to');
  const byAttr = el.getAttribute('by');

  let rawValues: string[];
  let rawKeyTimes: number[];

  if (valuesAttr) {
    rawValues = parseValues(valuesAttr);
    rawKeyTimes = parseKeyTimes(keyTimesAttr, rawValues.length);
  } else if (fromAttr !== null && toAttr !== null) {
    rawValues = [fromAttr, toAttr];
    rawKeyTimes = [0, 1];
  } else if (fromAttr !== null && byAttr !== null) {
    // by = additive offset; only meaningful for numeric properties
    const fromNum = parseFloat(fromAttr);
    const byNum = parseFloat(byAttr);
    if (!isNaN(fromNum) && !isNaN(byNum)) {
      rawValues = [String(fromNum), String(fromNum + byNum)];
    } else {
      rawValues = [fromAttr, byAttr];
    }
    rawKeyTimes = [0, 1];
  } else if (toAttr !== null) {
    rawValues = [toAttr];
    rawKeyTimes = [1];
  } else {
    return [];
  }

  const kfs: PropertyKeyframe[] = [];
  for (let i = 0; i < rawValues.length; i++) {
    const num = toNumber(rawValues[i]);
    if (num === null || isNaN(num as number)) continue;
    const time = rawKeyTimes[i] * dur;
    const easing = i < rawValues.length - 1
      ? smilCalcModeToEasing(calcMode, keySplines, i)
      : DEFAULT_EASING;
    kfs.push(makeKf(time, num as number, easing));
  }

  if (kfs.length) results.push({ prop: appProp, kfs });
  return results;
}

function parseSmilAnimateTransform(el: Element, dur: number, calcMode: string, keySplines: string): Array<{ prop: AnimatableProperty; kfs: PropertyKeyframe[] }> {
  const type = el.getAttribute('type') ?? 'translate';
  const valuesAttr = el.getAttribute('values');
  const fromAttr = el.getAttribute('from');
  const toAttr = el.getAttribute('to');
  const byAttr = el.getAttribute('by');
  const keyTimesAttr = el.getAttribute('keyTimes') ?? '';

  let rawValues: string[];
  let rawKeyTimes: number[];

  if (valuesAttr) {
    rawValues = parseValues(valuesAttr);
    rawKeyTimes = parseKeyTimes(keyTimesAttr, rawValues.length);
  } else if (fromAttr !== null && toAttr !== null) {
    rawValues = [fromAttr, toAttr];
    rawKeyTimes = [0, 1];
  } else if (fromAttr !== null && byAttr !== null) {
    // by = additive offset per component
    const fromParts = fromAttr.trim().split(/[\s,]+/).map(Number);
    const byParts = byAttr.trim().split(/[\s,]+/).map(Number);
    const toParts = fromParts.map((v, i) => v + (byParts[i] ?? 0));
    rawValues = [fromAttr, toParts.join(' ')];
    rawKeyTimes = [0, 1];
  } else if (toAttr !== null) {
    rawValues = [toAttr];
    rawKeyTimes = [1];
  } else {
    return [];
  }

  const xKfs: PropertyKeyframe[] = [];
  const yKfs: PropertyKeyframe[] = [];
  const rKfs: PropertyKeyframe[] = [];
  const sxKfs: PropertyKeyframe[] = [];
  const syKfs: PropertyKeyframe[] = [];

  for (let i = 0; i < rawValues.length; i++) {
    const time = rawKeyTimes[i] * dur;
    const easing = i < rawValues.length - 1
      ? smilCalcModeToEasing(calcMode, keySplines, i)
      : DEFAULT_EASING;
    const parts = rawValues[i].trim().split(/[\s,]+/).map(Number);

    if (type === 'translate') {
      xKfs.push(makeKf(time, parts[0] ?? 0, easing));
      yKfs.push(makeKf(time, parts[1] ?? 0, easing));
    } else if (type === 'rotate') {
      rKfs.push(makeKf(time, parts[0] ?? 0, easing));
    } else if (type === 'scale') {
      const sx = parts[0] ?? 1;
      const sy = parts.length > 1 ? parts[1] : sx;
      sxKfs.push(makeKf(time, sx, easing));
      syKfs.push(makeKf(time, sy, easing));
    }
  }

  const results: Array<{ prop: AnimatableProperty; kfs: PropertyKeyframe[] }> = [];
  if (xKfs.length) results.push({ prop: 'x', kfs: xKfs });
  if (yKfs.length) results.push({ prop: 'y', kfs: yKfs });
  if (rKfs.length) results.push({ prop: 'rotation', kfs: rKfs });
  if (sxKfs.length) results.push({ prop: 'scaleX', kfs: sxKfs });
  if (syKfs.length) results.push({ prop: 'scaleY', kfs: syKfs });
  return results;
}

// ─── SMIL main ────────────────────────────────────────────────────────────────

function parseSmil(svgDoc: Document, layers: Layer[]): { layerTracks: Map<string, TrackAccum>; maxDuration: number } {
  const layerTracks = new Map<string, TrackAccum>();
  let maxDuration = 0;

  for (const layer of layers) {
    const el = svgDoc.getElementById(layer.elementId);
    if (!el) continue;

    const accum: TrackAccum = {};
    // Only direct children — SMIL <animate>/<animateTransform> must be direct children
    // of the element they target. Using querySelectorAll would incorrectly collect
    // animations from nested child elements and apply them to the parent.
    const animEls = Array.from(el.children).filter(c => {
      const tag = c.tagName.toLowerCase();
      return tag === 'animate' || tag === 'animatetransform';
    });

    for (const animEl of animEls) {
      const tag = animEl.tagName.toLowerCase();
      const durAttr = animEl.getAttribute('dur') ?? '';
      const dur = parseSmilDuration(durAttr);
      if (!dur) continue;

      maxDuration = Math.max(maxDuration, dur);
      const calcMode = animEl.getAttribute('calcMode') ?? 'linear';
      const keySplines = animEl.getAttribute('keySplines') ?? '';

      let entries: Array<{ prop: AnimatableProperty; kfs: PropertyKeyframe[] }> = [];
      if (tag === 'animate') {
        entries = parseSmilAnimate(animEl, dur, calcMode, keySplines);
      } else if (tag === 'animatetransform') {
        entries = parseSmilAnimateTransform(animEl, dur, calcMode, keySplines);
      }
      for (const { prop, kfs } of entries) {
        mergeKfs(accum, prop, kfs);
      }
    }

    if (Object.keys(accum).length) layerTracks.set(layer.elementId, accum);
  }

  return { layerTracks, maxDuration };
}

// ─── CSS animation parsing ────────────────────────────────────────────────────

function parseCssPropertyValue(prop: string, value: string): Array<{ prop: AnimatableProperty; value: number }> {
  const p = prop.trim().toLowerCase();
  const v = value.trim();

  if (p === 'opacity') {
    const n = parseFloat(v);
    if (!isNaN(n)) return [{ prop: 'opacity', value: n }];
  }
  if (p === 'fill-opacity') {
    const n = parseFloat(v);
    if (!isNaN(n)) return [{ prop: 'fillOpacity', value: n }];
  }
  if (p === 'stroke-opacity') {
    const n = parseFloat(v);
    if (!isNaN(n)) return [{ prop: 'strokeOpacity', value: n }];
  }
  if (p === 'fill') {
    const n = parseColor(v);
    if (n !== null) return [{ prop: 'fillColor', value: n }];
  }
  if (p === 'stroke') {
    const n = parseColor(v);
    if (n !== null) return [{ prop: 'strokeColor', value: n }];
  }
  if (p === 'transform') {
    const decomposed = parseCssTransform(v);
    return (Object.entries(decomposed) as [AnimatableProperty, number][])
      .map(([prop, value]) => ({ prop, value }));
  }
  return [];
}

function parseCssAnimations(svgSource: string, layers: Layer[]): { layerTracks: Map<string, TrackAccum>; maxDuration: number } {
  const layerTracks = new Map<string, TrackAccum>();
  let maxDuration = 0;

  const host = document.createElement('div');
  host.style.cssText = 'position:absolute;visibility:hidden;top:-9999px;left:-9999px;width:1px;height:1px;overflow:hidden';
  host.innerHTML = svgSource;
  document.body.appendChild(host);

  try {
    const svgEl = host.querySelector('svg');
    if (!svgEl) return { layerTracks, maxDuration };

    // Collect @keyframes rules from style sheets owned by this host
    const keyframesMap = new Map<string, CSSKeyframesRule>();
    for (const sheet of Array.from(document.styleSheets)) {
      try {
        if (!host.contains(sheet.ownerNode as Node)) continue;
        for (const rule of Array.from(sheet.cssRules)) {
          if (rule instanceof CSSKeyframesRule) {
            keyframesMap.set(rule.name, rule);
          }
        }
      } catch { /* cross-origin or inaccessible */ }
    }

    if (!keyframesMap.size) return { layerTracks, maxDuration };

    for (const layer of layers) {
      const el = svgEl.getElementById(layer.elementId);
      if (!el) continue;

      const cs = getComputedStyle(el);
      const animNames = cs.animationName.split(',').map(s => s.trim()).filter(n => n && n !== 'none');
      if (!animNames.length) continue;

      const durStrings = cs.animationDuration.split(',').map(s => s.trim());
      // timing-function can contain commas inside cubic-bezier(), so split carefully
      const timingStrings = cs.animationTimingFunction.split(/,(?![^(]*\))/).map(s => s.trim());

      const accum: TrackAccum = {};

      for (let ai = 0; ai < animNames.length; ai++) {
        const name = animNames[ai];
        const kfRule = keyframesMap.get(name);
        if (!kfRule) continue;

        const dur = parseSmilDuration(durStrings[ai] ?? '0s');
        if (!dur) continue;
        maxDuration = Math.max(maxDuration, dur);

        const globalTiming = timingStrings[ai] ?? 'ease';

        // Build keyframe steps: { pct, props }
        const steps: Array<{ pct: number; props: Record<string, string>; timing: string }> = [];
        for (const kfCssRule of Array.from(kfRule.cssRules)) {
          const kf = kfCssRule as CSSKeyframeRule;
          const keyText = kf.keyText; // "0%", "100%", "from", "to"
          const pctStr = keyText === 'from' ? '0' : keyText === 'to' ? '100' : keyText.replace('%', '');
          const pct = parseFloat(pctStr) / 100;
          const style = kf.style;
          const props: Record<string, string> = {};
          for (let pi = 0; pi < style.length; pi++) {
            const propName = style[pi];
            props[propName] = style.getPropertyValue(propName);
          }
          // timing-function within keyframe overrides global for this segment
          const timing = style.getPropertyValue('animation-timing-function') || globalTiming;
          steps.push({ pct, props, timing });
        }

        steps.sort((a, b) => a.pct - b.pct);

        // Group values per app property across keyframe steps
        const propKfs = new Map<AnimatableProperty, PropertyKeyframe[]>();

        for (let si = 0; si < steps.length; si++) {
          const step = steps[si];
          const time = step.pct * dur;
          const easing = si < steps.length - 1 ? cssTimingToEasing(step.timing) : DEFAULT_EASING;

          for (const [cssProp, cssVal] of Object.entries(step.props)) {
            if (cssProp === 'animation-timing-function') continue;
            for (const { prop, value } of parseCssPropertyValue(cssProp, cssVal)) {
              const existing = propKfs.get(prop) ?? [];
              existing.push(makeKf(time, value, easing));
              propKfs.set(prop, existing);
            }
          }
        }

        for (const [prop, kfs] of propKfs) {
          mergeKfs(accum, prop, kfs);
        }
      }

      if (Object.keys(accum).length) layerTracks.set(layer.elementId, accum);
    }
  } finally {
    document.body.removeChild(host);
  }

  return { layerTracks, maxDuration };
}

// ─── SVG source stripping ─────────────────────────────────────────────────────

function stripAnimationMarkup(svgSource: string): string {
  // Parse with DOMParser, remove SMIL elements, strip CSS animation declarations
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgSource, 'image/svg+xml');

  // Remove SMIL animation elements
  const smilTags = ['animate', 'animateTransform', 'animateMotion', 'set'];
  for (const tag of smilTags) {
    for (const el of Array.from(doc.querySelectorAll(tag))) {
      el.parentNode?.removeChild(el);
    }
  }

  // Strip CSS animation declarations from <style> elements
  for (const styleEl of Array.from(doc.querySelectorAll('style'))) {
    let css = styleEl.textContent ?? '';
    // Remove @keyframes blocks
    css = css.replace(/@keyframes\s+\S+\s*\{[^}]*(?:\{[^}]*\}[^}]*)*\}/g, '');
    // Remove animation-* properties from rules
    css = css.replace(/animation(?:-[a-z-]+)?\s*:[^;]+;?/g, '');
    styleEl.textContent = css;
  }

  return new XMLSerializer().serializeToString(doc.documentElement);
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function importAnimations(svgSource: string, layers: Layer[]): AnimationImportResult {
  const parser = new DOMParser();
  const svgDoc = parser.parseFromString(svgSource, 'image/svg+xml');

  // Check for parse error
  const parseError = svgDoc.querySelector('parsererror');
  if (parseError) return { layerTracks: new Map(), maxDuration: 0, strippedSource: svgSource };

  const smilResult = parseSmil(svgDoc, layers);
  const cssResult = parseCssAnimations(svgSource, layers);

  // Merge SMIL and CSS tracks (CSS wins on conflict for same property)
  const merged = new Map<string, Partial<PropertyTracks>>();
  for (const [id, tracks] of smilResult.layerTracks) {
    merged.set(id, { ...tracks });
  }
  for (const [id, tracks] of cssResult.layerTracks) {
    const existing = merged.get(id) ?? {};
    merged.set(id, { ...existing, ...tracks });
  }

  const maxDuration = Math.max(smilResult.maxDuration, cssResult.maxDuration);

  const strippedSource = (smilResult.maxDuration > 0 || cssResult.maxDuration > 0)
    ? stripAnimationMarkup(svgSource)
    : svgSource;

  return { layerTracks: merged, maxDuration, strippedSource };
}

export function mergeImportedTracks(layers: Layer[], layerTracks: Map<string, Partial<PropertyTracks>>): Layer[] {
  return layers.map(l => {
    const imported = layerTracks.get(l.elementId);
    if (!imported) return l;
    const merged: PropertyTracks = { ...l.tracks };
    for (const [prop, kfs] of Object.entries(imported) as [AnimatableProperty, PropertyKeyframe[]][]) {
      if (kfs && kfs.length) merged[prop] = kfs;
    }
    return { ...l, tracks: merged };
  });
}
