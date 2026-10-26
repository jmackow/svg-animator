import React, { useRef, useEffect, useState } from 'react';
import { useApp } from '../context/AppContext';
import { getLayerValues } from '../utils/interpolate';
import { useSnapGuides } from '../context/SnapContext';
import { snapLayerMove, computeLayerAabb, SNAP_THRESHOLD_SCREEN, LayerAabb } from '../utils/snap';
import { Layer } from '../types';

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
  startAnchorX?: number;
  startAnchorY?: number;
  startScaleX?: number;
  startScaleY?: number;
  cornerPreScaleX?: number;
  cornerPreScaleY?: number;
  coordScaleX?: number;
  coordScaleY?: number;
  snapTargets?: LayerAabb[];
  startMovingBboxX?: number;
  startMovingBboxY?: number;
  startMovingBboxW?: number;
  startMovingBboxH?: number;
  additionalMoves?: Array<{ layerId: string; startX: number; startY: number; kfIdX?: string; kfIdY?: string; useBaseX: boolean; useBaseY: boolean }>;
  groupStarts?: LayerTransformStart[];
  withPosition?: boolean;
}

// Per-layer state captured when a rotate/scale drag begins. `offX/offY` is the
// layer's distance from the selection's pivot, which is what lets a whole group
// swing or grow around a common centre rather than each layer about its own.
interface LayerTransformStart {
  layerId: string;
  offX: number;
  offY: number;
  startX: number;
  startY: number;
  startRot: number;
  startScaleX: number;
  startScaleY: number;
  kfX?: string;
  kfY?: string;
  kfRot?: string;
  kfScaleX?: string;
  kfScaleY?: string;
  baseX: boolean;
  baseY: boolean;
  baseRot: boolean;
  baseScaleX: boolean;
  baseScaleY: boolean;
}

// Axis-aligned union of every selected layer's box, each offset by its animated
// position. Individual rotation/scale is deliberately ignored so the group box
// stays upright and predictable.
function unionBBox(
  svgEl: SVGSVGElement,
  layers: Layer[],
  time: number
): { x: number; y: number; width: number; height: number } | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const layer of layers) {
    const node = svgEl.getElementById(layer.elementId) as SVGGraphicsElement | null;
    if (!node) continue;
    try {
      const b = node.getBBox();
      const v = getLayerValues(layer, time);
      minX = Math.min(minX, b.x + v.x);
      minY = Math.min(minY, b.y + v.y);
      maxX = Math.max(maxX, b.x + b.width + v.x);
      maxY = Math.max(maxY, b.y + b.height + v.y);
    } catch { /* element has no geometry */ }
  }
  if (minX === Infinity) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export default function TransformOverlay({ svgContainerRef, canvasWidth, canvasHeight, canvasZoom }: Props) {
  const { state, dispatch, getOrCreateKfAt } = useApp();
  const { setGuides } = useSnapGuides();
  const overlayRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const coordRef = useRef<CoordInfo | null>(null);
  const [coordInfo, setCoordInfo] = useState<CoordInfo | null>(null);

  const selectedLayer = state.layers.find((l) => l.id === state.selectedLayerId);
  const selectedLayers = state.layers.filter(l => state.selectedLayerIds.includes(l.id));
  const isMulti = selectedLayers.length > 1;
  const selectionKey = state.selectedLayerIds.join(',');

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
      // With several layers selected the box spans all of them, each shifted by
      // its own animated offset, so the handles act on the selection as a whole.
      const b = isMulti
        ? unionBBox(svgEl, selectedLayers, state.currentTime) ?? el.getBBox()
        : el.getBBox();
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
  }, [selectedLayer, selectionKey, state.svgSource, state.currentTime, svgContainerRef, canvasWidth, canvasHeight]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!selectedLayer || !coordInfo) return null;

  const vals = getLayerValues(selectedLayer, state.currentTime);
  const { bboxX, bboxY, bboxW, bboxH, scaleX, scaleY, offX, offY } = coordInfo;
  const anchorX = selectedLayer.anchorX ?? 0;
  const anchorY = selectedLayer.anchorY ?? 0;

  // A multi-selection has no single rotation/scale of its own, so the box is drawn
  // upright around the union — the per-layer values still drive each shape.
  const boxVals = isMulti ? { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 } : vals;
  const boxAnchorX = isMulti ? 0 : anchorX;
  const boxAnchorY = isMulti ? 0 : anchorY;

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

  const pivotSvgX = bboxX + bboxW / 2 + boxAnchorX;
  const pivotSvgY = bboxY + bboxH / 2 + boxAnchorY;
  const [pivotX, pivotY] = svgToCanvas(pivotSvgX + boxVals.x, pivotSvgY + boxVals.y);

  const rotRad = (boxVals.rotation * Math.PI) / 180;
  const cosR = Math.cos(rotRad);
  const sinR = Math.sin(rotRad);

  function getCorner(dxLocal: number, dyLocal: number): [number, number] {
    const fromPivotX = dxLocal - boxAnchorX;
    const fromPivotY = dyLocal - boxAnchorY;
    const sx = fromPivotX * boxVals.scaleX;
    const sy = fromPivotY * boxVals.scaleY;
    const rx = sx * cosR - sy * sinR;
    const ry = sx * sinR + sy * cosR;
    return svgToCanvas(pivotSvgX + boxVals.x + rx, pivotSvgY + boxVals.y + ry);
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

    // Capture start state for every other selected layer
    const additionalMoves = state.selectedLayerIds
      .filter(id => id !== selectedLayer.id)
      .map(id => {
        const l = state.layers.find(layer => layer.id === id);
        if (!l || l.locked) return null;
        const lxEmpty = l.tracks.x.length === 0;
        const lyEmpty = l.tracks.y.length === 0;
        const lv = getLayerValues(l, state.currentTime);
        return {
          layerId: id,
          startX: lv.x,
          startY: lv.y,
          kfIdX: lxEmpty ? undefined : getOrCreateKfAt(id, 'x', state.currentTime, true),
          kfIdY: lyEmpty ? undefined : getOrCreateKfAt(id, 'y', state.currentTime, true),
          useBaseX: lxEmpty,
          useBaseY: lyEmpty,
        };
      })
      .filter((m): m is NonNullable<typeof m> => m !== null);

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
      additionalMoves,
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

    function applyMoveTo(
      layerId: string, sx: number, sy: number,
      kfX: string | undefined, kfY: string | undefined,
      useX: boolean, useY: boolean, dx: number, dy: number
    ) {
      if (useX) dispatch({ type: 'SET_LAYER_BASE_VALUE_SILENT', layerId, property: 'x', value: sx + dx });
      else if (kfX) dispatch({ type: 'UPDATE_PROPERTY_KEYFRAME_SILENT', layerId, property: 'x', keyframeId: kfX, value: sx + dx });
      if (useY) dispatch({ type: 'SET_LAYER_BASE_VALUE_SILENT', layerId, property: 'y', value: sy + dy });
      else if (kfY) dispatch({ type: 'UPDATE_PROPERTY_KEYFRAME_SILENT', layerId, property: 'y', keyframeId: kfY, value: sy + dy });
    }

    function onMouseMove(mv: MouseEvent) {
      const drag = dragRef.current;
      if (!drag || drag.type !== 'move') return;
      const rawDx = screenDxToSvg(mv.clientX - (drag.startMx ?? 0));
      const rawDy = screenDyToSvg(mv.clientY - (drag.startMy ?? 0));
      const [dx, dy] = applySnapToDeltas(rawDx, rawDy, drag);
      applyMoveTo(selectedLayer!.id, drag.startX ?? 0, drag.startY ?? 0, drag.kfIdX, drag.kfIdY, drag.useBaseX ?? true, drag.useBaseY ?? true, dx, dy);
      for (const am of drag.additionalMoves ?? []) {
        applyMoveTo(am.layerId, am.startX, am.startY, am.kfIdX, am.kfIdY, am.useBaseX, am.useBaseY, dx, dy);
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
      applyMoveTo(selectedLayer!.id, drag.startX ?? 0, drag.startY ?? 0, drag.kfIdX, drag.kfIdY, drag.useBaseX ?? true, drag.useBaseY ?? true, dx, dy);
      for (const am of drag.additionalMoves ?? []) {
        applyMoveTo(am.layerId, am.startX, am.startY, am.kfIdX, am.kfIdY, am.useBaseX, am.useBaseY, dx, dy);
      }
    }

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }

  // ── Shared helpers for group rotate/scale ──────────────────────────────────

  function writeProp(
    layerId: string,
    property: 'x' | 'y' | 'rotation' | 'scaleX' | 'scaleY',
    kfId: string | undefined,
    useBase: boolean,
    value: number
  ) {
    if (useBase) {
      dispatch({ type: 'SET_LAYER_BASE_VALUE_SILENT', layerId, property, value });
    } else if (kfId) {
      dispatch({ type: 'UPDATE_PROPERTY_KEYFRAME_SILENT', layerId, property, keyframeId: kfId, value });
    }
  }

  // Snapshots every selected layer relative to the selection pivot. `needPosition`
  // is false for a lone layer, which turns about its own anchor and so never needs
  // its x/y rewritten.
  function captureGroupStarts(needPosition: boolean, kind: 'rotate' | 'scale'): LayerTransformStart[] {
    const svgEl = svgContainerRef.current?.querySelector('svg') as SVGSVGElement | null;
    const out: LayerTransformStart[] = [];

    for (const layer of selectedLayers) {
      if (layer.locked) continue;
      const v = getLayerValues(layer, state.currentTime);

      let offXv = 0, offYv = 0;
      if (needPosition && svgEl) {
        const node = svgEl.getElementById(layer.elementId) as SVGGraphicsElement | null;
        if (node) {
          try {
            const b = node.getBBox();
            offXv = b.x + b.width / 2 + (layer.anchorX ?? 0) + v.x - pivotSvgX;
            offYv = b.y + b.height / 2 + (layer.anchorY ?? 0) + v.y - pivotSvgY;
          } catch { /* no geometry */ }
        }
      }

      const rotEmpty = layer.tracks.rotation.length === 0;
      const sxEmpty = layer.tracks.scaleX.length === 0;
      const syEmpty = layer.tracks.scaleY.length === 0;
      const xEmpty = layer.tracks.x.length === 0;
      const yEmpty = layer.tracks.y.length === 0;

      out.push({
        layerId: layer.id,
        offX: offXv,
        offY: offYv,
        startX: v.x,
        startY: v.y,
        startRot: v.rotation,
        startScaleX: v.scaleX,
        startScaleY: v.scaleY,
        // Only key the properties this drag actually writes — keying the others
        // would litter the tracks with keyframes the user never asked for.
        kfRot: kind !== 'rotate' || rotEmpty ? undefined : getOrCreateKfAt(layer.id, 'rotation', state.currentTime, true),
        kfScaleX: kind !== 'scale' || sxEmpty ? undefined : getOrCreateKfAt(layer.id, 'scaleX', state.currentTime, true),
        kfScaleY: kind !== 'scale' || syEmpty ? undefined : getOrCreateKfAt(layer.id, 'scaleY', state.currentTime, true),
        kfX: !needPosition || xEmpty ? undefined : getOrCreateKfAt(layer.id, 'x', state.currentTime, true),
        kfY: !needPosition || yEmpty ? undefined : getOrCreateKfAt(layer.id, 'y', state.currentTime, true),
        baseRot: rotEmpty,
        baseScaleX: sxEmpty,
        baseScaleY: syEmpty,
        baseX: xEmpty,
        baseY: yEmpty,
      });
    }
    return out;
  }

  // ── Rotate drag ────────────────────────────────────────────────────────────
  function onRotateDragStart(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!selectedLayer || (!isMulti && selectedLayer.locked)) return;

    dispatch({ type: 'PUSH_SNAPSHOT' });
    const groupStarts = captureGroupStarts(isMulti, 'rotate');
    if (groupStarts.length === 0) return;

    const rect = svgContainerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const sc = rect.width / canvasWidth;
    const screenPivotX = rect.left + pivotX * sc;
    const screenPivotY = rect.top + pivotY * sc;
    const startAngle = Math.atan2(e.clientY - screenPivotY, e.clientX - screenPivotX);

    dragRef.current = {
      type: 'rotate',
      startAngle,
      screenPivotX,
      screenPivotY,
      groupStarts,
      withPosition: isMulti,
    };

    function applyRotate(mv: MouseEvent) {
      const drag = dragRef.current;
      if (!drag || drag.type !== 'rotate') return;
      const newAngle = Math.atan2(mv.clientY - (drag.screenPivotY ?? 0), mv.clientX - (drag.screenPivotX ?? 0));
      const deltaDeg = ((newAngle - (drag.startAngle ?? 0)) * 180) / Math.PI;
      const rad = (deltaDeg * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);

      for (const g of drag.groupStarts ?? []) {
        writeProp(g.layerId, 'rotation', g.kfRot, g.baseRot, g.startRot + deltaDeg);
        if (!drag.withPosition) continue;
        // Swing the layer around the selection pivot as well as spinning it.
        const rx = g.offX * cos - g.offY * sin;
        const ry = g.offX * sin + g.offY * cos;
        writeProp(g.layerId, 'x', g.kfX, g.baseX, g.startX + (rx - g.offX));
        writeProp(g.layerId, 'y', g.kfY, g.baseY, g.startY + (ry - g.offY));
      }
    }

    function onMouseMove(mv: MouseEvent) { applyRotate(mv); }

    function onMouseUp(mv: MouseEvent) {
      applyRotate(mv);
      dragRef.current = null;
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    }

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }

  // ── Scale drag ─────────────────────────────────────────────────────────────
  // cornerIndex: 0=TL, 1=TR, 2=BR, 3=BL
  function onScaleDragStart(e: React.MouseEvent, cornerIndex: number) {
    e.preventDefault();
    e.stopPropagation();
    if (!selectedLayer || (!isMulti && selectedLayer.locked)) return;

    dispatch({ type: 'PUSH_SNAPSHOT' });
    const groupStarts = captureGroupStarts(isMulti, 'scale');
    if (groupStarts.length === 0) return;

    const cornerOffsets: [number, number][] = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]];
    const [dx, dy] = cornerOffsets[cornerIndex];
    const cornerPreScaleX = dx - boxAnchorX;
    const cornerPreScaleY = dy - boxAnchorY;

    const rect = svgContainerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const sc = rect.width / canvasWidth;
    const screenPivotX = rect.left + pivotX * sc;
    const screenPivotY = rect.top + pivotY * sc;
    const coord = coordRef.current;
    if (!coord) return;

    dragRef.current = {
      type: 'scale',
      // Scale is computed against the box the handles belong to, then applied to
      // each layer as a multiplier on whatever it was already scaled to.
      startScaleX: boxVals.scaleX,
      startScaleY: boxVals.scaleY,
      startRot: boxVals.rotation,
      startMx: e.clientX,
      startMy: e.clientY,
      screenPivotX,
      screenPivotY,
      cornerPreScaleX,
      cornerPreScaleY,
      coordScaleX: coord.scaleX,
      coordScaleY: coord.scaleY,
      groupStarts,
      withPosition: isMulti,
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

    function applyScale(mv: MouseEvent) {
      const drag = dragRef.current;
      if (!drag || drag.type !== 'scale') return;
      const { newScaleX, newScaleY } = computeNewScales(mv);
      // Ratio of the box's new size to its size when the drag began.
      const fx = (drag.startScaleX ?? 1) !== 0 ? newScaleX / (drag.startScaleX ?? 1) : 1;
      const fy = (drag.startScaleY ?? 1) !== 0 ? newScaleY / (drag.startScaleY ?? 1) : 1;

      for (const g of drag.groupStarts ?? []) {
        writeProp(g.layerId, 'scaleX', g.kfScaleX, g.baseScaleX, g.startScaleX * fx);
        writeProp(g.layerId, 'scaleY', g.kfScaleY, g.baseScaleY, g.startScaleY * fy);
        if (!drag.withPosition) continue;
        // Spread the layers apart by the same factor so the group grows as one.
        writeProp(g.layerId, 'x', g.kfX, g.baseX, g.startX + (g.offX * fx - g.offX));
        writeProp(g.layerId, 'y', g.kfY, g.baseY, g.startY + (g.offY * fy - g.offY));
      }
    }

    function onMouseMove(mv: MouseEvent) { applyScale(mv); }

    function onMouseUp(mv: MouseEvent) {
      applyScale(mv);
      dragRef.current = null;
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
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
      {/* Bounding box polygon — full area interactive for drag-to-move; PathPointOverlay renders
          on top in DOM order so anchor circles intercept their area first */}
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

      {/* Anchor handle (pivot point). Hidden for a multi-selection, where the
          pivot belongs to the group box rather than to any one layer's anchor. */}
      {!isMulti && (
        <g style={{ pointerEvents: 'all', cursor: 'crosshair' }} onMouseDown={onAnchorDragStart}>
          <circle cx={pivotX} cy={pivotY} r={9 / canvasZoom} fill="transparent" />
          <line x1={pivotX - 7 / canvasZoom} y1={pivotY} x2={pivotX + 7 / canvasZoom} y2={pivotY} stroke="#f7c542" strokeWidth={1.5 / canvasZoom} />
          <line x1={pivotX} y1={pivotY - 7 / canvasZoom} x2={pivotX} y2={pivotY + 7 / canvasZoom} stroke="#f7c542" strokeWidth={1.5 / canvasZoom} />
          <circle cx={pivotX} cy={pivotY} r={3 / canvasZoom} fill="none" stroke="#f7c542" strokeWidth={1.5 / canvasZoom} />
        </g>
      )}
    </svg>
  );
}
