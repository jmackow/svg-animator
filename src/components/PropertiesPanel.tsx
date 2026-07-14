import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useApp } from '../context/AppContext';
import { interpolateProperty, interpolateTracks, packColor, unpackColor } from '../utils/interpolate';
import {
  AnimatableProperty, EasingConfig, GradientDef, GradientStop,
  PROPERTY_LABELS, PROPERTY_DEFAULTS, ALL_PROPERTIES, DEFAULT_EASING,
  PathPoint, PointType, PathKeyframe,
} from '../types';
import { EasingPicker } from './EasingPicker';
import { interpolatePathPoints, parsePath, alignPointIds, buildPath } from '../utils/pathPoints';

function makeStopId() { return `stop-${Date.now()}-${Math.random().toString(36).slice(2)}`; }

function defaultGradient(): GradientDef {
  return {
    type: 'linear',
    angle: 90,
    stops: [
      { id: makeStopId(), offset: 0, color: '#000000', opacity: 1 },
      { id: makeStopId(), offset: 1, color: '#ffffff', opacity: 1 },
    ],
  };
}

const PATH_LIKE_TAGS = new Set(['path', 'polyline', 'polygon', 'line', 'circle', 'ellipse', 'rect']);

// ─── Color utilities ──────────────────────────────────────────────────────────

function hexToHsv(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d + 6) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
  }
  return [h * 60, max === 0 ? 0 : d / max, max];
}

function hsvToHex(h: number, s: number, v: number): string {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return Math.round((v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255).toString(16).padStart(2, '0');
  };
  return `#${f(5)}${f(3)}${f(1)}`;
}

function gradientCss(gradient: GradientDef): string {
  const sorted = [...gradient.stops].sort((a, b) => a.offset - b.offset);
  const stops = sorted.map(s => {
    const r = parseInt(s.color.slice(1, 3), 16);
    const g = parseInt(s.color.slice(3, 5), 16);
    const b = parseInt(s.color.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${s.opacity}) ${(s.offset * 100).toFixed(1)}%`;
  }).join(', ');
  return `linear-gradient(${gradient.angle}deg, ${stops})`;
}

// ─── PropRow (used by PathPointSection + motionOffset) ───────────────────────

interface PropRowProps {
  layerId: string;
  property: AnimatableProperty;
  step: number;
  min?: number;
  max?: number;
  suffix?: string;
}

function PropRow({ layerId, property, step, min, max, suffix }: PropRowProps) {
  const { state, dispatch, togglePropertyKeyframe } = useApp();
  const layer = state.layers.find((l) => l.id === layerId)!;

  const kfAtPlayhead = layer.tracks[property].find(
    (kf) => Math.abs(kf.time - state.currentTime) < 0.001
  );
  const selectedKf = state.selectedKeyframes
    .filter((s) => s.layerId === layerId && s.property === property)
    .map((s) => layer.tracks[property].find((kf) => kf.id === s.keyframeId))
    .find((kf) => kf !== undefined);
  const editableKf = selectedKf ?? kfAtPlayhead;
  const isBaseMode = layer.tracks[property].length === 0;
  const interpolated = interpolateProperty(layer.tracks[property], state.currentTime, PROPERTY_DEFAULTS[property]);
  const baseVal = isBaseMode ? (layer.baseValues?.[property] ?? PROPERTY_DEFAULTS[property]) : PROPERTY_DEFAULTS[property];
  const displayValue = editableKf ? editableKf.value : (isBaseMode ? baseVal : interpolated);

  const [raw, setRaw] = useState(displayValue.toFixed(step < 1 ? 3 : 0));
  useEffect(() => { setRaw(displayValue.toFixed(step < 1 ? 3 : 0)); }, [displayValue, step]);

  function clamp(n: number) {
    let v = n;
    if (min !== undefined) v = Math.max(min, v);
    if (max !== undefined) v = Math.min(max, v);
    return v;
  }

  function commitValue(numStr: string) {
    const n = parseFloat(numStr);
    if (isNaN(n)) return;
    if (editableKf) {
      dispatch({ type: 'UPDATE_PROPERTY_KEYFRAME', layerId, property, keyframeId: editableKf.id, value: clamp(n) });
    } else if (isBaseMode) {
      dispatch({ type: 'SET_LAYER_BASE_VALUE', layerId, property, value: clamp(n) });
    }
  }

  function handleDelete() {
    if (!editableKf) return;
    dispatch({ type: 'DELETE_PROPERTY_KEYFRAME', layerId, property, keyframeId: editableKf.id });
  }

  const hasKfAtPlayhead = !!kfAtPlayhead;
  const isEditable = !!editableKf || isBaseMode;
  const shortLabel = PROPERTY_LABELS[property].split(' ')[1] || PROPERTY_LABELS[property];

  return (
    <div className="prop-property-block">
      <div className="prop-row">
        <label className="prop-label">{shortLabel}</label>
        <input
          className={`prop-input ${hasKfAtPlayhead ? 'prop-input--keyed' : editableKf ? 'prop-input--selected-kf' : ''}`}
          type="number"
          step={step} min={min} max={max}
          value={raw}
          disabled={!isEditable}
          onChange={(e) => setRaw(e.target.value)}
          onBlur={(e) => commitValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && commitValue(raw)}
        />
        {suffix && <span className="prop-suffix">{suffix}</span>}
        <button
          className={`kf-toggle-btn ${hasKfAtPlayhead ? 'kf-toggle-btn--active' : ''}`}
          title={hasKfAtPlayhead ? 'Remove keyframe at playhead' : 'Add keyframe at playhead'}
          onClick={() => togglePropertyKeyframe(layerId, property)}
        >◆</button>
        {editableKf && (
          <button className="kf-delete-btn" title="Delete keyframe (Backspace)" onClick={handleDelete}>✕</button>
        )}
      </div>
    </div>
  );
}

// ─── CompactPropInput (2-col grid variant) ────────────────────────────────────

function CompactPropInput({ layerId, property, label, step, min, max, suffix }: {
  layerId: string; property: AnimatableProperty; label: string;
  step: number; min?: number; max?: number; suffix?: string;
}) {
  const { state, dispatch, togglePropertyKeyframe } = useApp();
  const layer = state.layers.find(l => l.id === layerId)!;

  const kfAtPlayhead = layer.tracks[property].find(kf => Math.abs(kf.time - state.currentTime) < 0.001);
  const selectedKf = state.selectedKeyframes
    .filter(s => s.layerId === layerId && s.property === property)
    .map(s => layer.tracks[property].find(kf => kf.id === s.keyframeId))
    .find(kf => kf !== undefined);
  const editableKf = selectedKf ?? kfAtPlayhead;
  const isBaseMode = layer.tracks[property].length === 0;
  const interpolated = interpolateProperty(layer.tracks[property], state.currentTime, PROPERTY_DEFAULTS[property]);
  const baseVal = isBaseMode ? (layer.baseValues?.[property] ?? PROPERTY_DEFAULTS[property]) : PROPERTY_DEFAULTS[property];
  const displayValue = editableKf ? editableKf.value : (isBaseMode ? baseVal : interpolated);

  const decimals = step < 1 ? 2 : 0;
  const [raw, setRaw] = useState(displayValue.toFixed(decimals));
  useEffect(() => { setRaw(displayValue.toFixed(decimals)); }, [displayValue, decimals]);

  function clamp(n: number) {
    let v = n;
    if (min !== undefined) v = Math.max(min, v);
    if (max !== undefined) v = Math.min(max, v);
    return v;
  }

  function commitValue(numStr: string) {
    const n = parseFloat(numStr);
    if (isNaN(n)) return;
    if (editableKf) {
      dispatch({ type: 'UPDATE_PROPERTY_KEYFRAME', layerId, property, keyframeId: editableKf.id, value: clamp(n) });
    } else if (isBaseMode) {
      dispatch({ type: 'SET_LAYER_BASE_VALUE', layerId, property, value: clamp(n) });
    }
  }

  const isEditable = !!editableKf || isBaseMode;
  const cls = `compact-prop${kfAtPlayhead ? ' compact-prop--keyed' : editableKf ? ' compact-prop--selected-kf' : ''}`;

  return (
    <div className={cls}>
      <span className="compact-prop-label">{label}</span>
      <input
        className="compact-prop-input"
        type="number"
        step={step} min={min} max={max}
        value={raw}
        disabled={!isEditable}
        onChange={e => setRaw(e.target.value)}
        onBlur={e => commitValue(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && commitValue(raw)}
      />
      {suffix && <span className="compact-prop-suffix">{suffix}</span>}
      <button
        className={`compact-kf-dot${kfAtPlayhead ? ' compact-kf-dot--active' : ''}`}
        onClick={() => togglePropertyKeyframe(layerId, property)}
        title={kfAtPlayhead ? 'Remove keyframe' : 'Add keyframe at playhead'}
      >◆</button>
    </div>
  );
}

// ─── Stop Color Picker (HSV, no alpha, renders as fixed child) ────────────────

const STOP_PICK_W = 196;

function StopColorPicker({ hex, anchor, onHexChange, onClose }: {
  hex: string; anchor: { x: number; y: number };
  onHexChange: (h: string) => void; onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const svRef = useRef<HTMLDivElement>(null);
  const hueRef = useRef<HTMLDivElement>(null);
  const [hsv, setHsv] = useState<[number, number, number]>(() => hexToHsv(hex));
  const [hexInput, setHexInput] = useState(hex.slice(1).toUpperCase());

  useEffect(() => { setHsv(hexToHsv(hex)); setHexInput(hex.slice(1).toUpperCase()); }, [hex]);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener('mousedown', onDown, true);
    return () => document.removeEventListener('mousedown', onDown, true);
  }, [onClose]);

  const [h, s, v] = hsv;
  const pureHue = hsvToHex(h, 1, 1);

  function startSvDrag(e: React.MouseEvent) {
    e.preventDefault();
    const el = svRef.current; if (!el) return;
    function update(ev: MouseEvent) {
      const r = el!.getBoundingClientRect();
      const ns = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width));
      const nv = Math.max(0, Math.min(1, 1 - (ev.clientY - r.top) / r.height));
      const nh = hsvToHex(h, ns, nv);
      setHsv([h, ns, nv]); setHexInput(nh.slice(1).toUpperCase()); onHexChange(nh);
    }
    function onUp() { window.removeEventListener('mousemove', update); window.removeEventListener('mouseup', onUp); }
    window.addEventListener('mousemove', update); window.addEventListener('mouseup', onUp); update(e.nativeEvent);
  }

  function startHueDrag(e: React.MouseEvent) {
    e.preventDefault();
    const el = hueRef.current; if (!el) return;
    function update(ev: MouseEvent) {
      const r = el!.getBoundingClientRect();
      const nh2 = Math.max(0, Math.min(360, (ev.clientX - r.left) / r.width * 360));
      const nh = hsvToHex(nh2, s, v);
      setHsv([nh2, s, v]); setHexInput(nh.slice(1).toUpperCase()); onHexChange(nh);
    }
    function onUp() { window.removeEventListener('mousemove', update); window.removeEventListener('mouseup', onUp); }
    window.addEventListener('mousemove', update); window.addEventListener('mouseup', onUp); update(e.nativeEvent);
  }

  const left = anchor.x - STOP_PICK_W - 8 >= 4
    ? anchor.x - STOP_PICK_W - 8
    : anchor.x + 28;
  const top = Math.max(4, Math.min(anchor.y, window.innerHeight - 220));

  return (
    <div ref={ref} className="color-popup"
      style={{ position: 'fixed', left, top, zIndex: 21000, width: STOP_PICK_W }}>
      <div ref={svRef} className="color-sv-square" onMouseDown={startSvDrag}
        style={{ background: pureHue, height: 120 }}>
        <div className="color-sv-white" />
        <div className="color-sv-black" />
        <div className="color-sv-cursor" style={{ left: `${s * 100}%`, top: `${(1 - v) * 100}%` }} />
      </div>
      <div ref={hueRef} className="color-hue-bar" onMouseDown={startHueDrag}>
        <div className="color-slider-thumb" style={{ left: `${h / 360 * 100}%`, background: pureHue }} />
      </div>
      <div className="color-popup-inputs">
        <div className="color-popup-input-group">
          <span className="color-popup-input-label">Hex</span>
          <input className="color-popup-text-input" value={hexInput} maxLength={6} spellCheck={false}
            onChange={e => {
              const val = e.target.value.replace(/[^0-9a-fA-F]/g, '').toUpperCase();
              setHexInput(val);
              if (val.length === 6) { const nh = `#${val}`; setHsv(hexToHsv(nh)); onHexChange(nh); }
            }} />
        </div>
      </div>
    </div>
  );
}

// ─── Gradient Editor ──────────────────────────────────────────────────────────

function GradientEditor({ gradient, onChange }: { gradient: GradientDef; onChange: (g: GradientDef) => void }) {
  const [selectedStopId, setSelectedStopId] = useState(gradient.stops[0]?.id ?? null);
  const [stopPicker, setStopPicker] = useState<{ stopId: string; anchor: { x: number; y: number } } | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  function updateStop(id: string, patch: Partial<GradientStop>) {
    onChange({ ...gradient, stops: gradient.stops.map(s => s.id === id ? { ...s, ...patch } : s) });
  }

  function addStop() {
    const sorted = [...gradient.stops].sort((a, b) => a.offset - b.offset);
    let best = 0.5;
    if (sorted.length >= 2) {
      let maxGap = 0;
      for (let i = 0; i < sorted.length - 1; i++) {
        const gap = sorted[i + 1].offset - sorted[i].offset;
        if (gap > maxGap) { maxGap = gap; best = sorted[i].offset + gap / 2; }
      }
    }
    const newStop: GradientStop = { id: makeStopId(), offset: best, color: '#888888', opacity: 1 };
    onChange({ ...gradient, stops: [...gradient.stops, newStop].sort((a, b) => a.offset - b.offset) });
    setSelectedStopId(newStop.id);
  }

  function removeStop(id: string) {
    if (gradient.stops.length <= 2) return;
    const newStops = gradient.stops.filter(s => s.id !== id);
    onChange({ ...gradient, stops: newStops });
    if (selectedStopId === id) setSelectedStopId(newStops[0].id);
  }

  function reverseGradient() {
    onChange({ ...gradient, stops: gradient.stops.map(s => ({ ...s, offset: 1 - s.offset })).reverse() });
  }

  function startHandleDrag(e: React.MouseEvent, stopId: string) {
    e.preventDefault();
    e.stopPropagation();
    setSelectedStopId(stopId);
    const el = barRef.current;
    if (!el) return;
    function onMove(mv: MouseEvent) {
      const rect = el!.getBoundingClientRect();
      updateStop(stopId, { offset: Math.max(0, Math.min(1, (mv.clientX - rect.left) / rect.width)) });
    }
    function onUp() { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  const sorted = [...gradient.stops].sort((a, b) => a.offset - b.offset);

  return (
    <div className="gradient-editor-figma">
      {/* Type + angle + reverse */}
      <div className="gradient-type-row">
        <span className="gradient-type-label">Linear</span>
        <input
          className="gradient-angle-input"
          type="number" min={0} max={360} step={1}
          value={gradient.angle}
          onChange={e => onChange({ ...gradient, angle: parseInt(e.target.value) || 0 })}
        />
        <span className="gradient-angle-deg">°</span>
        <button className="gradient-action-btn" title="Reverse gradient" onClick={reverseGradient}>⇄</button>
      </div>

      {/* Gradient bar with draggable handles above it */}
      <div className="gradient-track-area">
        <div className="gradient-handles-area">
          {gradient.stops.map(stop => (
            <div
              key={stop.id}
              className={`gradient-handle ${stop.id === selectedStopId ? 'gradient-handle--selected' : ''}`}
              style={{ left: `${stop.offset * 100}%`, background: stop.color }}
              onMouseDown={e => startHandleDrag(e, stop.id)}
              onClick={() => setSelectedStopId(stop.id)}
            />
          ))}
        </div>
        <div ref={barRef} className="gradient-bar" style={{ background: gradientCss(gradient) }} />
      </div>

      {/* Stops list */}
      <div className="gradient-stops-header">
        <span>Stops</span>
        <button className="gradient-add-btn" title="Add stop" onClick={addStop}>+</button>
      </div>
      <div className="gradient-stops-list">
        {sorted.map(stop => (
          <div
            key={stop.id}
            className={`gradient-stop-row ${stop.id === selectedStopId ? 'gradient-stop-row--selected' : ''}`}
            onClick={() => setSelectedStopId(stop.id)}
          >
            <input
              className="gradient-stop-pos-input"
              type="number" min={0} max={100} step={1}
              value={Math.round(stop.offset * 100)}
              onClick={e => e.stopPropagation()}
              onChange={e => { const n = parseInt(e.target.value); if (!isNaN(n)) updateStop(stop.id, { offset: Math.max(0, Math.min(1, n / 100)) }); }}
            />
            <span className="gradient-stop-pct">%</span>
            <div
              className="gradient-stop-swatch-sm"
              style={{ background: stop.color, cursor: 'pointer' }}
              onClick={e => {
                e.stopPropagation();
                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                setStopPicker(p => p?.stopId === stop.id ? null : { stopId: stop.id, anchor: { x: rect.left, y: rect.top } });
              }}
            />
            <input
              className="gradient-stop-hex-input"
              value={stop.color.slice(1).toUpperCase()}
              maxLength={6}
              spellCheck={false}
              onClick={e => e.stopPropagation()}
              onChange={e => {
                const v = e.target.value.replace(/[^0-9a-fA-F]/g, '').toUpperCase();
                if (v.length === 6) updateStop(stop.id, { color: `#${v}` });
              }}
            />
            <input
              className="gradient-stop-alpha-input"
              type="number" min={0} max={100} step={1}
              value={Math.round(stop.opacity * 100)}
              onClick={e => e.stopPropagation()}
              onChange={e => { const n = parseInt(e.target.value); if (!isNaN(n)) updateStop(stop.id, { opacity: Math.max(0, Math.min(1, n / 100)) }); }}
            />
            <span className="gradient-stop-pct">%</span>
            <button
              className="gradient-stop-remove"
              title="Remove stop"
              onClick={e => { e.stopPropagation(); removeStop(stop.id); }}
            >−</button>
          </div>
        ))}
      </div>

      {stopPicker && (() => {
        const stopColor = gradient.stops.find(s => s.id === stopPicker.stopId)?.color ?? '#000000';
        return (
          <StopColorPicker
            hex={stopColor}
            anchor={stopPicker.anchor}
            onHexChange={hex => updateStop(stopPicker.stopId, { color: hex })}
            onClose={() => setStopPicker(null)}
          />
        );
      })()}
    </div>
  );
}

// ─── Color Picker Popup ───────────────────────────────────────────────────────

const POPUP_W = 240;

function ColorPickerPopup({
  hex, opacity, mode, gradient, anchor, label,
  onClose, onHexChange, onOpacityChange, onModeChange, onGradientChange,
}: {
  hex: string; opacity: number; mode: 'solid' | 'gradient';
  gradient: GradientDef | null; anchor: { x: number; y: number }; label: string;
  onClose: () => void; onHexChange: (h: string) => void; onOpacityChange: (v: number) => void;
  onModeChange: (m: 'solid' | 'gradient') => void; onGradientChange: (g: GradientDef) => void;
}) {
  const popupRef = useRef<HTMLDivElement>(null);
  const svRef = useRef<HTMLDivElement>(null);
  const hueRef = useRef<HTMLDivElement>(null);
  const alphaRef = useRef<HTMLDivElement>(null);

  const [hsv, setHsv] = useState<[number, number, number]>(() => hexToHsv(hex));
  const [hexInput, setHexInput] = useState(hex.slice(1).toUpperCase());
  const [alphaInput, setAlphaInput] = useState(String(Math.round(opacity * 100)));

  useEffect(() => {
    setHsv(hexToHsv(hex));
    setHexInput(hex.slice(1).toUpperCase());
  }, [hex]);

  useEffect(() => {
    setAlphaInput(String(Math.round(opacity * 100)));
  }, [opacity]);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener('mousedown', onDown, true);
    return () => document.removeEventListener('mousedown', onDown, true);
  }, [onClose]);

  const [h, s, v] = hsv;
  const pureHue = hsvToHex(h, 1, 1);

  function startSvDrag(e: React.MouseEvent) {
    e.preventDefault();
    const el = svRef.current;
    if (!el) return;
    function update(ev: MouseEvent) {
      const rect = el!.getBoundingClientRect();
      const ns = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
      const nv = Math.max(0, Math.min(1, 1 - (ev.clientY - rect.top) / rect.height));
      setHsv([h, ns, nv]);
      const newHex = hsvToHex(h, ns, nv);
      setHexInput(newHex.slice(1).toUpperCase());
      onHexChange(newHex);
    }
    function onUp() { window.removeEventListener('mousemove', update); window.removeEventListener('mouseup', onUp); }
    window.addEventListener('mousemove', update);
    window.addEventListener('mouseup', onUp);
    update(e.nativeEvent);
  }

  function startHueDrag(e: React.MouseEvent) {
    e.preventDefault();
    const el = hueRef.current;
    if (!el) return;
    function update(ev: MouseEvent) {
      const rect = el!.getBoundingClientRect();
      const nh = Math.max(0, Math.min(360, (ev.clientX - rect.left) / rect.width * 360));
      setHsv([nh, s, v]);
      const newHex = hsvToHex(nh, s, v);
      setHexInput(newHex.slice(1).toUpperCase());
      onHexChange(newHex);
    }
    function onUp() { window.removeEventListener('mousemove', update); window.removeEventListener('mouseup', onUp); }
    window.addEventListener('mousemove', update);
    window.addEventListener('mouseup', onUp);
    update(e.nativeEvent);
  }

  function startAlphaDrag(e: React.MouseEvent) {
    e.preventDefault();
    const el = alphaRef.current;
    if (!el) return;
    function update(ev: MouseEvent) {
      const rect = el!.getBoundingClientRect();
      const na = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
      setAlphaInput(String(Math.round(na * 100)));
      onOpacityChange(na);
    }
    function onUp() { window.removeEventListener('mousemove', update); window.removeEventListener('mouseup', onUp); }
    window.addEventListener('mousemove', update);
    window.addEventListener('mouseup', onUp);
    update(e.nativeEvent);
  }

  const left = Math.max(4, anchor.x - POPUP_W - 8);
  const top = Math.max(4, Math.min(anchor.y, window.innerHeight - 380));

  return createPortal(
    <div ref={popupRef} className="color-popup" style={{ position: 'fixed', left, top, zIndex: 20000, width: POPUP_W }}>
      <div className="color-popup-header">
        <span className="color-popup-title">{label}</span>
        <div className="color-mode-toggle">
          <button className={`color-mode-btn ${mode === 'solid' ? 'color-mode-btn--active' : ''}`} onClick={() => onModeChange('solid')}>Solid</button>
          <button className={`color-mode-btn ${mode === 'gradient' ? 'color-mode-btn--active' : ''}`} onClick={() => onModeChange('gradient')}>Gradient</button>
        </div>
      </div>

      {mode === 'solid' ? (
        <>
          <div ref={svRef} className="color-sv-square" onMouseDown={startSvDrag} style={{ background: pureHue }}>
            <div className="color-sv-white" />
            <div className="color-sv-black" />
            <div className="color-sv-cursor" style={{ left: `${s * 100}%`, top: `${(1 - v) * 100}%` }} />
          </div>

          <div className="color-sliders">
            <div ref={hueRef} className="color-hue-bar" onMouseDown={startHueDrag}>
              <div className="color-slider-thumb" style={{ left: `${h / 360 * 100}%`, background: pureHue }} />
            </div>
            <div ref={alphaRef} className="color-alpha-bar" onMouseDown={startAlphaDrag}>
              <div className="color-alpha-fill" style={{ background: `linear-gradient(to right, transparent, ${hex})` }} />
              <div className="color-slider-thumb" style={{ left: `${opacity * 100}%`, background: hex }} />
            </div>
          </div>

          <div className="color-popup-inputs">
            <div className="color-popup-input-group">
              <span className="color-popup-input-label">Hex</span>
              <input
                className="color-popup-text-input"
                value={hexInput}
                maxLength={6}
                spellCheck={false}
                onChange={e => {
                  const val = e.target.value.replace(/[^0-9a-fA-F]/g, '').toUpperCase();
                  setHexInput(val);
                  if (val.length === 6) {
                    const newHex = `#${val}`;
                    setHsv(hexToHsv(newHex));
                    onHexChange(newHex);
                  }
                }}
              />
            </div>
            <div className="color-popup-input-group" style={{ flex: '0 0 60px' }}>
              <span className="color-popup-input-label">%</span>
              <input
                className="color-popup-text-input"
                type="number" min={0} max={100} step={1}
                value={alphaInput}
                onChange={e => {
                  setAlphaInput(e.target.value);
                  const n = parseInt(e.target.value);
                  if (!isNaN(n)) onOpacityChange(Math.max(0, Math.min(100, n)) / 100);
                }}
              />
            </div>
          </div>
        </>
      ) : (
        gradient
          ? <GradientEditor gradient={gradient} onChange={onGradientChange} />
          : <div style={{ padding: 8 }}>
              <button className="btn" onClick={() => onGradientChange(defaultGradient())}>Create Gradient</button>
            </div>
      )}
    </div>,
    document.body
  );
}

// ─── Color Row ────────────────────────────────────────────────────────────────

function ColorRow({ layerId, property }: { layerId: string; property: 'fillColor' | 'strokeColor' }) {
  const { state, dispatch } = useApp();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerAnchor, setPickerAnchor] = useState({ x: 0, y: 0 });

  const layer = state.layers.find(l => l.id === layerId)!;
  const vals = interpolateTracks(layer.tracks, state.currentTime);
  const hasKfs = layer.tracks[property].length > 0;
  const kfAtPlayhead = layer.tracks[property].find(kf => Math.abs(kf.time - state.currentTime) < 0.001);
  const label = property === 'fillColor' ? 'Fill' : 'Stroke';
  const defaultColorKey = property === 'fillColor' ? 'defaultFill' : 'defaultStroke';
  const opacityProperty: 'fillOpacity' | 'strokeOpacity' = property === 'fillColor' ? 'fillOpacity' : 'strokeOpacity';
  const gradientKey = property === 'fillColor' ? 'fillGradient' : 'strokeGradient';
  const target: 'fill' | 'stroke' = property === 'fillColor' ? 'fill' : 'stroke';

  const noneKey = property === 'fillColor' ? 'fillNone' : 'strokeNone';
  const isNone = layer[noneKey] ?? false;

  const gradient = layer[gradientKey] ?? null;
  const mode: 'solid' | 'gradient' = gradient ? 'gradient' : 'solid';
  const displayHex = hasKfs ? unpackColor(vals[property]) : (layer[defaultColorKey] ?? '#000000');
  const displayOpacity = layer.tracks[opacityProperty].length > 0
    ? vals[opacityProperty]
    : (layer.baseValues?.[opacityProperty] ?? 1);

  const swatchBg = mode === 'gradient' && gradient ? gradientCss(gradient) : displayHex;

  function handleColorChange(hex: string) {
    const packed = packColor(hex);
    const kf = layer.tracks[property].find(k => Math.abs(k.time - state.currentTime) < 0.001);
    if (kf) {
      dispatch({ type: 'UPDATE_PROPERTY_KEYFRAME', layerId, property, keyframeId: kf.id, value: packed });
    } else if (!hasKfs) {
      dispatch({ type: 'SET_LAYER_DEFAULT_COLORS', layerId, [defaultColorKey]: hex });
    }
  }

  function handleOpacityChange(val: number) {
    const kf = layer.tracks[opacityProperty].find(k => Math.abs(k.time - state.currentTime) < 0.001);
    if (kf) {
      dispatch({ type: 'UPDATE_PROPERTY_KEYFRAME', layerId, property: opacityProperty, keyframeId: kf.id, value: val });
    } else if (layer.tracks[opacityProperty].length === 0) {
      dispatch({ type: 'SET_LAYER_BASE_VALUE', layerId, property: opacityProperty, value: val });
    }
  }

  function setMode(m: 'solid' | 'gradient') {
    if (m === 'gradient') {
      dispatch({ type: 'SET_LAYER_GRADIENT', layerId, target, gradient: gradient ?? defaultGradient() });
    } else {
      dispatch({ type: 'SET_LAYER_GRADIENT', layerId, target, gradient: null });
    }
  }

  function openPicker(e: React.MouseEvent) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setPickerAnchor({ x: rect.left, y: rect.top });
    setPickerOpen(true);
  }

  return (
    <div className="color-prop-row">
      <span className="color-prop-label">{label}</span>
      <div
        className={`color-trigger${isNone ? ' color-trigger--none' : ''}`}
        onClick={isNone ? undefined : openPicker}
        style={isNone ? { cursor: 'default' } : undefined}
      >
        {isNone ? (
          <span className="color-none-label">None</span>
        ) : (
          <>
            <div className="color-swatch" style={{ background: swatchBg }} />
            <span className="color-hex-label">
              {mode === 'solid' ? displayHex.slice(1).toUpperCase() : 'Gradient'}
            </span>
            {mode === 'solid' && (
              <span className="color-opacity-label">{Math.round(displayOpacity * 100)}%</span>
            )}
          </>
        )}
      </div>
      <button
        className={`kf-toggle-btn ${kfAtPlayhead ? 'kf-toggle-btn--active' : ''}`}
        title={kfAtPlayhead ? 'Remove color keyframe' : 'Add color keyframe at playhead'}
        onClick={() => {
          const existing = layer.tracks[property].find(kf => Math.abs(kf.time - state.currentTime) < 0.001);
          if (!existing) {
            const value = hasKfs ? vals[property] : packColor(layer[defaultColorKey] ?? '#000000');
            dispatch({ type: 'ADD_PROPERTY_KEYFRAME', layerId, property, keyframe: { id: `kf-${Date.now()}-${Math.random().toString(36).slice(2)}`, time: state.currentTime, value, easing: DEFAULT_EASING } });
          } else {
            dispatch({ type: 'DELETE_PROPERTY_KEYFRAME', layerId, property, keyframeId: existing.id });
          }
        }}
      >◆</button>
      <button
        className="color-remove-btn"
        title={isNone ? `Restore ${label.toLowerCase()}` : `Remove ${label.toLowerCase()}`}
        onClick={() => dispatch({ type: 'SET_LAYER_COLOR_NONE', layerId, target, none: !isNone })}
      >{isNone ? '+' : '×'}</button>

      {pickerOpen && (
        <ColorPickerPopup
          hex={displayHex}
          opacity={displayOpacity}
          mode={mode}
          gradient={gradient}
          anchor={pickerAnchor}
          label={label}
          onClose={() => setPickerOpen(false)}
          onHexChange={handleColorChange}
          onOpacityChange={handleOpacityChange}
          onModeChange={setMode}
          onGradientChange={g => dispatch({ type: 'SET_LAYER_GRADIENT', layerId, target, gradient: g })}
        />
      )}
    </div>
  );
}

// ─── Path Point Section ───────────────────────────────────────────────────────

function makeKfId() { return `pkf-${Date.now()}-${Math.random().toString(36).slice(2)}`; }

function PathPointSection({ layerId }: { layerId: string }) {
  const { state, dispatch } = useApp();
  const layer = state.layers.find(l => l.id === layerId)!;
  const { selectedPointId, currentTime } = state;

  const livePoints = interpolatePathPoints(layer.pathKeyframes ?? [], currentTime);
  const kfAtPlayhead = (layer.pathKeyframes ?? []).find(kf => Math.abs(kf.time - currentTime) < 0.001);
  const hasKfs = (layer.pathKeyframes?.length ?? 0) > 0;

  function getLiveElPoints(): { points: PathPoint[]; closed: boolean } | null {
    const svgEl = document.querySelector('.svg-host svg') as SVGSVGElement | null;
    if (!svgEl) return null;
    const el = svgEl.getElementById(layer.elementId);
    if (!el) return null;
    const tag = layer.tagName.toLowerCase();
    if (tag === 'polygon' || tag === 'polyline') {
      const attr = el.getAttribute('points');
      if (!attr) return null;
      const nums = attr.trim().split(/[\s,]+/).map(Number).filter(n => !isNaN(n));
      const points: PathPoint[] = [];
      for (let i = 0; i + 1 < nums.length; i += 2) {
        const idx = points.length;
        const x = nums[i], y = nums[i + 1];
        points.push({ id: `${layer.elementId}-${idx}`, x, y, cpInX: x, cpInY: y, cpOutX: x, cpOutY: y, type: 'corner' });
      }
      return points.length > 0 ? { points, closed: tag === 'polygon' } : null;
    }
    const d = el.getAttribute('d');
    if (!d) return null;
    return parsePath(d, layer.elementId);
  }

  const displayPoints: PathPoint[] | null = livePoints && livePoints.length > 0
    ? livePoints
    : getLiveElPoints()?.points ?? null;

  const selectedPt = displayPoints?.find(p => p.id === selectedPointId) ?? null;

  if (!selectedPt) {
    return (
      <div className="prop-section">
        <div className="prop-section-title">Shape</div>
        <div style={{ padding: '4px 8px', fontSize: 11, color: 'var(--text-muted)' }}>
          Click an anchor point on the canvas
        </div>
        {hasKfs && (
          <div style={{ padding: '4px 8px', fontSize: 10, color: 'var(--kf-color)' }}>
            {layer.pathKeyframes!.length} shape keyframe{layer.pathKeyframes!.length > 1 ? 's' : ''}
          </div>
        )}
      </div>
    );
  }

  function addKfFromCurrent() {
    const pts = displayPoints!;
    const ref = layer.pathKeyframes?.[0];
    const aligned = ref ? alignPointIds(pts, ref.points) : pts;
    const elData = getLiveElPoints();
    dispatch({ type: 'ADD_PATH_KEYFRAME', layerId, keyframe: { id: makeKfId(), time: currentTime, points: aligned, closed: elData?.closed ?? false, easing: DEFAULT_EASING, movedPointIds: selectedPointId ? [selectedPointId] : [] } });
  }

  function updatePoint(patch: Partial<PathPoint>) {
    if (!displayPoints) return;
    const newPoints = displayPoints.map(p => p.id === selectedPt!.id ? { ...p, ...patch } : p);
    if (kfAtPlayhead) {
      dispatch({ type: 'UPDATE_PATH_KEYFRAME', layerId, keyframeId: kfAtPlayhead.id, points: newPoints });
    } else {
      const ref = layer.pathKeyframes?.[0];
      const aligned = ref ? alignPointIds(newPoints, ref.points) : newPoints;
      const elData = getLiveElPoints();
      const newKf: PathKeyframe = { id: makeKfId(), time: currentTime, points: aligned, closed: elData?.closed ?? false, easing: DEFAULT_EASING, movedPointIds: selectedPointId ? [selectedPointId] : [] };
      dispatch({ type: 'ADD_PATH_KEYFRAME', layerId, keyframe: newKf });
    }
  }

  function setPointType(type: PointType) {
    if (!selectedPt) return;
    if (type === 'corner') {
      updatePoint({ type, cpInX: selectedPt.x, cpInY: selectedPt.y, cpOutX: selectedPt.x, cpOutY: selectedPt.y });
    } else if (type === 'smooth') {
      const dx = selectedPt.cpOutX - selectedPt.x, dy = selectedPt.cpOutY - selectedPt.y;
      updatePoint({ type, cpInX: selectedPt.x - dx, cpInY: selectedPt.y - dy });
    } else {
      updatePoint({ type });
    }
  }

  const hasKfHere = !!kfAtPlayhead;

  return (
    <div className="prop-section">
      <div className="prop-section-title">Anchor Point</div>
      {/* X / Y with inline keyframe button */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 8px 2px' }}>
        <div className="compact-prop" style={{ flex: 1 }}>
          <span className="compact-prop-label">X</span>
          <input className="compact-prop-input" type="number" step={0.5} value={selectedPt.x.toFixed(1)}
            disabled={!hasKfHere}
            onChange={e => { const val = parseFloat(e.target.value); if (!isNaN(val)) updatePoint({ x: val, cpInX: val + (selectedPt.cpInX - selectedPt.x), cpOutX: val + (selectedPt.cpOutX - selectedPt.x) }); }} />
        </div>
        <div className="compact-prop" style={{ flex: 1 }}>
          <span className="compact-prop-label">Y</span>
          <input className="compact-prop-input" type="number" step={0.5} value={selectedPt.y.toFixed(1)}
            disabled={!hasKfHere}
            onChange={e => { const val = parseFloat(e.target.value); if (!isNaN(val)) updatePoint({ y: val, cpInY: val + (selectedPt.cpInY - selectedPt.y), cpOutY: val + (selectedPt.cpOutY - selectedPt.y) }); }} />
        </div>
        <button
          className={`kf-toggle-btn ${hasKfHere ? 'kf-toggle-btn--active' : ''}`}
          title={hasKfHere ? 'Remove shape keyframe' : 'Add shape keyframe'}
          onClick={() => { if (kfAtPlayhead) { dispatch({ type: 'DELETE_PATH_KEYFRAME', layerId, keyframeId: kfAtPlayhead.id }); } else { addKfFromCurrent(); } }}
        >◆</button>
      </div>
      <div className="prop-row" style={{ padding: '4px 8px', gap: 4 }}>
        <label className="prop-label" style={{ fontSize: 10 }}>Type</label>
        <div className="color-mode-toggle">
          {(['corner', 'smooth', 'asymmetric'] as PointType[]).map(t => (
            <button key={t} className={`color-mode-btn ${selectedPt.type === t ? 'color-mode-btn--active' : ''}`}
              onClick={() => setPointType(t)} style={{ fontSize: 9, padding: '2px 4px' }}>
              {t === 'corner' ? 'Corner' : t === 'smooth' ? 'Smooth' : 'Asym'}
            </button>
          ))}
        </div>
      </div>
      {selectedPt.type !== 'corner' && (
        <>
          <div style={{ padding: '3px 8px 1px', fontSize: 10, color: 'var(--text-muted)' }}>In handle</div>
          <div className="prop-grid-2col">
            <div className="compact-prop">
              <span className="compact-prop-label">X</span>
              <input className="compact-prop-input" type="number" step={0.5} value={selectedPt.cpInX.toFixed(1)}
                onChange={e => { const val = parseFloat(e.target.value); if (!isNaN(val)) updatePoint({ cpInX: val }); }} />
            </div>
            <div className="compact-prop">
              <span className="compact-prop-label">Y</span>
              <input className="compact-prop-input" type="number" step={0.5} value={selectedPt.cpInY.toFixed(1)}
                onChange={e => { const val = parseFloat(e.target.value); if (!isNaN(val)) updatePoint({ cpInY: val }); }} />
            </div>
          </div>
          <div style={{ padding: '3px 8px 1px', fontSize: 10, color: 'var(--text-muted)' }}>Out handle</div>
          <div className="prop-grid-2col">
            <div className="compact-prop">
              <span className="compact-prop-label">X</span>
              <input className="compact-prop-input" type="number" step={0.5} value={selectedPt.cpOutX.toFixed(1)}
                onChange={e => { const val = parseFloat(e.target.value); if (!isNaN(val)) updatePoint({ cpOutX: val }); }} />
            </div>
            <div className="compact-prop">
              <span className="compact-prop-label">Y</span>
              <input className="compact-prop-input" type="number" step={0.5} value={selectedPt.cpOutY.toFixed(1)}
                onChange={e => { const val = parseFloat(e.target.value); if (!isNaN(val)) updatePoint({ cpOutY: val }); }} />
            </div>
          </div>
        </>
      )}
      {hasKfs && (
        <div style={{ padding: '4px 8px', fontSize: 10, color: 'var(--kf-color)' }}>
          {layer.pathKeyframes!.length} shape keyframe{layer.pathKeyframes!.length > 1 ? 's' : ''}
        </div>
      )}
    </div>
  );
}

// ─── Selected KF Section ──────────────────────────────────────────────────────

function SelectedKfSection() {
  const { state, dispatch, deleteSelectedKeyframes } = useApp();
  const { selectedKeyframes } = state;
  if (selectedKeyframes.length === 0) return null;

  if (selectedKeyframes.length > 1) {
    return (
      <div className="selected-kf-section">
        <div className="selected-kf-title">Selected Keyframes</div>
        <div className="selected-kf-meta">{selectedKeyframes.length} keyframes selected</div>
        <div className="easing-direction-label">Easing (all selected)</div>
        <EasingPicker
          easing={(() => {
            const first = selectedKeyframes[0];
            const layer = state.layers.find(l => l.id === first.layerId);
            const kf = layer?.tracks[first.property].find(k => k.id === first.keyframeId);
            return kf?.easing ?? { type: 'preset' as const, name: 'ease' as const };
          })()}
          onChange={(easing: EasingConfig) => dispatch({ type: 'SET_SELECTED_KFS_EASING', easing })}
        />
        <button className="btn btn-danger" style={{ marginTop: 4, fontSize: 11, padding: '3px 8px' }} onClick={deleteSelectedKeyframes}>
          Delete All
        </button>
      </div>
    );
  }

  const sel = selectedKeyframes[0];
  const layer = state.layers.find(l => l.id === sel.layerId);
  if (!layer) return null;
  const kfs = [...layer.tracks[sel.property]].sort((a, b) => a.time - b.time);
  const kfIndex = kfs.findIndex(k => k.id === sel.keyframeId);
  const kf = kfs[kfIndex];
  if (!kf) return null;
  const prevKf = kfIndex > 0 ? kfs[kfIndex - 1] : null;
  const nextKf = kfIndex < kfs.length - 1 ? kfs[kfIndex + 1] : null;

  return (
    <div className="selected-kf-section">
      <div className="selected-kf-title">Selected Keyframe</div>
      <div className="selected-kf-meta">{layer.label} · {PROPERTY_LABELS[sel.property]} · {kf.time.toFixed(2)}s</div>
      {nextKf && (
        <div>
          <div className="easing-direction-label">&#8594; Out easing</div>
          <EasingPicker easing={kf.easing} onChange={(easing: EasingConfig) => dispatch({ type: 'UPDATE_PROPERTY_KEYFRAME', layerId: sel.layerId, property: sel.property, keyframeId: kf.id, easing })} />
        </div>
      )}
      {prevKf && (
        <div>
          <div className="easing-direction-label">&#8592; In easing</div>
          <EasingPicker easing={prevKf.easing} onChange={(easing: EasingConfig) => dispatch({ type: 'UPDATE_PROPERTY_KEYFRAME', layerId: sel.layerId, property: sel.property, keyframeId: prevKf.id, easing })} />
        </div>
      )}
    </div>
  );
}

// ─── Preset Animations ────────────────────────────────────────────────────────

type PresetTrack = { prop: AnimatableProperty; from: number; to: number };
interface PresetDef { label: string; tracks: PresetTrack[]; }

const PRESETS: PresetDef[] = [
  { label: 'Fade In',      tracks: [{ prop: 'opacity', from: 0, to: 1 }] },
  { label: 'Fade Out',     tracks: [{ prop: 'opacity', from: 1, to: 0 }] },
  { label: '← Slide In',  tracks: [{ prop: 'x', from: 10, to: 0 },  { prop: 'opacity', from: 0, to: 1 }] },
  { label: '→ Slide In',  tracks: [{ prop: 'x', from: -10, to: 0 }, { prop: 'opacity', from: 0, to: 1 }] },
  { label: '↑ Slide In',  tracks: [{ prop: 'y', from: 10, to: 0 },  { prop: 'opacity', from: 0, to: 1 }] },
  { label: '↓ Slide In',  tracks: [{ prop: 'y', from: -10, to: 0 }, { prop: 'opacity', from: 0, to: 1 }] },
  { label: '← Slide Out', tracks: [{ prop: 'x', from: 0, to: 10 },  { prop: 'opacity', from: 1, to: 0 }] },
  { label: '→ Slide Out', tracks: [{ prop: 'x', from: 0, to: -10 }, { prop: 'opacity', from: 1, to: 0 }] },
  { label: '↑ Slide Out', tracks: [{ prop: 'y', from: 0, to: 10 },  { prop: 'opacity', from: 1, to: 0 }] },
  { label: '↓ Slide Out', tracks: [{ prop: 'y', from: 0, to: -10 }, { prop: 'opacity', from: 1, to: 0 }] },
];

function AnimationPresets({ layerId }: { layerId: string }) {
  const { state, dispatch } = useApp();
  function applyPreset(preset: PresetDef) {
    const t0 = state.currentTime, t1 = Math.min(state.duration, t0 + 0.5);
    for (const { prop, from, to } of preset.tracks) {
      dispatch({ type: 'ADD_PROPERTY_KEYFRAME', layerId, property: prop, keyframe: { id: `kf-${Date.now()}-${Math.random().toString(36).slice(2)}-0`, time: t0, value: from, easing: { type: 'preset', name: 'ease-in-out' } } });
      dispatch({ type: 'ADD_PROPERTY_KEYFRAME', layerId, property: prop, keyframe: { id: `kf-${Date.now()}-${Math.random().toString(36).slice(2)}-1`, time: t1, value: to, easing: { type: 'preset', name: 'ease' } } });
    }
  }
  return (
    <div className="prop-section">
      <div className="prop-section-title">Quick Animations</div>
      <div style={{ padding: '4px 8px', fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.4 }}>
        Applies 500ms animation from current time
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, padding: '4px 8px 8px' }}>
        {PRESETS.map(preset => (
          <button key={preset.label} className="btn" style={{ fontSize: 10, padding: '4px 6px', textAlign: 'left' }} onClick={() => applyPreset(preset)}>
            {preset.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export default function PropertiesPanel() {
  const { state, dispatch } = useApp();

  let layer = state.layers.find(l => l.id === state.selectedLayerId);
  if (!layer && state.selectedKeyframes.length > 0) {
    layer = state.layers.find(l => l.id === state.selectedKeyframes[0].layerId);
  }

  if (!layer) {
    return (
      <div className="properties-panel">
        <div className="panel-header">Properties</div>
        <div className="panel-empty">Select a layer to edit</div>
        <SelectedKfSection />
      </div>
    );
  }

  const isPathLike = PATH_LIKE_TAGS.has(layer.tagName.toLowerCase());
  const pointSelected = !!state.selectedPointId;

  return (
    <div className="properties-panel">
      <div className="panel-header">
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {layer.label}
        </span>
      </div>

      {isPathLike && pointSelected ? (
        <>
          <PathPointSection layerId={layer.id} />
          <SelectedKfSection />
        </>
      ) : (
        <>
          {/* Transform */}
          <div className="prop-section">
            <div className="prop-section-title">Position</div>
            <div className="prop-grid-2col">
              <CompactPropInput layerId={layer.id} property="x" label="X" step={1} />
              <CompactPropInput layerId={layer.id} property="y" label="Y" step={1} />
            </div>
            <div className="prop-grid-2col">
              <CompactPropInput layerId={layer.id} property="rotation" label="R" step={1} suffix="°" />
              <CompactPropInput layerId={layer.id} property="opacity" label="A" step={0.01} min={0} max={1} />
            </div>
          </div>

          {/* Scale */}
          <div className="prop-section">
            <div className="prop-section-title">Scale</div>
            <div className="prop-grid-2col">
              <CompactPropInput layerId={layer.id} property="scaleX" label="X" step={0.01} min={0} />
              <CompactPropInput layerId={layer.id} property="scaleY" label="Y" step={0.01} min={0} />
            </div>
          </div>

          {/* Trim Path */}
          {isPathLike && (
            <div className="prop-section">
              <div className="prop-section-title">Trim Path</div>
              <div className="prop-grid-2col">
                <CompactPropInput layerId={layer.id} property="trimStart" label="S" step={0.01} min={0} max={1} />
                <CompactPropInput layerId={layer.id} property="trimEnd" label="E" step={0.01} min={0} max={1} />
              </div>
            </div>
          )}

          {/* Colors */}
          <div className="prop-section">
            <div className="prop-section-title">Colors</div>
            <ColorRow layerId={layer.id} property="fillColor" />
            <ColorRow layerId={layer.id} property="strokeColor" />
            <div className="prop-grid-2col" style={{ marginTop: 4 }}>
              <div style={{ gridColumn: '1/-1' }}>
                <CompactPropInput layerId={layer.id} property="opacity" label="Opacity" step={0.01} min={0} max={1} />
              </div>
            </div>
          </div>

          {layer.skeletonMode && (
            <div className="prop-section">
              <div className="prop-section-title">Skeleton</div>
              {(
                [
                  { key: 'stroke', label: 'Outline', def: '#ffffff' },
                  { key: 'fill',   label: 'Fill',    def: '#ffffff' },
                  { key: 'anchor', label: 'Anchors', def: '#ff9d3a' },
                ] as { key: 'stroke' | 'fill' | 'anchor'; label: string; def: string }[]
              ).map(({ key, label, def }) => {
                const hex = layer.skeletonColors?.[key] ?? def;
                return (
                  <div key={key} className="color-prop-row">
                    <span className="color-prop-label">{label}</span>
                    <label className="skeleton-color-trigger">
                      <div className="color-swatch" style={{ background: hex }} />
                      <span className="color-hex-label">{hex.slice(1).toUpperCase()}</span>
                      <input
                        type="color"
                        value={hex}
                        onChange={e => dispatch({
                          type: 'SET_LAYER_SKELETON_COLORS',
                          layerId: layer.id,
                          colors: { [key]: e.target.value },
                        })}
                        className="skeleton-color-native"
                      />
                    </label>
                  </div>
                );
              })}
              {(() => {
                const sk = layer.skeletonColors ?? {};
                function skNum(field: 'strokeWidth'|'handleScale'|'strokeOpacity'|'fillOpacity'|'patternSize', label: string, def: number, step: number, min = 0.01) {
                  return (
                    <div className="compact-prop">
                      <span className="compact-prop-label">{label}</span>
                      <input
                        className="prop-input compact-prop-input"
                        type="number"
                        min={min}
                        step={step}
                        value={sk[field] ?? def}
                        onChange={e => {
                          const v = parseFloat(e.target.value);
                          if (!isNaN(v) && v >= min) dispatch({ type: 'SET_LAYER_SKELETON_COLORS', layerId: layer!.id, colors: { [field]: v } });
                        }}
                      />
                    </div>
                  );
                }
                return (
                  <div style={{ padding: '2px 8px 4px' }}>
                    <div className="prop-grid-2col">
                      {skNum('strokeOpacity', 'Outline A', 0.9, 0.05, 0)}
                      {skNum('fillOpacity',   'Fill A',    0.32, 0.05, 0)}
                    </div>
                    <div className="prop-grid-2col">
                      {skNum('strokeWidth',   'Stroke W',  1,   0.5, 0.1)}
                      {skNum('handleScale',   'Handle ×',  1,   0.1, 0.1)}
                    </div>
                    <div className="prop-grid-2col">
                      {skNum('patternSize',   'Pattern px', 8,  1,   1)}
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

          {/* Motion Path */}
          {layer.motionPathId && (
            <div className="prop-section">
              <div className="prop-section-title">Motion Path</div>
              <div style={{ padding: '4px 8px', fontSize: 11, color: 'var(--text-muted)' }}>
                Path: {state.motionPaths.find(p => p.id === layer.motionPathId)?.label ?? 'Unknown'}
              </div>
              <div className="prop-row" style={{ padding: '4px 8px' }}>
                <label className="prop-label">Auto-rotate</label>
                <input type="checkbox" checked={layer.autoRotate ?? false}
                  onChange={e => dispatch({ type: 'SET_LAYER_AUTO_ROTATE', layerId: layer!.id, autoRotate: e.target.checked })} />
              </div>
              <PropRow layerId={layer.id} property="motionOffset" step={0.01} min={0} max={1} />
            </div>
          )}

          <SelectedKfSection />
          <AnimationPresets layerId={layer.id} />
        </>
      )}
    </div>
  );
}
