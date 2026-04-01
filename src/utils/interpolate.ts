import { PropertyKeyframe, AnimatableProperty, PROPERTY_DEFAULTS, PropertyTracks } from '../types';
import { evaluateEasing } from './easing';

// ─── Color helpers ────────────────────────────────────────────────────────────

export function packColor(hex: string): number {
  const h = hex.replace('#', '');
  return parseInt(h.length === 3
    ? h.split('').map(c => c + c).join('')
    : h, 16);
}

export function unpackColor(n: number): string {
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

export function interpolateColor(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff, ag = (a >> 8) & 0xff, ab = a & 0xff;
  const br = (b >> 16) & 0xff, bg = (b >> 8) & 0xff, bb = b & 0xff;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bv = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bv;
}

const COLOR_PROPS = new Set<AnimatableProperty>(['fillColor', 'strokeColor']);

// ─── Interpolation ────────────────────────────────────────────────────────────

export function interpolateProperty(
  keyframes: PropertyKeyframe[],
  time: number,
  defaultValue: number,
  property?: AnimatableProperty
): number {
  if (keyframes.length === 0) return defaultValue;

  const sorted = [...keyframes].sort((a, b) => a.time - b.time);

  if (time <= sorted[0].time) return sorted[0].value;
  if (time >= sorted[sorted.length - 1].time) return sorted[sorted.length - 1].value;

  let before = sorted[0];
  let after = sorted[1];
  for (let i = 0; i < sorted.length - 1; i++) {
    if (sorted[i].time <= time && sorted[i + 1].time >= time) {
      before = sorted[i];
      after = sorted[i + 1];
      break;
    }
  }

  const span = after.time - before.time;
  if (span === 0) return before.value;

  const rawT = (time - before.time) / span;
  const t = evaluateEasing(before.easing, rawT);

  if (property && COLOR_PROPS.has(property)) {
    return interpolateColor(before.value, after.value, t);
  }
  return before.value + (after.value - before.value) * t;
}

export function interpolateTracks(
  tracks: PropertyTracks,
  time: number
): Record<AnimatableProperty, number> {
  const result = {} as Record<AnimatableProperty, number>;
  for (const prop of Object.keys(PROPERTY_DEFAULTS) as AnimatableProperty[]) {
    result[prop] = interpolateProperty(tracks[prop], time, PROPERTY_DEFAULTS[prop], prop);
  }
  return result;
}
