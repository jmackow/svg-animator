export const SNAP_THRESHOLD_SCREEN = 8;

export interface SnapGuide {
  axis: 'x' | 'y';
  position: number; // canvas frame coordinate (px)
}

// Axis-aligned bounding box of a layer in SVG user space, after CSS translation
export interface LayerAabb {
  left: number;
  right: number;
  centerX: number;
  top: number;
  bottom: number;
  centerY: number;
}

export function computeLayerAabb(
  bboxX: number, bboxY: number, bboxW: number, bboxH: number,
  translateX: number, translateY: number,
): LayerAabb {
  return {
    left:    bboxX + translateX,
    right:   bboxX + bboxW + translateX,
    centerX: bboxX + bboxW / 2 + translateX,
    top:     bboxY + translateY,
    bottom:  bboxY + bboxH + translateY,
    centerY: bboxY + bboxH / 2 + translateY,
  };
}

export interface LayerSnapResult {
  x: number;
  y: number;
  guides: SnapGuide[];
}

// Snap a layer being moved (by its CSS translate x/y) to edge/center candidates of other layers.
// All values in SVG user space. svgToCanvas* converts SVG coords → canvas frame px for guide rendering.
export function snapLayerMove(
  candidateX: number,
  candidateY: number,
  movingAabb: LayerAabb,
  targets: LayerAabb[],
  threshold: number,
  svgToCanvasX: (x: number) => number,
  svgToCanvasY: (y: number) => number,
): LayerSnapResult {
  const xCandidates = [movingAabb.left, movingAabb.centerX, movingAabb.right];
  const yCandidates = [movingAabb.top,  movingAabb.centerY, movingAabb.bottom];

  let bestXDelta = Infinity, bestXTarget = 0;
  let bestYDelta = Infinity, bestYTarget = 0;

  for (const t of targets) {
    for (const tx of [t.left, t.centerX, t.right]) {
      for (const mx of xCandidates) {
        const d = tx - mx;
        if (Math.abs(d) < threshold && Math.abs(d) < Math.abs(bestXDelta)) {
          bestXDelta = d;
          bestXTarget = tx;
        }
      }
    }
    for (const ty of [t.top, t.centerY, t.bottom]) {
      for (const my of yCandidates) {
        const d = ty - my;
        if (Math.abs(d) < threshold && Math.abs(d) < Math.abs(bestYDelta)) {
          bestYDelta = d;
          bestYTarget = ty;
        }
      }
    }
  }

  const guides: SnapGuide[] = [];
  let snappedX = candidateX, snappedY = candidateY;

  if (isFinite(bestXDelta)) {
    snappedX = candidateX + bestXDelta;
    guides.push({ axis: 'x', position: svgToCanvasX(bestXTarget) });
  }
  if (isFinite(bestYDelta)) {
    snappedY = candidateY + bestYDelta;
    guides.push({ axis: 'y', position: svgToCanvasY(bestYTarget) });
  }

  return { x: snappedX, y: snappedY, guides };
}

// Pre-computed snap target for path point snapping
export interface PointSnapTarget {
  screenX: number;
  screenY: number;
  frameX: number; // canvas frame px for guide rendering
  frameY: number;
}

export interface PointSnapResult {
  dx: number;
  dy: number;
  guides: SnapGuide[];
}

// Snap a path point drag. Returns the (possibly snapped) delta to apply to the point.
// startPX/Y = point's position at drag start in element-local coords.
// rawDx/Y = unsnapped delta in element-local coords.
// ctm = element's current screen CTM (element-local → screen).
export function snapPointMove(
  startPX: number,
  startPY: number,
  rawDx: number,
  rawDy: number,
  ctm: DOMMatrix,
  targets: PointSnapTarget[],
  screenThreshold: number,
): PointSnapResult {
  const candLocalX = startPX + rawDx;
  const candLocalY = startPY + rawDy;
  const screenCandX = candLocalX * ctm.a + ctm.e;
  const screenCandY = candLocalY * ctm.d + ctm.f;

  let bestDist = screenThreshold;
  let bestTarget: PointSnapTarget | null = null;

  for (const t of targets) {
    const dist = Math.hypot(t.screenX - screenCandX, t.screenY - screenCandY);
    if (dist < bestDist) {
      bestDist = dist;
      bestTarget = t;
    }
  }

  if (!bestTarget) return { dx: rawDx, dy: rawDy, guides: [] };

  return {
    dx: (bestTarget.screenX - ctm.e) / ctm.a - startPX,
    dy: (bestTarget.screenY - ctm.f) / ctm.d - startPY,
    guides: [
      { axis: 'x', position: bestTarget.frameX },
      { axis: 'y', position: bestTarget.frameY },
    ],
  };
}
