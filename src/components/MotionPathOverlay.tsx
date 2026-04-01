import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useApp } from '../context/AppContext';

interface Props {
  svgContainerRef: React.RefObject<HTMLDivElement>;
  canvasFrameRef: React.RefObject<HTMLDivElement>;
  canvasWidth: number;
  canvasHeight: number;
  canvasZoom: number;
}

// ─── Path node data structure ────────────────────────────────────────────────
// All coordinates are in SVG user space (same as getBBox, same as offset-path)

interface PathNode {
  x: number;
  y: number;
  cpOutX: number; // out control handle; equals (x,y) for corner points
  cpOutY: number;
  cpInX: number;  // in control handle; equals (x,y) for corner points
  cpInY: number;
}

function cornerNode(x: number, y: number): PathNode {
  return { x, y, cpOutX: x, cpOutY: y, cpInX: x, cpInY: y };
}

function isCurved(prev: PathNode, curr: PathNode): boolean {
  return !(prev.cpOutX === prev.x && prev.cpOutY === prev.y && curr.cpInX === curr.x && curr.cpInY === curr.y);
}

function buildPathFromNodes(nodes: PathNode[]): string {
  if (nodes.length === 0) return '';
  const parts = [`M ${fmt(nodes[0].x)},${fmt(nodes[0].y)}`];
  for (let i = 1; i < nodes.length; i++) {
    const p = nodes[i - 1], c = nodes[i];
    if (isCurved(p, c)) {
      parts.push(`C ${fmt(p.cpOutX)},${fmt(p.cpOutY)} ${fmt(c.cpInX)},${fmt(c.cpInY)} ${fmt(c.x)},${fmt(c.y)}`);
    } else {
      parts.push(`L ${fmt(c.x)},${fmt(c.y)}`);
    }
  }
  return parts.join(' ');
}

function fmt(n: number): string { return n.toFixed(3); }

// Parse stored SVG path d string into PathNodes for editing
function parsePathNodes(d: string): PathNode[] {
  if (!d) return [];
  const nodes: PathNode[] = [];
  const re = /([MLCSmlcs])\s*([-\d.,\s]*)/g;
  let cur: [number, number] = [0, 0];
  let lastCp2: [number, number] | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(d)) !== null) {
    const cmd = m[1];
    const nums = m[2].trim().split(/[,\s]+/).filter(Boolean).map(Number);
    if (cmd === 'M' || cmd === 'm') {
      const x = cmd === 'M' ? nums[0] : cur[0] + nums[0];
      const y = cmd === 'M' ? nums[1] : cur[1] + nums[1];
      nodes.push(cornerNode(x, y));
      cur = [x, y]; lastCp2 = null;
    } else if (cmd === 'L' || cmd === 'l') {
      for (let i = 0; i < nums.length; i += 2) {
        const x = cmd === 'L' ? nums[i] : cur[0] + nums[i];
        const y = cmd === 'L' ? nums[i + 1] : cur[1] + nums[i + 1];
        if (nodes.length > 0) {
          const prev = nodes[nodes.length - 1];
          nodes[nodes.length - 1] = { ...prev, cpOutX: prev.x, cpOutY: prev.y };
        }
        nodes.push(cornerNode(x, y));
        cur = [x, y]; lastCp2 = null;
      }
    } else if (cmd === 'C' || cmd === 'c') {
      for (let i = 0; i < nums.length; i += 6) {
        const rel = cmd === 'c';
        const cp1x = rel ? cur[0] + nums[i]   : nums[i];
        const cp1y = rel ? cur[1] + nums[i+1] : nums[i+1];
        const cp2x = rel ? cur[0] + nums[i+2] : nums[i+2];
        const cp2y = rel ? cur[1] + nums[i+3] : nums[i+3];
        const x    = rel ? cur[0] + nums[i+4] : nums[i+4];
        const y    = rel ? cur[1] + nums[i+5] : nums[i+5];
        if (nodes.length > 0) {
          nodes[nodes.length - 1] = { ...nodes[nodes.length - 1], cpOutX: cp1x, cpOutY: cp1y };
        }
        nodes.push({ x, y, cpInX: cp2x, cpInY: cp2y, cpOutX: x, cpOutY: y });
        cur = [x, y]; lastCp2 = [cp2x, cp2y];
      }
    } else if (cmd === 'S' || cmd === 's') {
      for (let i = 0; i < nums.length; i += 4) {
        const rel = cmd === 's';
        const cp1x = lastCp2 ? 2 * cur[0] - lastCp2[0] : cur[0];
        const cp1y = lastCp2 ? 2 * cur[1] - lastCp2[1] : cur[1];
        const cp2x = rel ? cur[0] + nums[i]   : nums[i];
        const cp2y = rel ? cur[1] + nums[i+1] : nums[i+1];
        const x    = rel ? cur[0] + nums[i+2] : nums[i+2];
        const y    = rel ? cur[1] + nums[i+3] : nums[i+3];
        if (nodes.length > 0) {
          nodes[nodes.length - 1] = { ...nodes[nodes.length - 1], cpOutX: cp1x, cpOutY: cp1y };
        }
        nodes.push({ x, y, cpInX: cp2x, cpInY: cp2y, cpOutX: x, cpOutY: y });
        cur = [x, y]; lastCp2 = [cp2x, cp2y];
      }
    }
  }
  return nodes;
}

// ─── Coordinate helpers ───────────────────────────────────────────────────────

interface CoordMap {
  scaleX: number;
  scaleY: number;
  offX: number;
  offY: number;
  ctmA: number; // for inverse: userX = (clientX - ctmE) / ctmA
  ctmD: number;
  ctmE: number;
  ctmF: number;
}

function getCoordMap(
  svgContainerRef: React.RefObject<HTMLDivElement>,
  canvasWidth: number,
  canvasHeight: number
): CoordMap | null {
  const container = svgContainerRef.current;
  if (!container) return null;
  const svgEl = container.querySelector('svg') as SVGSVGElement | null;
  if (!svgEl) return null;
  const ctm = svgEl.getScreenCTM();
  const rect = container.getBoundingClientRect();
  if (!ctm || rect.width === 0) return null;
  const s = canvasWidth / rect.width;
  return {
    scaleX: ctm.a * s,
    scaleY: ctm.d * s,
    offX: (ctm.e - rect.left) * s,
    offY: (ctm.f - rect.top) * (canvasHeight / rect.height),
    ctmA: ctm.a, ctmD: ctm.d, ctmE: ctm.e, ctmF: ctm.f,
  };
}

// Convert screen client coords → SVG user coords
function clientToUser(clientX: number, clientY: number, map: CoordMap): [number, number] {
  return [(clientX - map.ctmE) / map.ctmA, (clientY - map.ctmF) / map.ctmD];
}

// Convert SVG user coords → overlay canvas coords
function userToCanvas(ux: number, uy: number, map: CoordMap): [number, number] {
  return [ux * map.scaleX + map.offX, uy * map.scaleY + map.offY];
}

// Build a canvas-space path string from SVG user-space nodes
function buildCanvasPath(nodes: PathNode[], map: CoordMap): string {
  if (nodes.length === 0) return '';
  const c = (n: PathNode) => userToCanvas(n.x, n.y, map);
  const co = (n: PathNode) => userToCanvas(n.cpOutX, n.cpOutY, map);
  const ci = (n: PathNode) => userToCanvas(n.cpInX, n.cpInY, map);

  const parts = [`M ${fmt(c(nodes[0])[0])},${fmt(c(nodes[0])[1])}`];
  for (let i = 1; i < nodes.length; i++) {
    const p = nodes[i - 1], curr = nodes[i];
    if (isCurved(p, curr)) {
      const [ox, oy] = co(p), [ix, iy] = ci(curr), [ax, ay] = c(curr);
      parts.push(`C ${fmt(ox)},${fmt(oy)} ${fmt(ix)},${fmt(iy)} ${fmt(ax)},${fmt(ay)}`);
    } else {
      const [ax, ay] = c(curr);
      parts.push(`L ${fmt(ax)},${fmt(ay)}`);
    }
  }
  return parts.join(' ');
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function MotionPathOverlay({
  svgContainerRef, canvasFrameRef, canvasWidth, canvasHeight, canvasZoom
}: Props) {
  const { state, dispatch } = useApp();
  const { motionPaths, drawingMotionPathId, selectedMotionPathId } = state;

  const isDrawing = drawingMotionPathId !== null;

  // Drawing state
  const [drawNodes, setDrawNodes] = useState<PathNode[]>([]);
  const [previewNode, setPreviewNode] = useState<PathNode | null>(null); // node being dragged
  const [mousePos, setMousePos] = useState<[number, number] | null>(null); // in SVG user coords
  const mouseDownRef = useRef<{ clientX: number; clientY: number; userX: number; userY: number } | null>(null);
  const isDraggingHandleRef = useRef(false);

  // Coord map cached per frame
  const mapRef = useRef<CoordMap | null>(null);

  function getMap(): CoordMap | null {
    const m = getCoordMap(svgContainerRef, canvasWidth, canvasHeight);
    mapRef.current = m;
    return m;
  }

  // Reset drawing state when drawing is cancelled/finished
  useEffect(() => {
    if (!isDrawing) {
      setDrawNodes([]);
      setPreviewNode(null);
      setMousePos(null);
      mouseDownRef.current = null;
      isDraggingHandleRef.current = false;
    }
  }, [isDrawing]);

  // ── Drawing interaction ────────────────────────────────────────────────────

  function handleOverlayMouseDown(e: React.MouseEvent<SVGSVGElement>) {
    if (!isDrawing) return;
    e.preventDefault();
    const map = getMap();
    if (!map) return;
    const [ux, uy] = clientToUser(e.clientX, e.clientY, map);
    mouseDownRef.current = { clientX: e.clientX, clientY: e.clientY, userX: ux, userY: uy };
    isDraggingHandleRef.current = false;
  }

  function handleOverlayMouseMove(e: React.MouseEvent<SVGSVGElement>) {
    if (!isDrawing) return;
    const map = getMap();
    if (!map) return;
    const [ux, uy] = clientToUser(e.clientX, e.clientY, map);
    setMousePos([ux, uy]);

    const down = mouseDownRef.current;
    if (!down || !(e.buttons & 1)) return;

    const dist = Math.hypot(e.clientX - down.clientX, e.clientY - down.clientY);
    if (dist > 4) {
      isDraggingHandleRef.current = true;
      // Symmetric handles: out = drag direction from anchor, in = reflection
      const dx = ux - down.userX;
      const dy = uy - down.userY;
      const node: PathNode = {
        x: down.userX, y: down.userY,
        cpOutX: down.userX + dx, cpOutY: down.userY + dy,
        cpInX:  down.userX - dx, cpInY:  down.userY - dy,
      };
      setPreviewNode(node);
    }
  }

  function handleOverlayMouseUp(e: React.MouseEvent<SVGSVGElement>) {
    if (!isDrawing) return;
    const down = mouseDownRef.current;
    if (!down) return;
    mouseDownRef.current = null;

    const map = getMap();
    if (!map) return;
    const [ux, uy] = clientToUser(e.clientX, e.clientY, map);

    const node: PathNode = isDraggingHandleRef.current && previewNode
      ? previewNode
      : cornerNode(down.userX, down.userY);

    isDraggingHandleRef.current = false;
    setPreviewNode(null);
    setDrawNodes(prev => [...prev, node]);
    setMousePos([ux, uy]);
  }

  function handleOverlayDoubleClick(e: React.MouseEvent<SVGSVGElement>) {
    if (!isDrawing || !drawingMotionPathId) return;
    e.preventDefault();
    // Remove the last point (added by the preceding single-click event)
    const finalNodes = drawNodes.slice(0, -1);
    if (finalNodes.length >= 2) {
      dispatch({ type: 'UPDATE_MOTION_PATH_D', id: drawingMotionPathId, d: buildPathFromNodes(finalNodes) });
    }
    dispatch({ type: 'SET_DRAWING_MOTION_PATH', id: null });
  }

  // ESC / Enter key handler
  useEffect(() => {
    if (!isDrawing) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        dispatch({ type: 'SET_DRAWING_MOTION_PATH', id: null });
      }
      if (e.key === 'Enter') {
        if (drawNodes.length >= 2 && drawingMotionPathId) {
          dispatch({ type: 'UPDATE_MOTION_PATH_D', id: drawingMotionPathId, d: buildPathFromNodes(drawNodes) });
        }
        dispatch({ type: 'SET_DRAWING_MOTION_PATH', id: null });
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isDrawing, drawNodes, drawingMotionPathId, dispatch]);

  // ── Anchor drag (edit existing path) ─────────────────────────────────────

  function startAnchorDrag(e: React.MouseEvent, pathId: string, nodeIndex: number) {
    e.stopPropagation();
    e.preventDefault();
    const map = getMap();
    if (!map) return;
    const path = motionPaths.find(p => p.id === pathId);
    if (!path) return;
    const origNodes = parsePathNodes(path.d);
    const [startUx, startUy] = clientToUser(e.clientX, e.clientY, map);
    const orig = origNodes[nodeIndex];

    function onMove(mv: MouseEvent) {
      const m = getCoordMap(svgContainerRef, canvasWidth, canvasHeight);
      if (!m) return;
      const [ux, uy] = clientToUser(mv.clientX, mv.clientY, m);
      const dx = ux - startUx, dy = uy - startUy;
      const newNodes = origNodes.map((n, i) => i === nodeIndex
        ? { x: orig.x + dx, y: orig.y + dy,
            cpOutX: orig.cpOutX + dx, cpOutY: orig.cpOutY + dy,
            cpInX:  orig.cpInX  + dx, cpInY:  orig.cpInY  + dy }
        : n
      );
      dispatch({ type: 'UPDATE_MOTION_PATH_D', id: pathId, d: buildPathFromNodes(newNodes) });
    }
    function onUp() {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  // ── Control handle drag (edit bezier handles) ─────────────────────────────

  function startHandleDrag(
    e: React.MouseEvent,
    pathId: string,
    nodeIndex: number,
    handleType: 'cpOut' | 'cpIn'
  ) {
    e.stopPropagation();
    e.preventDefault();
    const map = getMap();
    if (!map) return;
    const path = motionPaths.find(p => p.id === pathId);
    if (!path) return;
    const origNodes = parsePathNodes(path.d);
    const orig = origNodes[nodeIndex];

    function onMove(mv: MouseEvent) {
      const m = getCoordMap(svgContainerRef, canvasWidth, canvasHeight);
      if (!m) return;
      const [ux, uy] = clientToUser(mv.clientX, mv.clientY, m);
      const newNodes = origNodes.map((n, i) => {
        if (i !== nodeIndex) return n;
        if (handleType === 'cpOut') {
          const dx = ux - orig.x, dy = uy - orig.y;
          return { ...n, cpOutX: orig.x + dx, cpOutY: orig.y + dy,
                        cpInX:  orig.x - dx, cpInY:  orig.y - dy };
        } else {
          const dx = ux - orig.x, dy = uy - orig.y;
          return { ...n, cpInX: orig.x + dx, cpInY: orig.y + dy,
                        cpOutX: orig.x - dx, cpOutY: orig.y - dy };
        }
      });
      dispatch({ type: 'UPDATE_MOTION_PATH_D', id: pathId, d: buildPathFromNodes(newNodes) });
    }
    function onUp() {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const map = getMap();

  // Preview nodes (drawing) — combines committed + current being dragged + mouse cursor
  const allPreviewNodes: PathNode[] = [
    ...drawNodes,
    ...(previewNode ? [previewNode] : []),
  ];
  // Add a transient "cursor" node for the hovering preview line
  const previewNodes: PathNode[] = mousePos && !previewNode
    ? [...allPreviewNodes, cornerNode(mousePos[0], mousePos[1])]
    : allPreviewNodes;

  const previewPathD = map && previewNodes.length >= 2
    ? buildCanvasPath(previewNodes, map)
    : null;

  return (
    <svg
      style={{
        position: 'absolute', top: 0, left: 0,
        width: canvasWidth, height: canvasHeight,
        overflow: 'visible',
        pointerEvents: isDrawing ? 'all' : 'none',
        cursor: isDrawing ? 'crosshair' : 'default',
        zIndex: 5,
      }}
      viewBox={`0 0 ${canvasWidth} ${canvasHeight}`}
      onMouseDown={handleOverlayMouseDown}
      onMouseMove={handleOverlayMouseMove}
      onMouseUp={handleOverlayMouseUp}
      onDoubleClick={handleOverlayDoubleClick}
    >
      {/* Existing motion paths */}
      {map && motionPaths.map(mp => {
        const isSelected = mp.id === selectedMotionPathId;
        const nodes = isSelected ? parsePathNodes(mp.d) : [];

        // Build canvas-space path for rendering
        const canvasD = mp.d ? buildCanvasPath(parsePathNodes(mp.d), map) : '';

        return (
          <g key={mp.id}>
            {canvasD && (
              <path
                d={canvasD}
                fill="none"
                stroke={isSelected ? '#7c6cf7' : '#7c6cf755'}
                strokeWidth={isSelected ? 1.5 : 1}
                strokeDasharray="5,3"
                style={{ pointerEvents: isDrawing ? 'none' : 'all', cursor: 'pointer' }}
                onClick={(e) => {
                  if (!isDrawing) {
                    e.stopPropagation();
                    dispatch({ type: 'SET_SELECTED_MOTION_PATH', id: mp.id });
                    dispatch({ type: 'SET_ACTIVE_LEFT_PANEL', panel: 'motionPaths' });
                  }
                }}
              />
            )}

            {/* Anchors + handles when selected */}
            {isSelected && nodes.map((n, i) => {
              const [ax, ay] = userToCanvas(n.x, n.y, map);
              const hasOut = n.cpOutX !== n.x || n.cpOutY !== n.y;
              const hasIn  = n.cpInX  !== n.x || n.cpInY  !== n.y;
              const [cox, coy] = userToCanvas(n.cpOutX, n.cpOutY, map);
              const [cix, ciy] = userToCanvas(n.cpInX,  n.cpInY,  map);
              return (
                <g key={i}>
                  {/* Out handle */}
                  {hasOut && (
                    <>
                      <line x1={ax} y1={ay} x2={cox} y2={coy} stroke="#7c6cf7" strokeWidth={1} opacity={0.6} style={{ pointerEvents: 'none' }} />
                      <circle cx={cox} cy={coy} r={4} fill="#fff" stroke="#7c6cf7" strokeWidth={1.5}
                        style={{ pointerEvents: 'all', cursor: 'grab' }}
                        onMouseDown={(e) => startHandleDrag(e, mp.id, i, 'cpOut')} />
                    </>
                  )}
                  {/* In handle */}
                  {hasIn && (
                    <>
                      <line x1={ax} y1={ay} x2={cix} y2={ciy} stroke="#7c6cf7" strokeWidth={1} opacity={0.6} style={{ pointerEvents: 'none' }} />
                      <circle cx={cix} cy={ciy} r={4} fill="#fff" stroke="#7c6cf7" strokeWidth={1.5}
                        style={{ pointerEvents: 'all', cursor: 'grab' }}
                        onMouseDown={(e) => startHandleDrag(e, mp.id, i, 'cpIn')} />
                    </>
                  )}
                  {/* Anchor */}
                  <rect
                    x={ax - 5} y={ay - 5} width={10} height={10}
                    fill={i === 0 ? '#7c6cf7' : '#1a1a2e'} stroke="#7c6cf7" strokeWidth={1.5} rx={1}
                    style={{ pointerEvents: 'all', cursor: 'grab' }}
                    onMouseDown={(e) => startAnchorDrag(e, mp.id, i)}
                  />
                </g>
              );
            })}
          </g>
        );
      })}

      {/* Drawing preview path */}
      {previewPathD && (
        <path
          d={previewPathD}
          fill="none"
          stroke="#7c6cf7"
          strokeWidth={1.5}
          strokeDasharray="5,3"
          style={{ pointerEvents: 'none' }}
        />
      )}

      {/* Drawing: committed anchor dots */}
      {map && isDrawing && drawNodes.map((n, i) => {
        const [ax, ay] = userToCanvas(n.x, n.y, map);
        return (
          <g key={i}>
            {(n.cpOutX !== n.x || n.cpOutY !== n.y) && (() => {
              const [cox, coy] = userToCanvas(n.cpOutX, n.cpOutY, map);
              const [cix, ciy] = userToCanvas(n.cpInX, n.cpInY, map);
              return (
                <>
                  <line x1={ax} y1={ay} x2={cox} y2={coy} stroke="#7c6cf7" strokeWidth={1} opacity={0.5} style={{ pointerEvents: 'none' }} />
                  <line x1={ax} y1={ay} x2={cix} y2={ciy} stroke="#7c6cf7" strokeWidth={1} opacity={0.5} style={{ pointerEvents: 'none' }} />
                  <circle cx={cox} cy={coy} r={3} fill="#7c6cf7" style={{ pointerEvents: 'none' }} />
                  <circle cx={cix} cy={ciy} r={3} fill="#7c6cf7" style={{ pointerEvents: 'none' }} />
                </>
              );
            })()}
            <circle cx={ax} cy={ay} r={i === 0 ? 5 : 4} fill="#7c6cf7" style={{ pointerEvents: 'none' }} />
          </g>
        );
      })}

      {/* Drawing: current dragging handle preview */}
      {map && isDrawing && previewNode && (() => {
        const [ax, ay] = userToCanvas(previewNode.x, previewNode.y, map);
        const [cox, coy] = userToCanvas(previewNode.cpOutX, previewNode.cpOutY, map);
        const [cix, ciy] = userToCanvas(previewNode.cpInX, previewNode.cpInY, map);
        return (
          <>
            <line x1={ax} y1={ay} x2={cox} y2={coy} stroke="#7c6cf7" strokeWidth={1} style={{ pointerEvents: 'none' }} />
            <line x1={ax} y1={ay} x2={cix} y2={ciy} stroke="#7c6cf7" strokeWidth={1} style={{ pointerEvents: 'none' }} />
            <circle cx={cox} cy={coy} r={3.5} fill="#fff" stroke="#7c6cf7" strokeWidth={1.5} style={{ pointerEvents: 'none' }} />
            <circle cx={cix} cy={ciy} r={3.5} fill="#fff" stroke="#7c6cf7" strokeWidth={1.5} style={{ pointerEvents: 'none' }} />
            <circle cx={ax}  cy={ay}  r={4}   fill="#7c6cf7" style={{ pointerEvents: 'none' }} />
          </>
        );
      })()}

      {/* Drawing: crosshair cursor */}
      {map && isDrawing && mousePos && !previewNode && (() => {
        const [cx, cy] = userToCanvas(mousePos[0], mousePos[1], map);
        return (
          <>
            <line x1={cx - 8} y1={cy} x2={cx + 8} y2={cy} stroke="#7c6cf7" strokeWidth={1} style={{ pointerEvents: 'none' }} />
            <line x1={cx} y1={cy - 8} x2={cx} y2={cy + 8} stroke="#7c6cf7" strokeWidth={1} style={{ pointerEvents: 'none' }} />
          </>
        );
      })()}
    </svg>
  );
}
