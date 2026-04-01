import React, { useRef, useEffect, useState } from 'react';
import { useApp } from '../context/AppContext';
import { interpolateTracks } from '../utils/interpolate';

interface Props {
  svgContainerRef: React.RefObject<HTMLDivElement>;
  canvasWidth: number;
  canvasHeight: number;
}

// Describes how to convert SVG user coords → overlay canvas coords
// canvasX = svgX * scaleX + offX
interface CoordInfo {
  scaleX: number;
  scaleY: number;
  offX: number;
  offY: number;
  bboxX: number;
  bboxY: number;
  bboxW: number;
  bboxH: number;
}

interface DragState {
  type: 'move' | 'rotate' | 'anchor';
  startX?: number;
  startY?: number;
  startMx?: number;
  startMy?: number;
  kfIdX?: string;
  kfIdY?: string;
  startRot?: number;
  startAngle?: number;
  screenPivotX?: number;
  screenPivotY?: number;
  kfIdRot?: string;
  startAnchorX?: number;
  startAnchorY?: number;
}

export default function TransformOverlay({ svgContainerRef, canvasWidth, canvasHeight }: Props) {
  const { state, dispatch, getOrCreateKfAt } = useApp();
  const overlayRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const coordRef = useRef<CoordInfo | null>(null);
  const [coordInfo, setCoordInfo] = useState<CoordInfo | null>(null);

  const selectedLayer = state.layers.find((l) => l.id === state.selectedLayerId);

  useEffect(() => {
    if (!selectedLayer) {
      setCoordInfo(null);
      coordRef.current = null;
      return;
    }

    const container = svgContainerRef.current;
    if (!container) return;
    const svgEl = container.querySelector('svg') as SVGSVGElement | null;
    if (!svgEl) return;

    const el = svgEl.getElementById(selectedLayer.elementId) as SVGGraphicsElement | null;
    if (!el) {
      setCoordInfo(null);
      coordRef.current = null;
      return;
    }

    try {
      const b = el.getBBox();
      const containerRect = container.getBoundingClientRect();
      const svgCTM = svgEl.getScreenCTM();

      let scaleX = 1, scaleY = 1, offX = 0, offY = 0;

      if (svgCTM && containerRect.width > 0) {
        // svgCTM maps SVG user coords → screen coords
        // We want SVG user coords → overlay canvas coords
        // overlay canvas coords: viewBox is 0..canvasWidth, 0..canvasHeight
        // screen rect of the container = containerRect
        // screenX = svgX * svgCTM.a + svgCTM.e
        // canvasX = (screenX - containerRect.left) * (canvasWidth / containerRect.width)
        //         = svgX * (svgCTM.a * canvasWidth / containerRect.width)
        //           + (svgCTM.e - containerRect.left) * (canvasWidth / containerRect.width)
        const screenToCanvas = canvasWidth / containerRect.width;
        scaleX = svgCTM.a * screenToCanvas;
        scaleY = svgCTM.d * screenToCanvas;
        offX = (svgCTM.e - containerRect.left) * screenToCanvas;
        offY = (svgCTM.f - containerRect.top) * (canvasHeight / containerRect.height);
      }

      const info: CoordInfo = {
        scaleX, scaleY, offX, offY,
        bboxX: b.x, bboxY: b.y, bboxW: b.width, bboxH: b.height,
      };
      setCoordInfo(info);
      coordRef.current = info;
    } catch {
      setCoordInfo(null);
      coordRef.current = null;
    }
  }, [selectedLayer, state.svgSource, state.currentTime, svgContainerRef, canvasWidth, canvasHeight]);

  if (!selectedLayer || !coordInfo) return null;

  const vals = interpolateTracks(selectedLayer.tracks, state.currentTime);
  const { bboxX, bboxY, bboxW, bboxH, scaleX, scaleY, offX, offY } = coordInfo;
  const anchorX = selectedLayer.anchorX ?? 0;
  const anchorY = selectedLayer.anchorY ?? 0;

  // Convert SVG user coords → overlay canvas coords
  function svgToCanvas(x: number, y: number): [number, number] {
    return [x * scaleX + offX, y * scaleY + offY];
  }

  // Screen delta → SVG user delta (for drag handlers)
  function screenDxToSvg(sdx: number): number {
    const rect = svgContainerRef.current?.getBoundingClientRect();
    if (!rect) return sdx;
    return sdx * (canvasWidth / rect.width) / scaleX;
  }
  function screenDyToSvg(sdy: number): number {
    const rect = svgContainerRef.current?.getBoundingClientRect();
    if (!rect) return sdy;
    return sdy * (canvasHeight / rect.height) / scaleY;
  }

  // Pivot (anchor) in SVG user coords, before CSS translation
  const pivotSvgX = bboxX + bboxW / 2 + anchorX;
  const pivotSvgY = bboxY + bboxH / 2 + anchorY;
  // Pivot in canvas coords after CSS translation
  const [pivotX, pivotY] = svgToCanvas(pivotSvgX + vals.x, pivotSvgY + vals.y);

  const rotRad = (vals.rotation * Math.PI) / 180;
  const cosR = Math.cos(rotRad);
  const sinR = Math.sin(rotRad);

  // Transform a point offset from bbox center (SVG user coords) → canvas coords
  // applying CSS scale → rotate → translate with pivot as origin
  function getCorner(dxLocal: number, dyLocal: number): [number, number] {
    // Offset from pivot in SVG user coords (before scale)
    const fromPivotX = dxLocal - anchorX;
    const fromPivotY = dyLocal - anchorY;
    // Apply scale
    const sx = fromPivotX * vals.scaleX;
    const sy = fromPivotY * vals.scaleY;
    // Apply rotation
    const rx = sx * cosR - sy * sinR;
    const ry = sx * sinR + sy * cosR;
    // Pivot + translate + rotated offset, in SVG user coords
    return svgToCanvas(pivotSvgX + vals.x + rx, pivotSvgY + vals.y + ry);
  }

  const hw = bboxW / 2;
  const hh = bboxH / 2;
  const [tlx, tly] = getCorner(-hw, -hh);
  const [trx, try_] = getCorner( hw, -hh);
  const [brx, bry] = getCorner( hw,  hh);
  const [blx, bly] = getCorner(-hw,  hh);

  // Rotation handle: 28 canvas units above the top center, perpendicular to top edge
  const topCx = (tlx + trx) / 2;
  const topCy = (tly + try_) / 2;
  const edgeX = trx - tlx;
  const edgeY = try_ - tly;
  const edgeLen = Math.sqrt(edgeX * edgeX + edgeY * edgeY) || 1;
  const perpX = -edgeY / edgeLen;
  const perpY =  edgeX / edgeLen;
  const rhx = topCx + perpX * 28;
  const rhy = topCy + perpY * 28;

  // ── Move drag ──────────────────────────────────────────────────────────────
  function onMoveDragStart(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!selectedLayer || selectedLayer.locked) return;

    const kfIdX = getOrCreateKfAt(selectedLayer.id, 'x', state.currentTime);
    const kfIdY = getOrCreateKfAt(selectedLayer.id, 'y', state.currentTime);

    dragRef.current = {
      type: 'move',
      startX: vals.x,
      startY: vals.y,
      startMx: e.clientX,
      startMy: e.clientY,
      kfIdX,
      kfIdY,
    };

    function onMouseMove(mv: MouseEvent) {
      const drag = dragRef.current;
      if (!drag || drag.type !== 'move') return;
      const dx = screenDxToSvg(mv.clientX - (drag.startMx ?? 0));
      const dy = screenDyToSvg(mv.clientY - (drag.startMy ?? 0));
      if (drag.kfIdX)
        dispatch({ type: 'UPDATE_PROPERTY_KEYFRAME_SILENT', layerId: selectedLayer!.id, property: 'x', keyframeId: drag.kfIdX, value: (drag.startX ?? 0) + dx });
      if (drag.kfIdY)
        dispatch({ type: 'UPDATE_PROPERTY_KEYFRAME_SILENT', layerId: selectedLayer!.id, property: 'y', keyframeId: drag.kfIdY, value: (drag.startY ?? 0) + dy });
    }

    function onMouseUp(mv: MouseEvent) {
      const drag = dragRef.current;
      dragRef.current = null;
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      if (!drag || drag.type !== 'move') return;
      const dx = screenDxToSvg(mv.clientX - (drag.startMx ?? 0));
      const dy = screenDyToSvg(mv.clientY - (drag.startMy ?? 0));
      if (drag.kfIdX)
        dispatch({ type: 'UPDATE_PROPERTY_KEYFRAME', layerId: selectedLayer!.id, property: 'x', keyframeId: drag.kfIdX, value: (drag.startX ?? 0) + dx });
      if (drag.kfIdY)
        dispatch({ type: 'UPDATE_PROPERTY_KEYFRAME', layerId: selectedLayer!.id, property: 'y', keyframeId: drag.kfIdY, value: (drag.startY ?? 0) + dy });
    }

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }

  // ── Rotate drag ────────────────────────────────────────────────────────────
  function onRotateDragStart(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!selectedLayer || selectedLayer.locked) return;

    const kfIdRot = getOrCreateKfAt(selectedLayer.id, 'rotation', state.currentTime);

    // Pivot screen position: pivotX/Y are in canvas coords
    const rect = svgContainerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const sc = rect.width / canvasWidth; // screen px per canvas unit
    const screenPivotX = rect.left + pivotX * sc;
    const screenPivotY = rect.top + pivotY * sc;
    const startAngle = Math.atan2(e.clientY - screenPivotY, e.clientX - screenPivotX);

    dragRef.current = {
      type: 'rotate',
      startRot: vals.rotation,
      startAngle,
      screenPivotX,
      screenPivotY,
      kfIdRot,
    };

    function onMouseMove(mv: MouseEvent) {
      const drag = dragRef.current;
      if (!drag || drag.type !== 'rotate') return;
      const newAngle = Math.atan2(mv.clientY - (drag.screenPivotY ?? 0), mv.clientX - (drag.screenPivotX ?? 0));
      const delta = ((newAngle - (drag.startAngle ?? 0)) * 180) / Math.PI;
      if (drag.kfIdRot)
        dispatch({ type: 'UPDATE_PROPERTY_KEYFRAME_SILENT', layerId: selectedLayer!.id, property: 'rotation', keyframeId: drag.kfIdRot, value: (drag.startRot ?? 0) + delta });
    }

    function onMouseUp(mv: MouseEvent) {
      const drag = dragRef.current;
      dragRef.current = null;
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      if (!drag || drag.type !== 'rotate') return;
      const newAngle = Math.atan2(mv.clientY - (drag.screenPivotY ?? 0), mv.clientX - (drag.screenPivotX ?? 0));
      const delta = ((newAngle - (drag.startAngle ?? 0)) * 180) / Math.PI;
      if (drag.kfIdRot)
        dispatch({ type: 'UPDATE_PROPERTY_KEYFRAME', layerId: selectedLayer!.id, property: 'rotation', keyframeId: drag.kfIdRot, value: (drag.startRot ?? 0) + delta });
    }

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }

  // ── Anchor drag ────────────────────────────────────────────────────────────
  function onAnchorDragStart(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!selectedLayer) return;

    dragRef.current = {
      type: 'anchor',
      startAnchorX: anchorX,
      startAnchorY: anchorY,
      startMx: e.clientX,
      startMy: e.clientY,
    };

    function onMouseMove(mv: MouseEvent) {
      const drag = dragRef.current;
      if (!drag || drag.type !== 'anchor') return;
      const dx = screenDxToSvg(mv.clientX - (drag.startMx ?? 0));
      const dy = screenDyToSvg(mv.clientY - (drag.startMy ?? 0));
      dispatch({ type: 'SET_LAYER_ANCHOR', layerId: selectedLayer!.id, anchorX: (drag.startAnchorX ?? 0) + dx, anchorY: (drag.startAnchorY ?? 0) + dy });
    }
    function onMouseUp() {
      dragRef.current = null;
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    }
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }

  const polyPoints = `${tlx},${tly} ${trx},${try_} ${brx},${bry} ${blx},${bly}`;

  return (
    <svg
      ref={overlayRef}
      className="transform-overlay"
      width={canvasWidth}
      height={canvasHeight}
      viewBox={`0 0 ${canvasWidth} ${canvasHeight}`}
      style={{ pointerEvents: 'none' }}
    >
      {/* Bounding box polygon */}
      <polygon
        points={polyPoints}
        fill="transparent"
        stroke="#0092FF"
        strokeWidth={1.5}
        strokeDasharray="4,3"
        style={{ pointerEvents: 'all', cursor: 'move' }}
        onMouseDown={onMoveDragStart}
      />

      {/* Corner handles */}
      {([[tlx, tly], [trx, try_], [brx, bry], [blx, bly]] as [number, number][]).map(([hx, hy], i) => (
        <rect
          key={i}
          x={hx - 4} y={hy - 4}
          width={8} height={8}
          fill="#0092FF" stroke="#333333" strokeWidth={1} rx={1}
          style={{ pointerEvents: 'all', cursor: 'move' }}
          onMouseDown={onMoveDragStart}
        />
      ))}

      {/* Line to rotation handle */}
      <line
        x1={topCx} y1={topCy}
        x2={rhx} y2={rhy}
        stroke="#0092FF" strokeWidth={1} strokeDasharray="3,2"
        style={{ pointerEvents: 'none' }}
      />

      {/* Rotation handle */}
      <circle
        cx={rhx} cy={rhy} r={6}
        fill="#0092FF" stroke="#333333" strokeWidth={2}
        style={{ pointerEvents: 'all', cursor: 'crosshair' }}
        onMouseDown={onRotateDragStart}
      />

      {/* Anchor handle (pivot point) */}
      <g style={{ pointerEvents: 'all', cursor: 'crosshair' }} onMouseDown={onAnchorDragStart}>
        <circle cx={pivotX} cy={pivotY} r={9} fill="transparent" />
        <line x1={pivotX - 7} y1={pivotY} x2={pivotX + 7} y2={pivotY} stroke="#f7c542" strokeWidth={1.5} />
        <line x1={pivotX} y1={pivotY - 7} x2={pivotX} y2={pivotY + 7} stroke="#f7c542" strokeWidth={1.5} />
        <circle cx={pivotX} cy={pivotY} r={3} fill="none" stroke="#f7c542" strokeWidth={1.5} />
      </g>
    </svg>
  );
}
