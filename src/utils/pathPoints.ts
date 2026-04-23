import { PathPoint, PathKeyframe, EasingConfig } from '../types';
import { evaluateEasing } from './easing';

function makeId(): string {
  return `pp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// Detect point type from handle geometry
function detectType(pt: { x: number; y: number; cpInX: number; cpInY: number; cpOutX: number; cpOutY: number }): import('../types').PointType {
  const inAt = Math.abs(pt.cpInX - pt.x) < 0.5 && Math.abs(pt.cpInY - pt.y) < 0.5;
  const outAt = Math.abs(pt.cpOutX - pt.x) < 0.5 && Math.abs(pt.cpOutY - pt.y) < 0.5;
  if (inAt && outAt) return 'corner';
  if (inAt || outAt) return 'corner';
  const inDx = pt.x - pt.cpInX, inDy = pt.y - pt.cpInY;
  const outDx = pt.cpOutX - pt.x, outDy = pt.cpOutY - pt.y;
  const inLen = Math.sqrt(inDx * inDx + inDy * inDy);
  const outLen = Math.sqrt(outDx * outDx + outDy * outDy);
  if (inLen < 0.5 || outLen < 0.5) return 'corner';
  const dot = (inDx / inLen) * (outDx / outLen) + (inDy / inLen) * (outDy / outLen);
  if (Math.abs(dot - 1) < 0.05) {
    return Math.abs(inLen - outLen) < 1 ? 'smooth' : 'asymmetric';
  }
  return 'corner';
}

function tokenize(d: string): Array<{ cmd: string; args: number[] }> {
  const segs: Array<{ cmd: string; args: number[] }> = [];
  const re = /([MmLlHhVvCcSsQqTtAaZz])|([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/g;
  let cur: { cmd: string; args: number[] } | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(d)) !== null) {
    if (m[1]) {
      if (cur) segs.push(cur);
      cur = { cmd: m[1], args: [] };
    } else if (m[2] && cur) {
      cur.args.push(parseFloat(m[2]));
    }
  }
  if (cur) segs.push(cur);
  return segs;
}

export interface ParsedPath {
  points: PathPoint[];
  closed: boolean;
}

export function parsePath(d: string): ParsedPath {
  if (!d) return { points: [], closed: false };
  const segs = tokenize(d);
  const points: PathPoint[] = [];
  let cx = 0, cy = 0, firstX = 0, firstY = 0;
  let lastCpOutX = 0, lastCpOutY = 0;
  let closed = false;
  let firstPoint = true;

  for (const { cmd, args } of segs) {
    const rel = cmd === cmd.toLowerCase() && cmd !== 'z' && cmd !== 'Z';
    const C = cmd.toUpperCase();
    switch (C) {
      case 'M': {
        for (let i = 0; i + 1 < args.length; i += 2) {
          const x = rel ? cx + args[i] : args[i];
          const y = rel ? cy + args[i + 1] : args[i + 1];
          if (firstPoint) { firstX = x; firstY = y; firstPoint = false; }
          points.push({ id: makeId(), x, y, cpInX: x, cpInY: y, cpOutX: x, cpOutY: y, type: 'corner' });
          lastCpOutX = x; lastCpOutY = y;
          cx = x; cy = y;
        }
        break;
      }
      case 'L': {
        for (let i = 0; i + 1 < args.length; i += 2) {
          const x = rel ? cx + args[i] : args[i];
          const y = rel ? cy + args[i + 1] : args[i + 1];
          points.push({ id: makeId(), x, y, cpInX: x, cpInY: y, cpOutX: x, cpOutY: y, type: 'corner' });
          lastCpOutX = x; lastCpOutY = y;
          cx = x; cy = y;
        }
        break;
      }
      case 'H': {
        for (const v of args) {
          const x = rel ? cx + v : v;
          points.push({ id: makeId(), x, y: cy, cpInX: x, cpInY: cy, cpOutX: x, cpOutY: cy, type: 'corner' });
          lastCpOutX = x; lastCpOutY = cy; cx = x;
        }
        break;
      }
      case 'V': {
        for (const v of args) {
          const y = rel ? cy + v : v;
          points.push({ id: makeId(), x: cx, y, cpInX: cx, cpInY: y, cpOutX: cx, cpOutY: y, type: 'corner' });
          lastCpOutX = cx; lastCpOutY = y; cy = y;
        }
        break;
      }
      case 'C': {
        for (let i = 0; i + 5 < args.length; i += 6) {
          const cp1x = rel ? cx + args[i]     : args[i];
          const cp1y = rel ? cy + args[i + 1] : args[i + 1];
          const cp2x = rel ? cx + args[i + 2] : args[i + 2];
          const cp2y = rel ? cy + args[i + 3] : args[i + 3];
          const x    = rel ? cx + args[i + 4] : args[i + 4];
          const y    = rel ? cy + args[i + 5] : args[i + 5];
          if (points.length > 0) {
            const prev = points[points.length - 1];
            prev.cpOutX = cp1x; prev.cpOutY = cp1y;
            prev.type = detectType(prev);
          }
          points.push({ id: makeId(), x, y, cpInX: cp2x, cpInY: cp2y, cpOutX: x, cpOutY: y, type: 'corner' });
          lastCpOutX = cp2x; lastCpOutY = cp2y;
          cx = x; cy = y;
        }
        break;
      }
      case 'S': {
        for (let i = 0; i + 3 < args.length; i += 4) {
          const cp2x = rel ? cx + args[i]     : args[i];
          const cp2y = rel ? cy + args[i + 1] : args[i + 1];
          const x    = rel ? cx + args[i + 2] : args[i + 2];
          const y    = rel ? cy + args[i + 3] : args[i + 3];
          const cp1x = 2 * cx - lastCpOutX;
          const cp1y = 2 * cy - lastCpOutY;
          if (points.length > 0) {
            const prev = points[points.length - 1];
            prev.cpOutX = cp1x; prev.cpOutY = cp1y;
            prev.type = detectType(prev);
          }
          points.push({ id: makeId(), x, y, cpInX: cp2x, cpInY: cp2y, cpOutX: x, cpOutY: y, type: 'corner' });
          lastCpOutX = cp2x; lastCpOutY = cp2y;
          cx = x; cy = y;
        }
        break;
      }
      case 'Q': {
        for (let i = 0; i + 3 < args.length; i += 4) {
          const qx = rel ? cx + args[i]     : args[i];
          const qy = rel ? cy + args[i + 1] : args[i + 1];
          const x  = rel ? cx + args[i + 2] : args[i + 2];
          const y  = rel ? cy + args[i + 3] : args[i + 3];
          const cp1x = cx + (2 / 3) * (qx - cx);
          const cp1y = cy + (2 / 3) * (qy - cy);
          const cp2x = x  + (2 / 3) * (qx - x);
          const cp2y = y  + (2 / 3) * (qy - y);
          if (points.length > 0) {
            const prev = points[points.length - 1];
            prev.cpOutX = cp1x; prev.cpOutY = cp1y;
            prev.type = detectType(prev);
          }
          points.push({ id: makeId(), x, y, cpInX: cp2x, cpInY: cp2y, cpOutX: x, cpOutY: y, type: 'corner' });
          lastCpOutX = cp2x; lastCpOutY = cp2y;
          cx = x; cy = y;
        }
        break;
      }
      case 'Z': {
        closed = true;
        cx = firstX; cy = firstY;
        break;
      }
    }
  }

  // If closed path and last point ≈ first point, merge (common in design-tool exports)
  if (closed && points.length > 1) {
    const last = points[points.length - 1];
    const first = points[0];
    if (Math.abs(last.x - first.x) < 0.5 && Math.abs(last.y - first.y) < 0.5) {
      first.cpInX = last.cpInX;
      first.cpInY = last.cpInY;
      first.type = detectType(first);
      points.pop();
    }
  }

  for (const pt of points) pt.type = detectType(pt);
  return { points, closed };
}

const FMT = (n: number) => n.toFixed(3);

export function buildPath(points: PathPoint[], closed: boolean): string {
  if (points.length === 0) return '';
  let d = `M ${FMT(points[0].x)} ${FMT(points[0].y)}`;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const isLine =
      Math.abs(prev.cpOutX - prev.x) < 0.01 && Math.abs(prev.cpOutY - prev.y) < 0.01 &&
      Math.abs(curr.cpInX - curr.x) < 0.01 && Math.abs(curr.cpInY - curr.y) < 0.01;
    if (isLine) {
      d += ` L ${FMT(curr.x)} ${FMT(curr.y)}`;
    } else {
      d += ` C ${FMT(prev.cpOutX)} ${FMT(prev.cpOutY)} ${FMT(curr.cpInX)} ${FMT(curr.cpInY)} ${FMT(curr.x)} ${FMT(curr.y)}`;
    }
  }
  if (closed && points.length > 1) {
    const last = points[points.length - 1];
    const first = points[0];
    const isLine =
      Math.abs(last.cpOutX - last.x) < 0.01 && Math.abs(last.cpOutY - last.y) < 0.01 &&
      Math.abs(first.cpInX - first.x) < 0.01 && Math.abs(first.cpInY - first.y) < 0.01;
    if (!isLine) {
      d += ` C ${FMT(last.cpOutX)} ${FMT(last.cpOutY)} ${FMT(first.cpInX)} ${FMT(first.cpInY)} ${FMT(first.x)} ${FMT(first.y)}`;
    }
    d += ' Z';
  }
  return d;
}

// Given existing keyframes and a current time, return interpolated points
// If only 1 keyframe, return its points. If 0, return null.
export function interpolatePathPoints(
  keyframes: PathKeyframe[],
  time: number
): PathPoint[] | null {
  if (keyframes.length === 0) return null;
  const sorted = [...keyframes].sort((a, b) => a.time - b.time);
  if (keyframes.length === 1) return sorted[0].points;
  if (time <= sorted[0].time) return sorted[0].points;
  if (time >= sorted[sorted.length - 1].time) return sorted[sorted.length - 1].points;

  let kf1 = sorted[0], kf2 = sorted[1];
  for (let i = 0; i < sorted.length - 1; i++) {
    if (sorted[i].time <= time && sorted[i + 1].time >= time) {
      kf1 = sorted[i]; kf2 = sorted[i + 1]; break;
    }
  }

  if (kf1.points.length !== kf2.points.length) return kf1.points;
  const span = kf2.time - kf1.time;
  if (span === 0) return kf1.points;
  const rawT = (time - kf1.time) / span;
  const t = evaluateEasing(kf1.easing, rawT);

  return kf1.points.map((pa, i) => {
    const pb = kf2.points[i];
    return {
      ...pa,
      x:      lerp(pa.x,      pb.x,      t),
      y:      lerp(pa.y,      pb.y,      t),
      cpInX:  lerp(pa.cpInX,  pb.cpInX,  t),
      cpInY:  lerp(pa.cpInY,  pb.cpInY,  t),
      cpOutX: lerp(pa.cpOutX, pb.cpOutX, t),
      cpOutY: lerp(pa.cpOutY, pb.cpOutY, t),
    };
  });
}

// When adding a new keyframe, align point IDs to an existing reference keyframe
export function alignPointIds(points: PathPoint[], reference: PathPoint[]): PathPoint[] {
  if (points.length !== reference.length) return points;
  return points.map((pt, i) => ({ ...pt, id: reference[i].id }));
}
