import React, { useRef, useEffect, useState } from 'react';
import { useApp } from '../context/AppContext';
import { getLayerValues } from '../utils/interpolate';
import { useSnapGuides } from '../context/SnapContext';
import { snapLayerMove, computeLayerAabb, SNAP_THRESHOLD_SCREEN, LayerAabb } from '../utils/snap';

interface Props {
  svgContainerRef: React.RefObject<HTMLDivElement>;
  canvasWidth: number;
  canvasHeight: number;
  canvasZoom: number;
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
  type: 'move' | 'rotate' | 'anchor' | 'scale';
  startX?: number;
  startY?: number;
  startMx?: number;
  startMy?: number;
  kfIdX?: string;
  kfIdY?: string;
  useBaseX?: boolean;
  useBaseY?: boolean;
  startRot?: number;
  startAngle?: number;
  screenPivotX?: number;
  screenPivotY?: number;
  kfIdRot?: string;
  useBaseRot?: boolean;
  startAnchorX?: number;
  startAnchorY?: number;
  startScaleX?: number;
  startScaleY?: number;
  cornerPreScaleX?: number;
  cornerPreScaleY?: number;
  kfIdScaleX?: string;
  kfIdScaleY?: string;
  useBaseScaleX?: boolean;
  useBaseScaleY?: boolean;
  coordScaleX?: number;
  coordScaleY?: number;
  snapTargets?: LayerAabb[];
  startMovingBboxX?: number;
  startMovingBboxY?: number;
  startMovingBboxW?: number;
  startMovingBboxH?: number;
}

export default function TransformOverlay({ svgContainerRef, canvasWidth, canvasHeight, canvasZoom }: Props) {
  const { state, dispatch, getOrCreateKfAt } = useApp();
  const { setGuides } = useSnapGuides();
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

  const vals = getLayerValues(selectedLayer, state.currentTime);
  const { bboxX, bboxY, bboxW, bboxH, scaleX, scaleY, offX, offY } = coordInfo;
  const anchorX = selectedLayer.anchorX ?? 0;
  const anchorY = selectedLayer.anchorY ?? 0;

  function svgToCanvas(x: number, y: number): [number, number] {
    return [x * scaleX + offX, y * scaleY + offY];
  }

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

  const pivotSvgX = bboxX + bboxW / 2 + anchorX;
  const pivotSvgY = bboxY + bboxH / 2 + anchorY;
  const [pivotX, pivotY] = svgToCanvas(pivotSvgX + vals.x, pivotSvgY + vals.y);

  const rotRad = (vals.rotation * Math.PI) / 180;
  const cosR = Math.cos(rotRad);
  const sinR = Math.sin(rotRad);

  function getCorner(dxLocal: number, dyLocal: number): [number, number] {
    const fromPivotX = dxLocal - anchorX;
    const fromPivotY = dyLocal - anchorY;
    const sx = fromPivotX * vals.scaleX;
    const sy = fromPivotY * vals.scaleY;
    const rx = sx * cosR - sy * sinR;
    const ry = sx * sinR + sy * cosR;
    return svgToCanvas(pivotSvgX + vals.x + rx, pivotSvgY + vals.y + ry);
  }

  const hw = bboxW / 2;
  const hh = bboxH / 2;
  const [tlx, tly] = getCorner(-hw, -hh);
  const [trx, try_] = getCorner( hw, -hh);
  const [brx, bry] = getCorner( hw,  hh);
  const [blx, bly] = getCorner(-hw,  hh);

  const topCx = (tlx + trx) / 2;
  const topCy = (tly + try_) / 2;
  const edgeX = trx - tlx;
  const edgeY = try_ - tly;
  const edgeLen = Math.sqrt(edgeX * edgeX + edgeY * edgeY) || 1;
  const perpX = -edgeY / edgeLen;
  const perpY =  edgeX / edgeLen;
  const rhx = topCx + perpX * (28 / canvasZoom);
  const rhy = topCy + perpY * (28 / canvasZoom);

  // ── Move drag ──────────────────────────────────────────────────────────────
  function onMoveDragStart(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!selectedLayer || selectedLayer.locked) return;

    const xEmpty = selectedLayer.tracks.x.length === 0;
    const yEmpty = selectedLayer.tracks.y.length === 0;

    dispatch({ type: 'PUSH_SNAPSHOT' });
    const kfIdX = xEmpty ? undefined : getOrCreateKfAt(selectedLayer.id, 'x', state.currentTime, true);
    const kfIdY = yEmpty ? undefined : getOrCreateKfAt(selectedLayer.id, 'y', state.currentTime, true);

    const svgEl = svgContainerRef.current?.querySelector('svg') as SVGSVGElement | null;
    const snapTargets: LayerAabb[] = [];
    if (svgEl) {
      for (const l of state.layers) {
        if (l.id === selectedLayer.id) continue;
        const el = svgEl.getElementById(l.elementId) as SVGGraphicsElement | null;
        if (!el) continue;
        try {
          const b = el.getBBox();
          const lv = getLayerValues(l, state.currentTime);
          snapTargets.push(computeLayerAabb(b.x, b.y, b.width, b.height, lv.x, lv.y));
        } catch {}
      }
    }

    dragRef.current = {
      type: 'move',
      startX: vals.x,
      startY: vals.y,
      startMx: e.clientX,
      startMy: e.clientY,
      kfIdX,
      kfIdY,
      useBaseX: xEmpty,
      useBaseY: yEmpty,
      snapTargets,
      startMovingBboxX: bboxX,
      startMovingBboxY: bboxY,
      startMovingBboxW: bboxW,
      startMovingBboxH: bboxH,
    };

    function applySnapToDeltas(rawDx: number, rawDy: number, drag: DragState): [number, number] {
      const coord = coordRef.current;
      const containerRect = svgContainerRef.current?.getBoundingClientRect();
      if (!coord || !containerRect || !drag.snapTargets?.length) return [rawDx, rawDy];
      const candidateX = (drag.startX ?? 0) + rawDx;
      const candidateY = (drag.startY ?? 0) + rawDy;
      const movingAabb = computeLayerAabb(
        drag.startMovingBboxX!, drag.startMovingBboxY!,
        drag.startMovingBboxW!, drag.startMovingBboxH!,
        candidateX, candidateY
      );
      const snapThreshold = SNAP_THRESHOLD_SCREEN * (canvasWidth / containerRect.width) / coord.scaleX;
      const snapped = snapLayerMove(
        candidateX, candidateY, movingAabb, drag.snapTargets, snapThreshold,
        x => x * coord.scaleX + coord.offX,
        y => y * coord.scaleY + coord.offY
      );
      setGuides(snapped.guides);
      return [snapped.x - (drag.startX ?? 0), snapped.y - (drag.startY ?? 0)];
    }

    function onMouseMove(mv: MouseEvent) {
      const drag = dragRef.current;
      if (!drag || drag.type !== 'move') return;
      const rawDx = screenDxToSvg(mv.clientX - (drag.startMx ?? 0));
      const rawDy = screenDyToSvg(mv.clientY - (drag.startMy ?? 0));
      const [dx, dy] = applySnapToDeltas(rawDx, rawDy, drag);
      if (drag.useBaseX) {
        dispatch({ type: 'SET_LAYER_BASE_VALUE_SILENT', layerId: selectedLayer!.id, property: 'x', value: (drag.startX ?? 0) + dx });
      } else if (drag.kfIdX) {
        dispatch({ type: 'UPDATE_PROPERTY_KEYFRAME_SILENT', layerId: selectedLayer!.id, property: 'x', keyframeId: drag.kfIdX, value: (drag.startX ?? 0) + dx });
      }
      if (drag.useBaseY) {
        dispatch({ type: 'SET_LAYER_BASE_VALUE_SILENT', layerId: selectedLayer!.id, property: 'y', value: (drag.startY ?? 0) + dy });
      } else if (drag.kfIdY) {
        dispatch({ type: 'UPDATE_PROPERTY_KEYFRAME_SILENT', layerId: selectedLayer!.id, property: 'y', keyframeId: drag.kfIdY, value: (drag.startY ?? 0) + dy });
      }
    }

    function onMouseUp(mv: MouseEvent) {
      const drag = dragRef.current;
      dragRef.current = null;
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      if (!drag || drag.type !== 'move') { setGuides([]); return; }
      const rawDx = screenDxToSvg(mv.clientX - (drag.startMx ?? 0));
      const rawDy = screenDyToSvg(mv.clientY - (drag.startMy ?? 0));
      const [dx, dy] = applySnapToDeltas(rawDx, rawDy, drag);
      setGuides([]);
      if (drag.useBaseX) {
        dispatch({ type: 'SET_LAYER_BASE_VALUE_SILENT', layerId: selectedLayer!.id, property: 'x', value: (drag.startX ?? 0) + dx });
      } else if (drag.kfIdX) {
        dispatch({ type: 'UPDATE_PROPERTY_KEYFRAME_SILENT', layerId: selectedLayer!.id, property: 'x', keyframeId: drag.kfIdX, value: (drag.startX ?? 0) + dx });
      }
      if (drag.useBaseY) {
        dispatch({ type: 'SET_LAYER_BASE_VALUE_SILENT', layerId: selectedLayer!.id, property: 'y', value: (drag.startY ?? 0) + dy });
      } else if (drag.kfIdY) {
        dispatch({ type: 'UPDATE_PROPERTY_KEYFRAME_SILENT', layerId: selectedLayer!.id, property: 'y', keyframeId: drag.kfIdY, value: (drag.startY ?? 0) + dy });
      }
    }

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }

  // ── Rotate drag ────────────────────────────────────────────────────────────
  function onRotateDragStart(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!selectedLayer || selectedLayer.locked) return;

    const rotEmpty = selectedLayer.tracks.rotation.length === 0;
    dispatch({ type: 'PUSH_SNAPSHOT' });
    const kfIdRot = rotEmpty ? undefined : getOrCreateKfAt(selectedLayer.id, 'rotation', state.currentTime, true);

    const rect = svgContainerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const sc = rect.width / canvasWidth;
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
      useBaseRot: rotEmpty,
    };

    function onMouseMove(mv: MouseEvent) {
      const drag = dragRef.current;
      if (!drag || drag.type !== 'rotate') return;
      const newAngle = Math.atan2(mv.clientY - (drag.screenPivotY ?? 0), mv.clientX - (drag.screenPivotX ?? 0));
      const delta = ((newAngle - (drag.startAngle ?? 0)) * 180) / Math.PI;
      const newRot = (drag.startRot ?? 0) + delta;
      if (drag.useBaseRot) {
        dispatch({ type: 'SET_LAYER_BASE_VALUE_SILENT', layerId: selectedLayer!.id, property: 'rotation', value: newRot });
      } else if (drag.kfIdRot) {
        dispatch({ type: 'UPDATE_PROPERTY_KEYFRAME_SILENT', layerId: selectedLayer!.id, property: 'rotation', keyframeId: drag.kfIdRot, value: newRot });
      }
    }

    function onMouseUp(mv: MouseEvent) {
      const drag = dragRef.current;
      dragRef.current = null;
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      if (!drag || drag.type !== 'rotate') return;
      const newAngle = Math.atan2(mv.clientY - (drag.screenPivotY ?? 0), mv.clientX - (drag.screenPivotX ?? 0));
      const delta = ((newAngle - (drag.startAngle ?? 0)) * 180) / Math.PI;
      const newRot = (drag.startRot ?? 0) + delta;
      if (drag.useBaseRot) {
        dispatch({ type: 'SET_LAYER_BASE_VALUE_SILENT', layerId: selectedLayer!.id, property: 'rotation', value: newRot });
      } else if (drag.kfIdRot) {
        dispatch({ type: 'UPDATE_PROPERTY_KEYFRAME_SILENT', layerId: selectedLayer!.id, property: 'rotation', keyframeId: drag.kfIdRot, value: newRot });
      }
    }

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }

  // ── Scale drag ─────────────────────────────────────────────────────────────
  // cornerIndex: 0=TL, 1=TR, 2=BR, 3=BL
  function onScaleDragStart(e: React.MouseEvent, cornerIndex: number) {
    e.preventDefault();
    e.stopPropagation();
    if (!selectedLayer || selectedLayer.locked) return;

    const scaleXEmpty = selectedLayer.tracks.scaleX.length === 0;
    const scaleYEmpty = selectedLayer.tracks.scaleY.length === 0;

    dispatch({ type: 'PUSH_SNAPSHOT' });
    const kfIdScaleX = scaleXEmpty ? undefined : getOrCreateKfAt(selectedLayer.id, 'scaleX', state.currentTime, true);
    const kfIdScaleY = scaleYEmpty ? undefined : getOrCreateKfAt(selectedLayer.id, 'scaleY', state.currentTime, true);

    const cornerOffsets: [number, number][] = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]];
    const [dx, dy] = cornerOffsets[cornerIndex];
    const cornerPreScaleX = dx - anchorX;
    const cornerPreScaleY = dy - anchorY;

    const rect = svgContainerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const sc = rect.width / canvasWidth;
    const screenPivotX = rect.left + pivotX * sc;
    const screenPivotY = rect.top + pivotY * sc;
    const coord = coordRef.current;
    if (!coord) return;

    dragRef.current = {
      type: 'scale',
      startScaleX: vals.scaleX,
      startScaleY: vals.scaleY,
      startRot: vals.rotation,
      startMx: e.clientX,
      startMy: e.clientY,
      screenPivotX,
      screenPivotY,
      cornerPreScaleX,
      cornerPreScaleY,
      kfIdScaleX,
      kfIdScaleY,
      useBaseScaleX: scaleXEmpty,
      useBaseScaleY: scaleYEmpty,
      coordScaleX: coord.scaleX,
      coordScaleY: coord.scaleY,
    };

    function computeNewScales(mv: MouseEvent): { newScaleX: number; newScaleY: number } {
      const drag = dragRef.current!;
      const smx = mv.clientX - (drag.screenPivotX ?? 0);
      const smy = mv.clientY - (drag.screenPivotY ?? 0);
      const containerRect = svgContainerRef.current?.getBoundingClientRect();
      if (!containerRect) return { newScaleX: drag.startScaleX ?? 1, newScaleY: drag.startScaleY ?? 1 };
      const svgX = smx * (canvasWidth / containerRect.width) / (drag.coordScaleX ?? 1);
      const svgY = smy * (canvasHeight / containerRect.height) / (drag.coordScaleY ?? 1);
      const dragRotRad = ((drag.startRot ?? 0) * Math.PI) / 180;
      const cos = Math.cos(-dragRotRad);
      const sin = Math.sin(-dragRotRad);
      const localX = svgX * cos - svgY * sin;
      const localY = svgX * sin + svgY * cos;

      const cpx = drag.cornerPreScaleX ?? 1;
      const cpy = drag.cornerPreScaleY ?? 1;
      let newScaleX = Math.abs(cpx) > 0.001 ? localX / cpx : (drag.startScaleX ?? 1);
      let newScaleY = Math.abs(cpy) > 0.001 ? localY / cpy : (drag.startScaleY ?? 1);

      if (mv.shiftKey) {
        const startSX = drag.startScaleX ?? 1;
        const startSY = drag.startScaleY ?? 1;
        const initialDist = Math.sqrt((cpx * startSX) ** 2 + (cpy * startSY) ** 2);
        const currentDist = Math.sqrt(localX ** 2 + localY ** 2);
        const factor = initialDist > 0 ? currentDist / initialDist : 1;
        newScaleX = startSX * factor;
        newScaleY = startSY * factor;
      }

      return { newScaleX, newScaleY };
    }

    function onMouseMove(mv: MouseEvent) {
      const drag = dragRef.current;
      if (!drag || drag.type !== 'scale') return;
      const { newScaleX, newScaleY } = computeNewScales(mv);
      if (drag.useBaseScaleX) {
        dispatch({ type: 'SET_LAYER_BASE_VALUE_SILENT', layerId: selectedLayer!.id, property: 'scaleX', value: newScaleX });
      } else if (drag.kfIdScaleX) {
        dispatch({ type: 'UPDATE_PROPERTY_KEYFRAME_SILENT', layerId: selectedLayer!.id, property: 'scaleX', keyframeId: drag.kfIdScaleX, value: newScaleX });
      }
      if (drag.useBaseScaleY) {
        dispatch({ type: 'SET_LAYER_BASE_VALUE_SILENT', layerId: selectedLayer!.id, property: 'scaleY', value: newScaleY });
      } else if (drag.kfIdScaleY) {
        dispatch({ type: 'UPDATE_PROPERTY_KEYFRAME_SILENT', layerId: selectedLayer!.id, property: 'scaleY', keyframeId: drag.kfIdScaleY, value: newScaleY });
      }
    }

    function onMouseUp(mv: MouseEvent) {
      const drag = dragRef.current;
      dragRef.current = null;
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      if (!drag || drag.type !== 'scale') return;
      const { newScaleX, newScaleY } = computeNewScales(mv);
      if (drag.useBaseScaleX) {
        dispatch({ type: 'SET_LAYER_BASE_VALUE_SILENT', layerId: selectedLayer!.id, property: 'scaleX', value: newScaleX });
      } else if (drag.kfIdScaleX) {
        dispatch({ type: 'UPDATE_PROPERTY_KEYFRAME_SILENT', layerId: selectedLayer!.id, property: 'scaleX', keyframeId: drag.kfIdScaleX, value: newScaleX });
      }
      if (drag.useBaseScaleY) {
        dispatch({ type: 'SET_LAYER_BASE_VALUE_SILENT', layerId: selectedLayer!.id, property: 'scaleY', value: newScaleY });
      } else if (drag.kfIdScaleY) {
        dispatch({ type: 'UPDATE_PROPERTY_KEYFRAME_SILENT', layerId: selectedLayer!.id, property: 'scaleY', keyframeId: drag.kfIdScaleY, value: newScaleY });
      }
    }

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }

  // ── Anchor drag ────────────────────────────────────────────────────────────
  function onAnchorDragStart(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!selectedLayer) return;

    dispatch({ type: 'PUSH_SNAPSHOT' });
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
      dispatch({ type: 'SET_LAYER_ANCHOR_SILENT', layerId: selectedLayer!.id, anchorX: (drag.startAnchorX ?? 0) + dx, anchorY: (drag.startAnchorY ?? 0) + dy });
    }
    function onMouseUp(mv: MouseEvent) {
      const drag = dragRef.current;
      dragRef.current = null;
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      if (!drag || drag.type !== 'anchor') return;
      const dx = screenDxToSvg(mv.clientX - (drag.startMx ?? 0));
      const dy = screenDyToSvg(mv.clientY - (drag.startMy ?? 0));
      dispatch({ type: 'SET_LAYER_ANCHOR_SILENT', layerId: selectedLayer!.id, anchorX: (drag.startAnchorX ?? 0) + dx, anchorY: (drag.startAnchorY ?? 0) + dy });
    }
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }

  const polyPoints = `${tlx},${tly} ${trx},${try_} ${brx},${bry} ${blx},${bly}`;
  const corners: [number, number][] = [[tlx, tly], [trx, try_], [brx, bry], [blx, bly]];
  const cornerCursors = ['nw-resize', 'ne-resize', 'se-resize', 'sw-resize'];

  return (
    <svg
      ref={overlayRef}
      className="transform-overlay"
      viewBox={`0 0 ${canvasWidth} ${canvasHeight}`}
      style={{ pointerEvents: 'none', width: '100%', height: '100%' }}
    >
      {/* Bounding box polygon */}
      <polygon
        points={polyPoints}
        fill="transparent"
        stroke="#0092FF"
        strokeWidth={1.5 / canvasZoom}
        strokeDasharray={`${4 / canvasZoom},${3 / canvasZoom}`}
        style={{ pointerEvents: 'all', cursor: 'move' }}
        onMouseDown={onMoveDragStart}
      />

      {/* Corner handles — sizes divided by canvasZoom so they stay constant on screen */}
      {corners.map(([hx, hy], i) => (
        <rect
          key={i}
          x={hx - 5 / canvasZoom} y={hy - 5 / canvasZoom}
          width={10 / canvasZoom} height={10 / canvasZoom}
          fill="#0092FF" stroke="#333333" strokeWidth={1 / canvasZoom} rx={1 / canvasZoom}
          style={{ pointerEvents: 'all', cursor: cornerCursors[i] }}
          onMouseDown={(e) => onScaleDragStart(e, i)}
        />
      ))}

      {/* Line to rotation handle */}
      <line
        x1={topCx} y1={topCy}
        x2={rhx} y2={rhy}
        stroke="#0092FF" strokeWidth={1 / canvasZoom} strokeDasharray={`${3 / canvasZoom},${2 / canvasZoom}`}
        style={{ pointerEvents: 'none' }}
      />

      {/* Rotation handle */}
      <circle
        cx={rhx} cy={rhy} r={6 / canvasZoom}
        fill="#0092FF" stroke="#333333" strokeWidth={2 / canvasZoom}
        style={{ pointerEvents: 'all', cursor: 'crosshair' }}
        onMouseDown={onRotateDragStart}
      />

      {/* Anchor handle (pivot point) */}
      <g style={{ pointerEvents: 'all', cursor: 'crosshair' }} onMouseDown={onAnchorDragStart}>
        <circle cx={pivotX} cy={pivotY} r={9 / canvasZoom} fill="transparent" />
        <line x1={pivotX - 7 / canvasZoom} y1={pivotY} x2={pivotX + 7 / canvasZoom} y2={pivotY} stroke="#f7c542" strokeWidth={1.5 / canvasZoom} />
        <line x1={pivotX} y1={pivotY - 7 / canvasZoom} x2={pivotX} y2={pivotY + 7 / canvasZoom} stroke="#f7c542" strokeWidth={1.5 / canvasZoom} />
        <circle cx={pivotX} cy={pivotY} r={3 / canvasZoom} fill="none" stroke="#f7c542" strokeWidth={1.5 / canvasZoom} />
      </g>
    </svg>
  );
}
