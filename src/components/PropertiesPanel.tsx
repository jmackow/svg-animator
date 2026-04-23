import React, { useEffect, useRef, useState } from 'react';
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

const PROP_GROUPS: Array<{
  title: string;
  props: Array<{ key: AnimatableProperty; step: number; min?: number; max?: number; suffix?: string }>;
  pathLikeOnly?: boolean;
}> = [
  { title: 'Position', props: [
    { key: 'x', step: 1, suffix: 'px' },
    { key: 'y', step: 1, suffix: 'px' },
  ]},
  { title: 'Scale', props: [
    { key: 'scaleX', step: 0.01, min: 0 },
    { key: 'scaleY', step: 0.01, min: 0 },
  ]},
  { title: 'Rotation', props: [{ key: 'rotation', step: 1, suffix: '°' }] },
  { title: 'Opacity',  props: [{ key: 'opacity',  step: 0.01, min: 0, max: 1 }] },
  { title: 'Trim Path', pathLikeOnly: true, props: [
    { key: 'trimStart', step: 0.01, min: 0, max: 1 },
    { key: 'trimEnd',   step: 0.01, min: 0, max: 1 },
  ]},
];

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

  // Find first selected KF that belongs to this property
  const selectedKf = state.selectedKeyframes
    .filter((s) => s.layerId === layerId && s.property === property)
    .map((s) => layer.tracks[property].find((kf) => kf.id === s.keyframeId))
    .find((kf) => kf !== undefined);

  // The keyframe we're editing: prefer selected, fall back to playhead kf
  const editableKf = selectedKf ?? kfAtPlayhead;

  // When track has no keyframes at all, edit the base value directly
  const isBaseMode = layer.tracks[property].length === 0;

  const interpolated = interpolateProperty(
    layer.tracks[property], state.currentTime, PROPERTY_DEFAULTS[property]
  );
  const baseVal = isBaseMode ? (layer.baseValues?.[property] ?? PROPERTY_DEFAULTS[property]) : PROPERTY_DEFAULTS[property];
  const displayValue = editableKf ? editableKf.value : (isBaseMode ? baseVal : interpolated);

  const [raw, setRaw] = useState(displayValue.toFixed(step < 1 ? 3 : 0));
  useEffect(() => {
    setRaw(displayValue.toFixed(step < 1 ? 3 : 0));
  }, [displayValue, step]);

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
          title={
            isBaseMode
              ? 'Base value — click ◆ to add a keyframe'
              : editableKf
              ? editableKf === kfAtPlayhead
                ? 'Editing keyframe at playhead'
                : `Editing keyframe at ${editableKf.time.toFixed(2)}s`
              : 'No keyframe — click ◆ to add one'
          }
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

      {/* Opacity slider */}
      {property === 'opacity' && (
        <div className="prop-row">
          <input type="range" min={0} max={1} step={0.01} value={displayValue}
            disabled={!isEditable}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              if (editableKf) {
                dispatch({ type: 'UPDATE_PROPERTY_KEYFRAME', layerId, property, keyframeId: editableKf.id, value: v });
              } else if (isBaseMode) {
                dispatch({ type: 'SET_LAYER_BASE_VALUE', layerId, property, value: v });
              }
            }}
            style={{ flex: 1, marginLeft: 68 }}
          />
        </div>
      )}
    </div>
  );
}

// ─── Gradient Editor ──────────────────────────────────────────────────────────

function GradientEditor({ gradient, onChange }: { gradient: GradientDef; onChange: (g: GradientDef) => void }) {
  const [selectedStopId, setSelectedStopId] = useState(gradient.stops[0]?.id ?? null);
  const trackRef = useRef<HTMLDivElement>(null);

  const selectedStop = gradient.stops.find(s => s.id === selectedStopId) ?? gradient.stops[0];

  function updateStop(id: string, patch: Partial<GradientStop>) {
    onChange({ ...gradient, stops: gradient.stops.map(s => s.id === id ? { ...s, ...patch } : s) });
  }

  function addStop() {
    const mid = gradient.stops.length >= 2
      ? (gradient.stops[0].offset + gradient.stops[gradient.stops.length - 1].offset) / 2
      : 0.5;
    const newStop: GradientStop = { id: makeStopId(), offset: mid, color: '#888888', opacity: 1 };
    const newStops = [...gradient.stops, newStop].sort((a, b) => a.offset - b.offset);
    onChange({ ...gradient, stops: newStops });
    setSelectedStopId(newStop.id);
  }

  function removeStop(id: string) {
    if (gradient.stops.length <= 2) return;
    const newStops = gradient.stops.filter(s => s.id !== id);
    onChange({ ...gradient, stops: newStops });
    setSelectedStopId(newStops[0].id);
  }

  // Drag stop handle on the gradient bar
  function startStopDrag(e: React.MouseEvent, stopId: string) {
    e.preventDefault();
    setSelectedStopId(stopId);
    function onMove(mv: MouseEvent) {
      const rect = trackRef.current?.getBoundingClientRect();
      if (!rect) return;
      const offset = Math.max(0, Math.min(1, (mv.clientX - rect.left) / rect.width));
      updateStop(stopId, { offset });
    }
    function onUp() {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  const gradCss = (() => {
    const sorted = [...gradient.stops].sort((a, b) => a.offset - b.offset);
    const stops = sorted.map(s => {
      const r = parseInt(s.color.slice(1, 3), 16);
      const g = parseInt(s.color.slice(3, 5), 16);
      const b = parseInt(s.color.slice(5, 7), 16);
      return `rgba(${r},${g},${b},${s.opacity}) ${(s.offset * 100).toFixed(1)}%`;
    }).join(', ');
    return `linear-gradient(${gradient.angle}deg, ${stops})`;
  })();

  return (
    <div className="gradient-editor">
      {/* Preview bar + stop handles */}
      <div ref={trackRef} className="gradient-track" style={{ background: gradCss }}>
        {gradient.stops.map(stop => (
          <div
            key={stop.id}
            className={`gradient-stop-handle ${stop.id === selectedStopId ? 'gradient-stop-handle--selected' : ''}`}
            style={{ left: `${stop.offset * 100}%`, background: stop.color }}
            onMouseDown={(e) => startStopDrag(e, stop.id)}
            onClick={() => setSelectedStopId(stop.id)}
          />
        ))}
      </div>

      {/* Stop controls */}
      {selectedStop && (
        <div className="gradient-stop-controls">
          <div className="prop-row" style={{ gap: 4 }}>
            <label className="prop-label" style={{ fontSize: 10 }}>Color</label>
            <input type="color" value={selectedStop.color}
              style={{ width: 32, height: 22, border: '1px solid var(--border)', borderRadius: 3, cursor: 'pointer', padding: 1 }}
              onChange={e => updateStop(selectedStop.id, { color: e.target.value })} />
            <label className="prop-label" style={{ fontSize: 10, width: 'auto' }}>A</label>
            <input type="range" min={0} max={1} step={0.01} value={selectedStop.opacity}
              style={{ flex: 1, minWidth: 0 }}
              onChange={e => updateStop(selectedStop.id, { opacity: parseFloat(e.target.value) })} />
            <span style={{ fontSize: 10, width: 28, textAlign: 'right', color: 'var(--text-muted)', flexShrink: 0 }}>
              {Math.round(selectedStop.opacity * 100)}%
            </span>
            <button className="icon-btn" style={{ fontSize: 10, color: 'var(--danger)' }}
              title="Remove stop" onClick={() => removeStop(selectedStop.id)}>✕</button>
          </div>
          <div className="prop-row" style={{ gap: 4 }}>
            <label className="prop-label" style={{ fontSize: 10 }}>Position</label>
            <input type="range" min={0} max={1} step={0.01} value={selectedStop.offset}
              style={{ flex: 1, minWidth: 0 }}
              onChange={e => updateStop(selectedStop.id, { offset: parseFloat(e.target.value) })} />
            <span style={{ fontSize: 10, width: 28, textAlign: 'right', color: 'var(--text-muted)', flexShrink: 0 }}>
              {Math.round(selectedStop.offset * 100)}%
            </span>
          </div>
        </div>
      )}

      {/* Angle + add stop */}
      <div className="prop-row" style={{ gap: 4 }}>
        <label className="prop-label" style={{ fontSize: 10 }}>Angle</label>
        <input type="range" min={0} max={360} step={1} value={gradient.angle}
          style={{ flex: 1, minWidth: 0 }}
          onChange={e => onChange({ ...gradient, angle: parseInt(e.target.value) })} />
        <span style={{ fontSize: 10, width: 32, textAlign: 'right', color: 'var(--text-muted)', flexShrink: 0 }}>
          {gradient.angle}°
        </span>
        <button className="icon-btn" style={{ fontSize: 11 }} title="Add stop" onClick={addStop}>+</button>
      </div>
    </div>
  );
}

// ─── Color Row ────────────────────────────────────────────────────────────────

function ColorRow({ layerId, property }: { layerId: string; property: 'fillColor' | 'strokeColor' }) {
  const { state, dispatch } = useApp();
  const layer = state.layers.find(l => l.id === layerId)!;
  const vals = interpolateTracks(layer.tracks, state.currentTime);
  const hasKfs = layer.tracks[property].length > 0;
  const kfAtPlayhead = layer.tracks[property].find(kf => Math.abs(kf.time - state.currentTime) < 0.001);
  const label = property === 'fillColor' ? 'Fill' : 'Stroke';
  const defaultColorKey = property === 'fillColor' ? 'defaultFill' : 'defaultStroke';
  const opacityProperty: 'fillOpacity' | 'strokeOpacity' = property === 'fillColor' ? 'fillOpacity' : 'strokeOpacity';
  const gradientKey = property === 'fillColor' ? 'fillGradient' : 'strokeGradient';
  const target: 'fill' | 'stroke' = property === 'fillColor' ? 'fill' : 'stroke';

  const gradient = layer[gradientKey] ?? null;
  const mode: 'solid' | 'gradient' = gradient ? 'gradient' : 'solid';

  const displayHex = hasKfs ? unpackColor(vals[property]) : (layer[defaultColorKey] ?? '#000000');

  const opacityKfAtPlayhead = layer.tracks[opacityProperty].find(kf => Math.abs(kf.time - state.currentTime) < 0.001);
  const displayOpacity = layer.tracks[opacityProperty].length > 0 ? vals[opacityProperty] : 1;

  function handleColorChange(hex: string) {
    const packed = packColor(hex);
    const kf = layer.tracks[property].find(k => Math.abs(k.time - state.currentTime) < 0.001);
    if (kf) {
      dispatch({ type: 'UPDATE_PROPERTY_KEYFRAME', layerId, property, keyframeId: kf.id, value: packed });
    } else if (!hasKfs) {
      dispatch({ type: 'SET_LAYER_DEFAULT_COLORS', layerId, [defaultColorKey]: hex });
    }
  }

  function setMode(m: 'solid' | 'gradient') {
    if (m === 'gradient') {
      dispatch({ type: 'SET_LAYER_GRADIENT', layerId, target, gradient: defaultGradient() });
    } else {
      dispatch({ type: 'SET_LAYER_GRADIENT', layerId, target, gradient: null });
    }
  }

  return (
    <div className="color-row-group">
      {/* Row 1: label + mode toggle */}
      <div className="prop-row">
        <label className="prop-label">{label}</label>
        <div className="color-mode-toggle">
          <button className={`color-mode-btn ${mode === 'solid' ? 'color-mode-btn--active' : ''}`} onClick={() => setMode('solid')}>Solid</button>
          <button className={`color-mode-btn ${mode === 'gradient' ? 'color-mode-btn--active' : ''}`} onClick={() => setMode('gradient')}>Gradient</button>
        </div>
      </div>

      {/* Solid: color swatch + keyframe button */}
      {mode === 'solid' && (
        <div className="prop-row">
          <input type="color" value={displayHex}
            style={{ flex: 1, height: 24, border: '1px solid var(--border)', borderRadius: 3, cursor: 'pointer', padding: 1 }}
            onChange={(e) => handleColorChange(e.target.value)} />
          <button
            className={`kf-toggle-btn ${kfAtPlayhead ? 'kf-toggle-btn--active' : ''}`}
            title={kfAtPlayhead ? 'Remove keyframe' : 'Add keyframe'}
            onClick={() => {
              const existing = layer.tracks[property].find(kf => Math.abs(kf.time - state.currentTime) < 0.001);
              if (!existing) {
                const value = hasKfs ? vals[property] : packColor(layer[defaultColorKey] ?? '#000000');
                const kf = { id: `kf-${Date.now()}-${Math.random().toString(36).slice(2)}`, time: state.currentTime, value, easing: DEFAULT_EASING };
                dispatch({ type: 'ADD_PROPERTY_KEYFRAME', layerId, property, keyframe: kf });
              } else {
                dispatch({ type: 'DELETE_PROPERTY_KEYFRAME', layerId, property, keyframeId: existing.id });
              }
            }}
          >◆</button>
        </div>
      )}

      {/* Solid: alpha row */}
      {mode === 'solid' && (
        <div className="prop-row">
          <label className="prop-label" style={{ fontSize: 10 }}>Alpha</label>
          <input type="range" min={0} max={1} step={0.01} value={displayOpacity}
            style={{ flex: 1, minWidth: 0 }}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              const kf = layer.tracks[opacityProperty].find(k => Math.abs(k.time - state.currentTime) < 0.001);
              if (kf) dispatch({ type: 'UPDATE_PROPERTY_KEYFRAME', layerId, property: opacityProperty, keyframeId: kf.id, value: v });
            }} />
          <span style={{ fontSize: 10, width: 28, textAlign: 'right', color: 'var(--text-muted)', flexShrink: 0 }}>
            {Math.round(displayOpacity * 100)}%
          </span>
          <button
            className={`kf-toggle-btn ${opacityKfAtPlayhead ? 'kf-toggle-btn--active' : ''}`}
            title={opacityKfAtPlayhead ? 'Remove opacity keyframe' : 'Add opacity keyframe'}
            onClick={() => {
              const existing = layer.tracks[opacityProperty].find(kf => Math.abs(kf.time - state.currentTime) < 0.001);
              if (!existing) {
                const kf = { id: `kf-${Date.now()}-${Math.random().toString(36).slice(2)}`, time: state.currentTime, value: displayOpacity, easing: DEFAULT_EASING };
                dispatch({ type: 'ADD_PROPERTY_KEYFRAME', layerId, property: opacityProperty, keyframe: kf });
              } else {
                dispatch({ type: 'DELETE_PROPERTY_KEYFRAME', layerId, property: opacityProperty, keyframeId: existing.id });
              }
            }}
          >◆</button>
        </div>
      )}

      {/* Gradient editor */}
      {mode === 'gradient' && gradient && (
        <GradientEditor
          gradient={gradient}
          onChange={(g) => dispatch({ type: 'SET_LAYER_GRADIENT', layerId, target, gradient: g })}
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

  // Read points from live SVG element (for when no kf exists yet)
  function getLiveElPoints(): { points: PathPoint[]; closed: boolean } | null {
    const svgEl = document.querySelector('.svg-host svg') as SVGSVGElement | null;
    if (!svgEl) return null;
    const el = svgEl.getElementById(layer.elementId);
    const d = el?.getAttribute('d');
    if (!d) return null;
    return parsePath(d);
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

  function updatePoint(patch: Partial<PathPoint>) {
    if (!displayPoints) return;
    const newPoints = displayPoints.map(p => p.id === selectedPt!.id ? { ...p, ...patch } : p);

    if (kfAtPlayhead) {
      dispatch({ type: 'UPDATE_PATH_KEYFRAME', layerId, keyframeId: kfAtPlayhead.id, points: newPoints });
    } else {
      // Create new keyframe at current time
      const ref = layer.pathKeyframes?.[0];
      const aligned = ref ? alignPointIds(newPoints, ref.points) : newPoints;
      const elData = getLiveElPoints();
      const newKf: PathKeyframe = {
        id: makeKfId(),
        time: currentTime,
        points: aligned,
        closed: elData?.closed ?? false,
        easing: DEFAULT_EASING,
        movedPointIds: selectedPointId ? [selectedPointId] : [],
      };
      dispatch({ type: 'ADD_PATH_KEYFRAME', layerId, keyframe: newKf });
    }
  }

  function setPointType(type: PointType) {
    if (!selectedPt) return;
    if (type === 'corner') {
      updatePoint({ type, cpInX: selectedPt.x, cpInY: selectedPt.y, cpOutX: selectedPt.x, cpOutY: selectedPt.y });
    } else if (type === 'smooth') {
      // Mirror out handle to in
      const dx = selectedPt.cpOutX - selectedPt.x, dy = selectedPt.cpOutY - selectedPt.y;
      updatePoint({ type, cpInX: selectedPt.x - dx, cpInY: selectedPt.y - dy });
    } else {
      updatePoint({ type });
    }
  }

  const hasKfHere = !!kfAtPlayhead;

  return (
    <div className="prop-section">
      <div className="prop-section-title" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span>Anchor Point</span>
        <button
          className={`kf-toggle-btn ${hasKfHere ? 'kf-toggle-btn--active' : ''}`}
          title={hasKfHere ? 'Remove shape keyframe' : 'Add shape keyframe'}
          onClick={() => {
            if (kfAtPlayhead) {
              dispatch({ type: 'DELETE_PATH_KEYFRAME', layerId, keyframeId: kfAtPlayhead.id });
            } else {
              const pts = displayPoints!;
              const ref = layer.pathKeyframes?.[0];
              const aligned = ref ? alignPointIds(pts, ref.points) : pts;
              const elData = getLiveElPoints();
              dispatch({ type: 'ADD_PATH_KEYFRAME', layerId, keyframe: { id: makeKfId(), time: currentTime, points: aligned, closed: elData?.closed ?? false, easing: DEFAULT_EASING, movedPointIds: selectedPointId ? [selectedPointId] : [] } });
            }
          }}
          style={{ marginRight: 8 }}
        >◆</button>
      </div>

      {/* Point type toggle */}
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

      {/* X / Y */}
      <div className="prop-row">
        <label className="prop-label" style={{ fontSize: 10 }}>X</label>
        <input className="prop-input" type="number" step={0.5}
          value={selectedPt.x.toFixed(2)}
          onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v)) updatePoint({ x: v, cpInX: v + (selectedPt.cpInX - selectedPt.x), cpOutX: v + (selectedPt.cpOutX - selectedPt.x) }); }} />
        <span className="prop-suffix">px</span>
      </div>
      <div className="prop-row">
        <label className="prop-label" style={{ fontSize: 10 }}>Y</label>
        <input className="prop-input" type="number" step={0.5}
          value={selectedPt.y.toFixed(2)}
          onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v)) updatePoint({ y: v, cpInY: v + (selectedPt.cpInY - selectedPt.y), cpOutY: v + (selectedPt.cpOutY - selectedPt.y) }); }} />
        <span className="prop-suffix">px</span>
      </div>

      {/* Handle controls if not corner */}
      {selectedPt.type !== 'corner' && (
        <>
          <div style={{ padding: '3px 8px', fontSize: 10, color: 'var(--text-muted)' }}>In handle</div>
          <div className="prop-row">
            <label className="prop-label" style={{ fontSize: 10 }}>X</label>
            <input className="prop-input" type="number" step={0.5}
              value={selectedPt.cpInX.toFixed(2)}
              onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v)) updatePoint({ cpInX: v }); }} />
          </div>
          <div className="prop-row">
            <label className="prop-label" style={{ fontSize: 10 }}>Y</label>
            <input className="prop-input" type="number" step={0.5}
              value={selectedPt.cpInY.toFixed(2)}
              onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v)) updatePoint({ cpInY: v }); }} />
          </div>
          <div style={{ padding: '3px 8px', fontSize: 10, color: 'var(--text-muted)' }}>Out handle</div>
          <div className="prop-row">
            <label className="prop-label" style={{ fontSize: 10 }}>X</label>
            <input className="prop-input" type="number" step={0.5}
              value={selectedPt.cpOutX.toFixed(2)}
              onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v)) updatePoint({ cpOutX: v }); }} />
          </div>
          <div className="prop-row">
            <label className="prop-label" style={{ fontSize: 10 }}>Y</label>
            <input className="prop-input" type="number" step={0.5}
              value={selectedPt.cpOutY.toFixed(2)}
              onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v)) updatePoint({ cpOutY: v }); }} />
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
    // Multi-selection
    return (
      <div className="selected-kf-section">
        <div className="selected-kf-title">Selected Keyframes</div>
        <div className="selected-kf-meta">{selectedKeyframes.length} keyframes selected</div>
        <div className="easing-direction-label">Easing (all selected)</div>
        <EasingPicker
          easing={
            // Use first selected KF's easing as representative
            (() => {
              const first = selectedKeyframes[0];
              const layer = state.layers.find((l) => l.id === first.layerId);
              const kf = layer?.tracks[first.property].find((k) => k.id === first.keyframeId);
              return kf?.easing ?? { type: 'preset' as const, name: 'ease' as const };
            })()
          }
          onChange={(easing: EasingConfig) => {
            dispatch({ type: 'SET_SELECTED_KFS_EASING', easing });
          }}
        />
        <button
          className="btn btn-danger"
          style={{ marginTop: 4, fontSize: 11, padding: '3px 8px' }}
          onClick={deleteSelectedKeyframes}
        >
          Delete All
        </button>
      </div>
    );
  }

  // Single selection
  const sel = selectedKeyframes[0];
  const layer = state.layers.find((l) => l.id === sel.layerId);
  if (!layer) return null;

  const kfs = [...layer.tracks[sel.property]].sort((a, b) => a.time - b.time);
  const kfIndex = kfs.findIndex((k) => k.id === sel.keyframeId);
  const kf = kfs[kfIndex];
  if (!kf) return null;

  const prevKf = kfIndex > 0 ? kfs[kfIndex - 1] : null;
  const nextKf = kfIndex < kfs.length - 1 ? kfs[kfIndex + 1] : null;

  return (
    <div className="selected-kf-section">
      <div className="selected-kf-title">Selected Keyframe</div>
      <div className="selected-kf-meta">
        {layer.label} · {PROPERTY_LABELS[sel.property]} · {kf.time.toFixed(2)}s
      </div>

      {/* Out easing (from this KF to next) */}
      {nextKf && (
        <div>
          <div className="easing-direction-label">&#8594; Out easing</div>
          <EasingPicker
            easing={kf.easing}
            onChange={(easing: EasingConfig) => {
              dispatch({
                type: 'UPDATE_PROPERTY_KEYFRAME',
                layerId: sel.layerId,
                property: sel.property,
                keyframeId: kf.id,
                easing,
              });
            }}
          />
        </div>
      )}

      {/* In easing (previous KF's easing into this one) */}
      {prevKf && (
        <div>
          <div className="easing-direction-label">&#8592; In easing</div>
          <EasingPicker
            easing={prevKf.easing}
            onChange={(easing: EasingConfig) => {
              dispatch({
                type: 'UPDATE_PROPERTY_KEYFRAME',
                layerId: sel.layerId,
                property: sel.property,
                keyframeId: prevKf.id,
                easing,
              });
            }}
          />
        </div>
      )}
    </div>
  );
}

// ─── Preset Animations ───────────────────────────────────────────────────────

type PresetTrack = { prop: AnimatableProperty; from: number; to: number };
interface PresetDef {
  label: string;
  tracks: PresetTrack[];
}

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
    const t0 = state.currentTime;
    const t1 = Math.min(state.duration, t0 + 0.5);

    for (const { prop, from, to } of preset.tracks) {
      const kf0: import('../types').PropertyKeyframe = {
        id: `kf-${Date.now()}-${Math.random().toString(36).slice(2)}-0`,
        time: t0,
        value: from,
        easing: { type: 'preset', name: 'ease-in-out' },
      };
      const kf1: import('../types').PropertyKeyframe = {
        id: `kf-${Date.now()}-${Math.random().toString(36).slice(2)}-1`,
        time: t1,
        value: to,
        easing: { type: 'preset', name: 'ease' },
      };
      dispatch({ type: 'ADD_PROPERTY_KEYFRAME', layerId, property: prop, keyframe: kf0 });
      dispatch({ type: 'ADD_PROPERTY_KEYFRAME', layerId, property: prop, keyframe: kf1 });
    }
  }

  return (
    <div className="prop-section">
      <div className="prop-section-title">Quick Animations</div>
      <div style={{ padding: '4px 8px', fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.4 }}>
        Applies 500ms animation from current time
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, padding: '4px 8px 8px' }}>
        {PRESETS.map((preset) => (
          <button
            key={preset.label}
            className="btn"
            style={{ fontSize: 10, padding: '4px 6px', textAlign: 'left' }}
            onClick={() => applyPreset(preset)}
          >
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

  // Determine the layer to show props for — prefer selected layer, but also
  // show if only keyframes are selected (find layer from first selected KF)
  let layer = state.layers.find((l) => l.id === state.selectedLayerId);
  if (!layer && state.selectedKeyframes.length > 0) {
    const firstSel = state.selectedKeyframes[0];
    layer = state.layers.find((l) => l.id === firstSel.layerId);
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

      {/* When an anchor point is selected show point properties, otherwise show normal props */}
      {isPathLike && pointSelected ? (
        <>
          <PathPointSection layerId={layer.id} />
          <SelectedKfSection />
        </>
      ) : (
        <>
      <div className="prop-hint" style={{ padding: '5px 10px', borderBottom: '1px solid var(--border)', fontSize: 10 }}>
        ◆ add/remove keyframe at playhead · ✕ delete selected
      </div>
      {PROP_GROUPS.map((group) => {
        if (group.pathLikeOnly && !PATH_LIKE_TAGS.has(layer!.tagName.toLowerCase())) return null;
        return (
          <div key={group.title} className="prop-section">
            <div className="prop-section-title">{group.title}</div>
            {group.props.map((p) => (
              <PropRow key={p.key} layerId={layer!.id} property={p.key}
                step={p.step} min={p.min} max={p.max} suffix={p.suffix} />
            ))}
          </div>
        );
      })}
      <div className="prop-section">
        <div className="prop-section-title">Colors</div>
        <ColorRow layerId={layer.id} property="fillColor" />
        <ColorRow layerId={layer.id} property="strokeColor" />
      </div>
      {layer.motionPathId && (
        <div className="prop-section">
          <div className="prop-section-title">Motion Path</div>
          <div style={{ padding: '4px 8px', fontSize: 11, color: 'var(--text-muted)' }}>
            Path: {state.motionPaths.find(p => p.id === layer.motionPathId)?.label ?? 'Unknown'}
          </div>
          <div className="prop-row" style={{ padding: '4px 8px' }}>
            <label className="prop-label">Auto-rotate</label>
            <input type="checkbox" checked={layer.autoRotate ?? false}
              onChange={(e) => dispatch({ type: 'SET_LAYER_AUTO_ROTATE', layerId: layer.id, autoRotate: e.target.checked })} />
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
