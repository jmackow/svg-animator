import React from 'react';
import { useSnapGuides } from '../context/SnapContext';

export default function SnapGuideOverlay({ canvasWidth, canvasHeight }: { canvasWidth: number; canvasHeight: number }) {
  const { guides } = useSnapGuides();
  if (!guides.length) return null;
  return (
    <svg
      style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }}
      width={canvasWidth}
      height={canvasHeight}
      viewBox={`0 0 ${canvasWidth} ${canvasHeight}`}
    >
      {guides.map((g, i) => g.axis === 'x'
        ? <line key={i} x1={g.position} y1={0} x2={g.position} y2={canvasHeight} stroke="#FF3B30" strokeWidth={1} opacity={0.85} />
        : <line key={i} x1={0} y1={g.position} x2={canvasWidth} y2={g.position} stroke="#FF3B30" strokeWidth={1} opacity={0.85} />
      )}
    </svg>
  );
}
