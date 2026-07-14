import React, { useState, useRef, useEffect } from 'react';
import {
  EasingConfig, EasingPreset,
  BezierEasingConfig, SpringEasingConfig,
} from '../types';
import {
  curvePoints, easingLabel,
  simulateSpring, springSettlingTime,
} from '../utils/easing';

// ─── Tiny curve SVG preview ───────────────────────────────────────────────────

function CurvePreview({
  config, width = 36, height = 22,
}: { config: EasingConfig; width?: number; height?: number }) {
  const pts = curvePoints(config, width, height, 50);
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: 'block', overflow: 'visible' }}>
      <polyline
        points={pts}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ─── Bezier Editor ────────────────────────────────────────────────────────────

const BW = 164, BH = 130, BP = 16;
const BDW = BW - BP * 2, BDH = BH - BP * 2;
// Bezier y range shown: [-0.25, 1.25] to accommodate overshoot
const BY_MIN = -0.25, BY_MAX = 1.25, BY_RANGE = BY_MAX - BY_MIN;

function toSvgCoord(bx: number, by: number): [number, number] {
  return [
    BP + bx * BDW,
    BP + BDH - ((by - BY_MIN) / BY_RANGE) * BDH,
  ];
}

function fromSvgCoord(sx: number, sy: number): [number, number] {
  return [
    (sx - BP) / BDW,
    BY_MIN + (1 - (sy - BP) / BDH) * BY_RANGE,
  ];
}

function BezierEditor({ config, onChange }: { config: BezierEasingConfig; onChange: (c: BezierEasingConfig) => void }) {
  const svgRef = useRef<SVGSVGElement>(null);

  const [a0x, a0y] = toSvgCoord(0, 0);
  const [a1x, a1y] = toSvgCoord(1, 1);
  const [p1x, p1y] = toSvgCoord(config.x1, config.y1);
  const [p2x, p2y] = toSvgCoord(config.x2, config.y2);

  // y=0 and y=1 guide lines
  const [, y0svg] = toSvgCoord(0, 0);
  const [, y1svg] = toSvgCoord(0, 1);

  // Bezier SVG path
  const pathD = `M ${a0x.toFixed(1)},${a0y.toFixed(1)} C ${p1x.toFixed(1)},${p1y.toFixed(1)} ${p2x.toFixed(1)},${p2y.toFixed(1)} ${a1x.toFixed(1)},${a1y.toFixed(1)}`;

  // Grid: quarter lines at x=0.25,0.5,0.75 and y=0.25,0.5,0.75
  const gridLines: React.ReactNode[] = [0.25, 0.5, 0.75].flatMap((t, i) => {
    const [gx] = toSvgCoord(t, 0);
    const [, gy] = toSvgCoord(0, t);
    return [
      <line key={`vg${i}`} x1={gx} y1={BP} x2={gx} y2={BP + BDH} stroke="#2a2a34" strokeWidth="0.5" />,
      <line key={`hg${i}`} x1={BP} y1={gy} x2={BP + BDW} y2={gy} stroke="#2a2a34" strokeWidth="0.5" />,
    ];
  });

  function startDrag(which: 'p1' | 'p2', e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const svgEl = svgRef.current;
    if (!svgEl) return;

    function onMove(mv: MouseEvent) {
      const rect = svgEl!.getBoundingClientRect();
      const sx = (mv.clientX - rect.left) * (BW / rect.width);
      const sy = (mv.clientY - rect.top) * (BH / rect.height);
      const [bx, by] = fromSvgCoord(sx, sy);
      const cx = Math.max(0, Math.min(1, bx));
      const cy = Math.max(-0.5, Math.min(1.5, by));
      if (which === 'p1') onChange({ ...config, x1: cx, y1: cy });
      else onChange({ ...config, x2: cx, y2: cy });
    }
    function onUp() {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  function numInput(label: string, val: number, onCh: (v: number) => void, clamp?: [number, number]) {
    return (
      <div className="bezier-num-row" key={label}>
        <span className="bezier-num-label">{label}</span>
        <input
          className="prop-input bezier-num-input"
          type="number"
          step="0.01"
          value={val.toFixed(2)}
          onChange={(e) => {
            const n = parseFloat(e.target.value);
            if (!isNaN(n)) {
              const v = clamp ? Math.max(clamp[0], Math.min(clamp[1], n)) : n;
              onCh(v);
            }
          }}
        />
      </div>
    );
  }

  return (
    <div className="bezier-editor">
      <svg ref={svgRef} width={BW} height={BH} viewBox={`0 0 ${BW} ${BH}`} className="bezier-svg">
        {/* Background */}
        <rect x={BP} y={BP} width={BDW} height={BDH} fill="#15151c" />
        {/* Grid */}
        {gridLines}
        {/* y=0 and y=1 boundary lines */}
        <line x1={BP} y1={y0svg} x2={BP + BDW} y2={y0svg} stroke="#383848" strokeWidth="0.8" />
        <line x1={BP} y1={y1svg} x2={BP + BDW} y2={y1svg} stroke="#383848" strokeWidth="0.8" />
        {/* Border */}
        <rect x={BP} y={BP} width={BDW} height={BDH} fill="none" stroke="#2e2e3e" strokeWidth="1" />
        {/* Handle dashed lines */}
        <line x1={a0x} y1={a0y} x2={p1x} y2={p1y} stroke="#4a4a60" strokeWidth="1" strokeDasharray="2,2" />
        <line x1={a1x} y1={a1y} x2={p2x} y2={p2y} stroke="#4a4a60" strokeWidth="1" strokeDasharray="2,2" />
        {/* Curve */}
        <path d={pathD} fill="none" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" />
        {/* Anchors */}
        <circle cx={a0x} cy={a0y} r="3.5" fill="#3a3a50" stroke="#666" strokeWidth="1" />
        <circle cx={a1x} cy={a1y} r="3.5" fill="#3a3a50" stroke="#666" strokeWidth="1" />
        {/* P1 handle */}
        <circle cx={p1x} cy={p1y} r="5" fill="#f5c542" stroke="#fff" strokeWidth="1" style={{ cursor: 'grab' }}
          onMouseDown={(e) => startDrag('p1', e)} />
        {/* P2 handle */}
        <circle cx={p2x} cy={p2y} r="5" fill="#ff8c42" stroke="#fff" strokeWidth="1" style={{ cursor: 'grab' }}
          onMouseDown={(e) => startDrag('p2', e)} />
      </svg>

      <div className="bezier-nums">
        <div className="bezier-num-group">
          <span className="bezier-group-label">P1</span>
          {numInput('x₁', config.x1, (v) => onChange({ ...config, x1: v }), [0, 1])}
          {numInput('y₁', config.y1, (v) => onChange({ ...config, y1: v }))}
        </div>
        <div className="bezier-num-group">
          <span className="bezier-group-label">P2</span>
          {numInput('x₂', config.x2, (v) => onChange({ ...config, x2: v }), [0, 1])}
          {numInput('y₂', config.y2, (v) => onChange({ ...config, y2: v }))}
        </div>
      </div>
    </div>
  );
}

// ─── Spring Editor ────────────────────────────────────────────────────────────

function SpringPreview({ config }: { config: SpringEasingConfig }) {
  const W = 164, H = 60, P = 6;
  const { stiffness, damping, mass } = config;
  const dur = springSettlingTime(stiffness, damping, mass);

  const N = 100;
  const samples = Array.from({ length: N + 1 }, (_, i) => {
    const t = i / N;
    return simulateSpring(stiffness, damping, mass, t * dur);
  });

  const maxV = Math.max(1.05, ...samples);
  const minV = Math.min(0, ...samples);
  const rangeV = maxV - minV || 1;

  const pts = samples
    .map((v, i) => {
      const x = P + (i / N) * (W - P * 2);
      const y = P + (1 - (v - minV) / rangeV) * (H - P * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  // y=1 line position
  const y1 = P + (1 - (1 - minV) / rangeV) * (H - P * 2);

  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="spring-preview-svg">
      <rect x={P} y={P} width={W - P * 2} height={H - P * 2} fill="#15151c" />
      <line x1={P} y1={y1} x2={W - P} y2={y1} stroke="#2e2e3e" strokeWidth="0.8" strokeDasharray="3,2" />
      <polyline points={pts} fill="none" stroke="#ffffff" strokeWidth="1.5"
        strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SpringSlider({
  label, value, min, max, step, onChange,
}: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void }) {
  return (
    <div className="spring-param">
      <span className="spring-param-label">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))} className="spring-slider" />
      <input
        className="prop-input spring-num"
        type="number"
        min={min} max={max} step={step}
        value={value}
        onChange={(e) => {
          const n = parseFloat(e.target.value);
          if (!isNaN(n)) onChange(Math.max(min, Math.min(max, n)));
        }}
      />
    </div>
  );
}

function SpringEditor({ config, onChange }: { config: SpringEasingConfig; onChange: (c: SpringEasingConfig) => void }) {
  return (
    <div className="spring-editor">
      <SpringPreview config={config} />
      <SpringSlider label="Stiffness" value={config.stiffness} min={1} max={1000} step={1}
        onChange={(v) => onChange({ ...config, stiffness: v })} />
      <SpringSlider label="Damping" value={config.damping} min={0.1} max={100} step={0.1}
        onChange={(v) => onChange({ ...config, damping: v })} />
      <SpringSlider label="Mass" value={config.mass} min={0.1} max={10} step={0.1}
        onChange={(v) => onChange({ ...config, mass: v })} />
    </div>
  );
}

// ─── Dropdown ─────────────────────────────────────────────────────────────────

const PRESETS: Array<{ name: EasingPreset; label: string }> = [
  { name: 'linear',       label: 'Linear'     },
  { name: 'ease',         label: 'Ease'        },
  { name: 'ease-in',      label: 'Ease In'     },
  { name: 'ease-out',     label: 'Ease Out'    },
  { name: 'ease-in-out',  label: 'Ease In-Out' },
];

const DEFAULT_BEZIER: BezierEasingConfig = { type: 'bezier', x1: 0.25, y1: 0.1, x2: 0.25, y2: 1.0 };
const DEFAULT_SPRING: SpringEasingConfig = { type: 'spring', stiffness: 120, damping: 14, mass: 1 };

const SPRING_PRESETS: Array<{ label: string; config: SpringEasingConfig }> = [
  { label: 'Spring',       config: { type: 'spring', stiffness: 120, damping: 14, mass: 1 } },
  { label: 'Bouncy',       config: { type: 'spring', stiffness: 300, damping: 10, mass: 1 } },
  { label: 'Extra Bouncy', config: { type: 'spring', stiffness: 500, damping:  6, mass: 1 } },
];

// ─── Main EasingPicker ────────────────────────────────────────────────────────

export function EasingPicker({
  easing, onChange, alwaysOpen = false,
}: { easing: EasingConfig; onChange: (c: EasingConfig) => void; alwaysOpen?: boolean }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, [open]);

  function select(config: EasingConfig) {
    onChange(config);
    if (!alwaysOpen) setOpen(false);
  }

  function isActive(cfg: EasingConfig): boolean {
    if (cfg.type !== easing.type) return false;
    if (cfg.type === 'preset' && easing.type === 'preset') return cfg.name === easing.name;
    if (cfg.type === 'spring' && easing.type === 'spring') {
      return cfg.stiffness === easing.stiffness && cfg.damping === easing.damping && cfg.mass === easing.mass;
    }
    return true;
  }

  const showDropdown = open || alwaysOpen;

  return (
    <div className="easing-picker" ref={rootRef}>
      {/* Trigger — hidden when alwaysOpen */}
      {!alwaysOpen && (
        <button className="easing-trigger" onClick={() => setOpen((o) => !o)}>
          <span className="easing-trigger-curve">
            <CurvePreview config={easing} width={32} height={18} />
          </span>
          <span className="easing-trigger-label">{easingLabel(easing)}</span>
          <span className="easing-trigger-arrow">{open ? '▴' : '▾'}</span>
        </button>
      )}

      {/* Inline dropdown */}
      {showDropdown && (
        <div className={`easing-dropdown${alwaysOpen ? ' easing-dropdown--inline' : ''}`}>
          <div className="easing-group-label">Presets</div>
          {PRESETS.map((p) => {
            const cfg: EasingConfig = { type: 'preset', name: p.name };
            return (
              <button
                key={p.name}
                className={`easing-option ${isActive(cfg) ? 'easing-option--active' : ''}`}
                onClick={() => select(cfg)}
              >
                <span className="easing-option-curve"><CurvePreview config={cfg} width={30} height={18} /></span>
                <span>{p.label}</span>
              </button>
            );
          })}

          <div className="easing-group-label" style={{ marginTop: 4 }}>Custom</div>
          <button
            className={`easing-option ${easing.type === 'bezier' ? 'easing-option--active' : ''}`}
            onClick={() => select(easing.type === 'bezier' ? easing : DEFAULT_BEZIER)}
          >
            <span className="easing-option-curve">
              <CurvePreview config={easing.type === 'bezier' ? easing : DEFAULT_BEZIER} width={30} height={18} />
            </span>
            <span>Custom Bezier</span>
          </button>
          {SPRING_PRESETS.map((sp) => (
            <button
              key={sp.label}
              className={`easing-option ${isActive(sp.config) ? 'easing-option--active' : ''}`}
              onClick={() => select(sp.config)}
            >
              <span className="easing-option-curve">
                <CurvePreview config={sp.config} width={30} height={18} />
              </span>
              <span>{sp.label}</span>
            </button>
          ))}
        </div>
      )}

      {/* Inline editors (below dropdown/trigger) */}
      {easing.type === 'bezier' && (
        <BezierEditor config={easing} onChange={onChange} />
      )}
      {easing.type === 'spring' && (
        <SpringEditor config={easing} onChange={onChange} />
      )}
    </div>
  );
}
