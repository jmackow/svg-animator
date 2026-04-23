import React, { useEffect, useCallback, useRef } from 'react';
import { useApp } from '../context/AppContext';
import { PathPoint, PathKeyframe, DEFAULT_EASING } from '../types';
import { parsePath, buildPath, interpolatePathPoints, alignPointIds } from '../utils/pathPoints';
import { useSnapGuides } from '../context/SnapContext';
import { snapPointMove, SNAP_THRESHOLD_SCREEN, PointSnapTarget } from '../utils/snap';

interface Props {
  svgContainerRef: React.RefObject<HTMLDivElement>;
  canvasFrameRef: React.RefObject<HTMLDivElement>;
  canvasZoom: number;
}

// Get the CTM of the specific layer element (includes CSS transforms like translate from position kfs).
// Falls back to SVG root CTM if element not found.
function getElementCTM(svgContainerRef: React.RefObject<HTMLDivElement>, elementId: string): DOMMatrix | null {
  const svgEl = svgContainerRef.current?.querySelector('svg') as SVGSVGElement | null;
  if (!svgEl) return null;
  const el = svgEl.getElementById(elementId) as SVGGraphicsElement | null;
  return (el?.getScreenCTM() ?? svgEl.getScreenCTM());
}

// Get the mapping from element-local coords → canvas frame CSS pixels (frame-local, unscaled).
// Uses element's getScreenCTM (includes CSS transforms) then divides by canvasZoom.
function getMapping(svgContainerRef: React.RefObject<HTMLDivElement>, canvasFrameRef: React.RefObject<HTMLDivElement>, canvasZoom: number, elementId: string): { scaleX: number; scaleY: number; offX: number; offY: number } | null {
  const ctm = getElementCTM(svgContainerRef, elementId);
  if (!ctm) return null;
  const frameRect = canvasFrameRef.current?.getBoundingClientRect();
  if (!frameRect) return null;
  return {
    scaleX: ctm.a / canvasZoom,
    scaleY: ctm.d / canvasZoom,
    offX: (ctm.e - frameRect.left) / canvasZoom,
    offY: (ctm.f - frameRect.top) / canvasZoom,
  };
}

// Element-local coords → overlay CSS px (frame-local)
function userToFrame(x: number, y: number, m: { scaleX: number; scaleY: number; offX: number; offY: number }): { x: number; y: number } {
  return { x: x * m.scaleX + m.offX, y: y * m.scaleY + m.offY };
}

// Convert mouse client coords → element-local coords (accounts for element's CSS transform)
function clientToUser(clientX: number, clientY: number, svgContainerRef: React.RefObject<HTMLDivElement>, elementId: string): { x: number; y: number } | null {
  const ctm = getElementCTM(svgContainerRef, elementId);
  if (!ctm) return null;
  return { x: (clientX - ctm.e) / ctm.a, y: (clientY - ctm.f) / ctm.d };
}

function makeKfId() { return `pkf-${Date.now()}-${Math.random().toString(36).slice(2)}`; }

export default function PathPointOverlay({ svgContainerRef, canvasFrameRef, canvasZoom }: Props) {
  const { state, dispatch } = useApp();
  const { setGuides } = useSnapGuides();
  // Cache parsed points by "elementId:d" so IDs stay stable across renders
  const parsedCacheRef = useRef<{ key: string; points: PathPoint[] } | null>(null);

  const { selectedLayerId, selectedPointId, currentTime, layers, selectedPathKfIds } = state;
  const layer = layers.find(l => l.id === selectedLayerId);
  const isPathLike = layer && ['path', 'polyline', 'polygon', 'rect', 'circle', 'ellipse'].includes(layer.tagName.toLowerCase());

  const livePoints = isPathLike && layer
    ? interpolatePathPoints(layer.pathKeyframes ?? [], currentTime)
    : null;

  const getElD = useCallback((): string | null => {
    if (!layer) return null;
    const svgEl = svgContainerRef.current?.querySelector('svg') as SVGSVGElement | null;
    if (!svgEl) return null;
    const el = svgEl.getElementById(layer.elementId);
    return el?.getAttribute('d') ?? null;
  }, [layer, svgContainerRef]);

  // Apply animated `d` back to the element when path keyframes are active
  useEffect(() => {
    if (!layer?.pathKeyframes?.length || !livePoints) return;
    const svgEl = svgContainerRef.current?.querySelector('svg') as SVGSVGElement | null;
    if (!svgEl) return;
    const el = svgEl.getElementById(layer.elementId);
    if (!el) return;
    const closed = (layer.pathKeyframes[0]?.closed) ?? false;
    el.setAttribute('d', buildPath(livePoints, closed));
  }, [livePoints, layer, svgContainerRef]);

  // Get or create a path keyframe at current time, returns the kf id + points
  function getOrCreateKf(): { kfId: string; points: PathPoint[]; closed: boolean } | null {
    if (!layer) return null;
    const existing = (layer.pathKeyframes ?? []).find(kf => Math.abs(kf.time - currentTime) < 0.001);
    if (existing) return { kfId: existing.id, points: existing.points, closed: existing.closed };

    const d = getElD();
    if (!d) return null;
    const { points, closed } = parsePath(d);
    const ref = layer.pathKeyframes?.[0];
    const aligned = ref ? alignPointIds(points, ref.points) : points;
    if (ref && aligned.length !== ref.points.length) return null;

    const newKf: PathKeyframe = { id: makeKfId(), time: currentTime, points: aligned, closed, easing: DEFAULT_EASING, movedPointIds: [] };
    dispatch({ type: 'ADD_PATH_KEYFRAME', layerId: layer.id, keyframe: newKf });
    return { kfId: newKf.id, points: aligned, closed };
  }

  function startPointDrag(e: React.MouseEvent, pointId: string) {
    e.preventDefault();
    e.stopPropagation();
    dispatch({ type: 'SELECT_POINT', pointId });

    // Capture start position but don't create a keyframe yet — only on actual drag
    const startUserRaw = clientToUser(e.clientX, e.clientY, svgContainerRef, layer!.elementId);
    if (!startUserRaw) return;
    const startUX = startUserRaw.x, startUY = startUserRaw.y;
    const layerId = layer!.id;

    // Build snap targets once at drag start
    const snapCtm = getElementCTM(svgContainerRef, layer!.elementId);
    const snapMapping = getMapping(svgContainerRef, canvasFrameRef, canvasZoom, layer!.elementId);
    const snapTargets: PointSnapTarget[] = [];
    if (snapCtm && snapMapping && displayPoints) {
      for (const p of displayPoints) {
        if (p.id === pointId) continue;
        snapTargets.push({
          screenX: p.x * snapCtm.a + snapCtm.e,
          screenY: p.y * snapCtm.d + snapCtm.f,
          frameX: userToFrame(p.x, p.y, snapMapping).x,
          frameY: userToFrame(p.x, p.y, snapMapping).y,
        });
      }
      const svgEl = svgContainerRef.current?.querySelector('svg') as SVGSVGElement | null;
      if (svgEl) {
        for (const l of state.layers) {
          if (l.id === layer!.id) continue;
          if (!['path', 'polyline', 'polygon'].includes(l.tagName.toLowerCase())) continue;
          const el = svgEl.getElementById(l.elementId) as SVGGraphicsElement | null;
          if (!el) continue;
          const otherCtm = el.getScreenCTM();
          const otherMapping = getMapping(svgContainerRef, canvasFrameRef, canvasZoom, l.elementId);
          if (!otherCtm || !otherMapping) continue;
          const d = el.getAttribute('d');
          if (!d) continue;
          try {
            const { points: otherPts } = parsePath(d);
            for (const p of otherPts) {
              snapTargets.push({
                screenX: p.x * otherCtm.a + otherCtm.e,
                screenY: p.y * otherCtm.d + otherCtm.f,
                frameX: userToFrame(p.x, p.y, otherMapping).x,
                frameY: userToFrame(p.x, p.y, otherMapping).y,
              });
            }
          } catch {}
        }
      }
    }

    let kfId: string | null = null;
    let pts: PathPoint[] = [];

    function onMove(mv: MouseEvent) {
      const cur = clientToUser(mv.clientX, mv.clientY, svgContainerRef, layer!.elementId);
      if (!cur) return;
      let dx = cur.x - startUX, dy = cur.y - startUY;
      if (Math.abs(dx) < 0.3 && Math.abs(dy) < 0.3 && !kfId) return;

      // Apply snapping
      if (snapCtm && snapTargets.length) {
        const snapped = snapPointMove(startUX, startUY, dx, dy, snapCtm, snapTargets, SNAP_THRESHOLD_SCREEN);
        dx = snapped.dx;
        dy = snapped.dy;
        setGuides(snapped.guides);
      }

      // Lazily get or create keyframe on first real movement
      if (!kfId) {
        const kfData = getOrCreateKf();
        if (!kfData) return;
        kfId = kfData.kfId;
        pts = kfData.points.map(p => ({ ...p }));
      }

      const newPoints = pts.map(p => p.id !== pointId ? p : {
        ...p,
        x: p.x + dx, y: p.y + dy,
        cpInX: p.cpInX + dx, cpInY: p.cpInY + dy,
        cpOutX: p.cpOutX + dx, cpOutY: p.cpOutY + dy,
      });
      dispatch({ type: 'UPDATE_PATH_KEYFRAME_SILENT', layerId, keyframeId: kfId!, points: newPoints, movedPointId: pointId });
    }
    function onUp(mv: MouseEvent) {
      setGuides([]);
      if (kfId) {
        const cur = clientToUser(mv.clientX, mv.clientY, svgContainerRef, layer!.elementId);
        if (cur) {
          let dx = cur.x - startUX, dy = cur.y - startUY;
          if (snapCtm && snapTargets.length) {
            const snapped = snapPointMove(startUX, startUY, dx, dy, snapCtm, snapTargets, SNAP_THRESHOLD_SCREEN);
            dx = snapped.dx;
            dy = snapped.dy;
          }
          const newPoints = pts.map(p => p.id !== pointId ? p : {
            ...p,
            x: p.x + dx, y: p.y + dy,
            cpInX: p.cpInX + dx, cpInY: p.cpInY + dy,
            cpOutX: p.cpOutX + dx, cpOutY: p.cpOutY + dy,
          });
          dispatch({ type: 'UPDATE_PATH_KEYFRAME', layerId, keyframeId: kfId, points: newPoints, movedPointId: pointId });
        }
      }
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  function startHandleDrag(e: React.MouseEvent, pointId: string, handle: 'in' | 'out') {
    e.preventDefault();
    e.stopPropagation();

    const startUserRaw2 = clientToUser(e.clientX, e.clientY, svgContainerRef, layer!.elementId);
    if (!startUserRaw2) return;
    const startUX2 = startUserRaw2.x, startUY2 = startUserRaw2.y;
    const layerId = layer!.id;

    let kfId: string | null = null;
    let pts: PathPoint[] = [];

    function applyHandleDelta(p: PathPoint, dx: number, dy: number): PathPoint {
      const pt = { ...p };
      if (handle === 'out') {
        pt.cpOutX = p.cpOutX + dx; pt.cpOutY = p.cpOutY + dy;
        if (p.type === 'smooth') {
          const len = Math.sqrt((p.cpInX - p.x) ** 2 + (p.cpInY - p.y) ** 2);
          const odx = pt.cpOutX - p.x, ody = pt.cpOutY - p.y;
          const olen = Math.sqrt(odx * odx + ody * ody);
          if (olen > 0) { pt.cpInX = p.x - (odx / olen) * len; pt.cpInY = p.y - (ody / olen) * len; }
        }
      } else {
        pt.cpInX = p.cpInX + dx; pt.cpInY = p.cpInY + dy;
        if (p.type === 'smooth') {
          const len = Math.sqrt((p.cpOutX - p.x) ** 2 + (p.cpOutY - p.y) ** 2);
          const idx = pt.cpInX - p.x, idy = pt.cpInY - p.y;
          const ilen = Math.sqrt(idx * idx + idy * idy);
          if (ilen > 0) { pt.cpOutX = p.x - (idx / ilen) * len; pt.cpOutY = p.y - (idy / ilen) * len; }
        }
      }
      return pt;
    }

    function onMove(mv: MouseEvent) {
      const cur = clientToUser(mv.clientX, mv.clientY, svgContainerRef, layer!.elementId);
      if (!cur) return;
      const dx = cur.x - startUX2, dy = cur.y - startUY2;
      if (!kfId && Math.abs(dx) < 0.3 && Math.abs(dy) < 0.3) return;

      if (!kfId) {
        const kfData = getOrCreateKf();
        if (!kfData) return;
        kfId = kfData.kfId;
        pts = kfData.points.map(p => ({ ...p }));
      }

      const newPoints = pts.map(p => p.id !== pointId ? p : applyHandleDelta(p, dx, dy));
      dispatch({ type: 'UPDATE_PATH_KEYFRAME_SILENT', layerId, keyframeId: kfId!, points: newPoints, movedPointId: pointId });
    }
    function onUp(mv: MouseEvent) {
      if (kfId) {
        const cur = clientToUser(mv.clientX, mv.clientY, svgContainerRef, layer!.elementId);
        if (cur) {
          const dx = cur.x - startUX2, dy = cur.y - startUY2;
          const newPoints = pts.map(p => p.id !== pointId ? p : applyHandleDelta(p, dx, dy));
          dispatch({ type: 'UPDATE_PATH_KEYFRAME', layerId, keyframeId: kfId, points: newPoints, movedPointId: pointId });
        }
      }
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  if (!isPathLike || !layer) return null;

  // Decide which points to render
  let displayPoints: PathPoint[] | null = (livePoints?.length ?? 0) > 0 ? livePoints : null;
  if (!displayPoints) {
    const d = getElD();
    if (d) {
      const cacheKey = `${layer.elementId}:${d}`;
      if (parsedCacheRef.current?.key !== cacheKey) {
        parsedCacheRef.current = { key: cacheKey, points: parsePath(d).points };
      }
      displayPoints = parsedCacheRef.current.points;
    }
  }
  if (!displayPoints || displayPoints.length === 0) return null;

  const hasKfs = (layer.pathKeyframes?.length ?? 0) > 0;
  const kfAtPlayhead = (layer.pathKeyframes ?? []).some(kf => Math.abs(kf.time - currentTime) < 0.001);
  const pointsWithKfs = new Set<string>();
  for (const pkf of layer.pathKeyframes ?? []) {
    for (const pt of pkf.points) pointsWithKfs.add(pt.id);
  }

  const mapping = getMapping(svgContainerRef, canvasFrameRef, canvasZoom, layer.elementId);
  if (!mapping) return null;

  // Constant screen-pixel sizes regardless of zoom
  const ANCHOR_R = 5;
  const HANDLE_R = 3.5;
  const STROKE = 1.5;
  const DASH = '4 3';

  const selectedPt = displayPoints.find(p => p.id === selectedPointId);

  return (
    <svg
      style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', overflow: 'visible', pointerEvents: 'none' }}
    >
      {displayPoints.map((pt) => {
        const a  = userToFrame(pt.x,      pt.y,      mapping);
        const ci = userToFrame(pt.cpInX,  pt.cpInY,  mapping);
        const co = userToFrame(pt.cpOutX, pt.cpOutY, mapping);

        const isSelected = pt.id === selectedPointId;
        // Point is part of a timeline-selected path keyframe
        const hasSelectedKf = (layer.pathKeyframes ?? []).some(kf =>
          selectedPathKfIds.includes(kf.id) && kf.movedPointIds?.includes(pt.id)
        );

        const hasInHandle  = Math.abs(pt.cpInX  - pt.x) > 0.5 || Math.abs(pt.cpInY  - pt.y) > 0.5;
        const hasOutHandle = Math.abs(pt.cpOutX - pt.x) > 0.5 || Math.abs(pt.cpOutY - pt.y) > 0.5;

        const PURPLE = '#7c6cf7';
        const PURPLE_DIM = '#7c6cf799';

        return (
          <g key={pt.id}>
            {isSelected && hasInHandle && (
              <line x1={a.x} y1={a.y} x2={ci.x} y2={ci.y}
                stroke={PURPLE} strokeWidth={STROKE} strokeDasharray={DASH} opacity={0.6} />
            )}
            {isSelected && hasOutHandle && (
              <line x1={a.x} y1={a.y} x2={co.x} y2={co.y}
                stroke={PURPLE} strokeWidth={STROKE} strokeDasharray={DASH} opacity={0.6} />
            )}
            {isSelected && hasInHandle && (
              <circle cx={ci.x} cy={ci.y} r={HANDLE_R}
                fill="#fff" stroke={PURPLE} strokeWidth={STROKE}
                style={{ pointerEvents: 'all', cursor: 'crosshair' }}
                onMouseDown={(e) => startHandleDrag(e, pt.id, 'in')}
              />
            )}
            {isSelected && hasOutHandle && (
              <circle cx={co.x} cy={co.y} r={HANDLE_R}
                fill="#fff" stroke={PURPLE} strokeWidth={STROKE}
                style={{ pointerEvents: 'all', cursor: 'crosshair' }}
                onMouseDown={(e) => startHandleDrag(e, pt.id, 'out')}
              />
            )}
            {hasSelectedKf && (
              <circle cx={a.x} cy={a.y} r={ANCHOR_R + 3}
                fill="none" stroke="#fff" strokeWidth={1.5} opacity={0.8} style={{ pointerEvents: 'none' }} />
            )}
            <circle
              cx={a.x} cy={a.y} r={ANCHOR_R}
              fill={isSelected ? PURPLE : PURPLE_DIM}
              stroke={isSelected ? '#fff' : PURPLE}
              strokeWidth={isSelected ? 1.5 : 1}
              style={{ pointerEvents: 'all', cursor: 'move' }}
              onMouseDown={(e) => startPointDrag(e, pt.id)}
            />
          </g>
        );
      })}

      {hasKfs && !kfAtPlayhead && selectedPt && (() => {
        const sp = userToFrame(selectedPt.x, selectedPt.y, mapping);
        return (
          <text x={sp.x + 10} y={sp.y - 8} fontSize={10} fill="#f5c542" style={{ pointerEvents: 'none' }}>
            ◆ click ◆ to add shape keyframe
          </text>
        );
      })()}
    </svg>
  );
}
