import React, { useEffect, useState } from 'react';
import { useApp } from '../context/AppContext';

interface Props {
  svgContainerRef: React.RefObject<HTMLDivElement>;
  canvasWidth: number;
  canvasHeight: number;
}

interface BoxInfo {
  x: number;
  y: number;
  w: number;
  h: number;
}

export default function CmdHoverOverlay({ svgContainerRef, canvasWidth, canvasHeight }: Props) {
  const { state } = useApp();
  const [box, setBox] = useState<BoxInfo | null>(null);

  useEffect(() => {
    const layerId = state.cmdHoverLayerId;
    if (!layerId) { setBox(null); return; }

    const layer = state.layers.find(l => l.id === layerId);
    if (!layer) { setBox(null); return; }

    const container = svgContainerRef.current;
    if (!container) { setBox(null); return; }
    const svgEl = container.querySelector('svg') as SVGSVGElement | null;
    if (!svgEl) { setBox(null); return; }
    const el = svgEl.getElementById(layer.elementId) as SVGGraphicsElement | null;
    if (!el) { setBox(null); return; }

    try {
      const b = el.getBBox();
      const containerRect = container.getBoundingClientRect();
      const svgCTM = svgEl.getScreenCTM();
      if (!svgCTM || containerRect.width === 0) { setBox(null); return; }

      const screenToCanvas = canvasWidth / containerRect.width;
      const scaleX = svgCTM.a * screenToCanvas;
      const scaleY = svgCTM.d * screenToCanvas;
      const offX = (svgCTM.e - containerRect.left) * screenToCanvas;
      const offY = (svgCTM.f - containerRect.top) * (canvasHeight / containerRect.height);

      setBox({
        x: b.x * scaleX + offX,
        y: b.y * scaleY + offY,
        w: b.width * scaleX,
        h: b.height * scaleY,
      });
    } catch {
      setBox(null);
    }
  }, [state.cmdHoverLayerId, state.layers, state.svgSource, state.currentTime, svgContainerRef, canvasWidth, canvasHeight]);

  if (!box) return null;

  return (
    <svg
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'visible' }}
      width={canvasWidth}
      height={canvasHeight}
      viewBox={`0 0 ${canvasWidth} ${canvasHeight}`}
    >
      <rect
        x={box.x}
        y={box.y}
        width={box.w}
        height={box.h}
        fill="none"
        stroke="#0092FF"
        strokeWidth={1.5}
        strokeDasharray="5,3"
        opacity={0.85}
      />
    </svg>
  );
}
