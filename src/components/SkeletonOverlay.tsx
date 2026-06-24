import React from 'react';
import { useApp } from '../context/AppContext';
import { PathPoint } from '../types';
import { parsePath, interpolatePathPoints } from '../utils/pathPoints';

interface Props {
  svgContainerRef: React.RefObject<HTMLDivElement>;
  canvasFrameRef: React.RefObject<HTMLDivElement>;
  canvasZoom: number;
}

function getMapping(
  svgContainerRef: React.RefObject<HTMLDivElement>,
  canvasFrameRef: React.RefObject<HTMLDivElement>,
  canvasZoom: number,
  elementId: string,
): { scaleX: number; scaleY: number; offX: number; offY: number } | null {
  const svgEl = svgContainerRef.current?.querySelector('svg') as SVGSVGElement | null;
  if (!svgEl) return null;
  const el = svgEl.getElementById(elementId) as SVGGraphicsElement | null;
  const ctm = el?.getScreenCTM() ?? svgEl.getScreenCTM();
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

function toFrame(
  x: number,
  y: number,
  m: { scaleX: number; scaleY: number; offX: number; offY: number },
) {
  return { x: x * m.scaleX + m.offX, y: y * m.scaleY + m.offY };
}

const ANCHOR_COLOR = '#ff9d3a';

export default function SkeletonOverlay({ svgContainerRef, canvasFrameRef, canvasZoom }: Props) {
  const { state } = useApp();

  const skeletonLayers = state.layers.filter(l => l.skeletonMode && l.visible);
  if (skeletonLayers.length === 0) return null;

  const svgEl = svgContainerRef.current?.querySelector('svg') as SVGSVGElement | null;
  if (!svgEl) return null;

  const nodes: React.ReactNode[] = [];

  for (const layer of skeletonLayers) {
    if (!['path', 'polyline', 'polygon'].includes(layer.tagName.toLowerCase())) continue;

    const anchorColor  = layer.skeletonColors?.anchor      ?? ANCHOR_COLOR;
    const handleScale  = layer.skeletonColors?.handleScale ?? 1;

    // Prefer interpolated path keyframes; fall back to element's d attribute
    const livePoints = interpolatePathPoints(layer.pathKeyframes ?? [], state.currentTime);
    let points: PathPoint[];
    if (livePoints && livePoints.length > 0) {
      points = livePoints;
    } else {
      const el = svgEl.getElementById(layer.elementId);
      const d = el?.getAttribute('d');
      if (!d) continue;
      try {
        points = parsePath(d).points;
      } catch {
        continue;
      }
    }

    if (points.length === 0) continue;

    const mapping = getMapping(svgContainerRef, canvasFrameRef, canvasZoom, layer.elementId);
    if (!mapping) continue;

    for (const pt of points) {
      const a  = toFrame(pt.x, pt.y, mapping);
      // Scale handle arms visually from the anchor, without touching actual control point data
      const ci = toFrame(
        pt.x + (pt.cpInX  - pt.x) * handleScale,
        pt.y + (pt.cpInY  - pt.y) * handleScale,
        mapping,
      );
      const co = toFrame(
        pt.x + (pt.cpOutX - pt.x) * handleScale,
        pt.y + (pt.cpOutY - pt.y) * handleScale,
        mapping,
      );

      const hasIn  = Math.abs(pt.cpInX  - pt.x) > 0.5 || Math.abs(pt.cpInY  - pt.y) > 0.5;
      const hasOut = Math.abs(pt.cpOutX - pt.x) > 0.5 || Math.abs(pt.cpOutY - pt.y) > 0.5;

      nodes.push(
        <g key={`${layer.id}-${pt.id}`}>
          {hasIn && (
            <line x1={a.x} y1={a.y} x2={ci.x} y2={ci.y}
              stroke={anchorColor} strokeOpacity={0.5} strokeWidth={1} strokeDasharray="3 2" />
          )}
          {hasOut && (
            <line x1={a.x} y1={a.y} x2={co.x} y2={co.y}
              stroke={anchorColor} strokeOpacity={0.5} strokeWidth={1} strokeDasharray="3 2" />
          )}
          {hasIn && (
            <circle cx={ci.x} cy={ci.y} r={3}
              fill={anchorColor} fillOpacity={0.7} stroke="rgba(0,0,0,0.4)" strokeWidth={0.75} />
          )}
          {hasOut && (
            <circle cx={co.x} cy={co.y} r={3}
              fill={anchorColor} fillOpacity={0.7} stroke="rgba(0,0,0,0.4)" strokeWidth={0.75} />
          )}
          <circle cx={a.x} cy={a.y} r={4.5}
            fill={anchorColor} stroke="rgba(0,0,0,0.5)" strokeWidth={1} />
        </g>,
      );
    }
  }

  if (nodes.length === 0) return null;

  return (
    <svg
      style={{
        position: 'absolute', top: 0, left: 0,
        width: '100%', height: '100%',
        overflow: 'visible', pointerEvents: 'none',
      }}
    >
      {nodes}
    </svg>
  );
}
