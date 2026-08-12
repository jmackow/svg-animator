import React, { useRef, useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { MagnetStraight } from '@phosphor-icons/react';
import { useApp } from '../context/AppContext';
import {
  AnimatableProperty, ALL_PROPERTIES, PROPERTY_LABELS, PropertyKeyframe,
  EasingConfig, DEFAULT_EASING, PROPERTY_DEFAULTS, SelectedKeyframe,
} from '../types';
import { interpolateProperty } from '../utils/interpolate';
import { curvePoints, easingLabel } from '../utils/easing';
import { EasingPicker } from './EasingPicker';

const TRACK_HEIGHT = 28;
const LAYER_HEADER_HEIGHT = 32;
const RULER_HEIGHT = 24;
const LEFT_GUTTER = 180;

// ─── Segment popover ──────────────────────────────────────────────────────────

interface SegmentPopoverData {
  layerId: string;
  property: AnimatableProperty;
  kf1Id: string;
  kf2Id: string;
  x: number;
  y: number;
}

interface PathSegmentPopoverData {
  layerId: string;
  kf1Id: string;
  x: number;
  y: number;
}

function SegmentPopover({ data, onClose }: { data: SegmentPopoverData; onClose: () => void }) {
  const { state, dispatch } = useApp();
  const ref = useRef<HTMLDivElement>(null);

  const layer = state.layers.find(l => l.id === data.layerId);
  const sorted = layer ? [...layer.tracks[data.property]].sort((a, b) => a.time - b.time) : [];
  const kf1 = sorted.find(k => k.id === data.kf1Id);
  const kf2 = sorted.find(k => k.id === data.kf2Id);

  const [rawDuration, setRawDuration] = useState(() =>
    kf1 && kf2 ? String(Math.round((kf2.time - kf1.time) * 1000)) : '0'
  );

  useEffect(() => {
    if (kf1 && kf2) setRawDuration(String(Math.round((kf2.time - kf1.time) * 1000)));
  }, [kf1?.time, kf2?.time]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    window.addEventListener('mousedown', handler, true);
    return () => window.removeEventListener('mousedown', handler, true);
  }, [onClose]);

  if (!layer || !kf1 || !kf2) return null;

  function commitDuration(ms: number) {
    if (!kf1) return;
    const newTime = Math.min(state.duration, kf1.time + Math.max(1, ms) / 1000);
    dispatch({ type: 'MOVE_PROPERTY_KEYFRAME', layerId: data.layerId, property: data.property, keyframeId: data.kf2Id, time: newTime });
  }

  return createPortal(
    <div
      ref={ref}
      className="segment-popover"
      style={{ position: 'fixed', left: data.x, top: data.y - 6, transform: 'translate(-50%, -100%)', zIndex: 9999 }}
      onMouseDown={e => e.stopPropagation()}
    >
      <div className="segment-popover-duration">
        <label className="segment-popover-label">Duration</label>
        <input
          className="prop-input"
          type="number"
          min={1}
          step={10}
          value={rawDuration}
          style={{ width: 68 }}
          onChange={e => setRawDuration(e.target.value)}
          onBlur={e => { const ms = parseInt(e.target.value); if (ms > 0) commitDuration(ms); }}
          onKeyDown={e => {
            if (e.key === 'Enter') { const ms = parseInt(rawDuration); if (ms > 0) commitDuration(ms); }
            e.stopPropagation();
          }}
        />
        <span className="segment-popover-unit">ms</span>
      </div>
      <EasingPicker
        easing={kf1.easing}
        alwaysOpen
        onChange={(easing: EasingConfig) => {
          dispatch({ type: 'UPDATE_PROPERTY_KEYFRAME', layerId: data.layerId, property: data.property, keyframeId: data.kf1Id, easing });
        }}
      />
    </div>,
    document.body
  );
}

function PathSegmentPopover({ data, onClose }: { data: PathSegmentPopoverData; onClose: () => void }) {
  const { state, dispatch } = useApp();
  const ref = useRef<HTMLDivElement>(null);

  const layer = state.layers.find(l => l.id === data.layerId);
  const kf1 = layer?.pathKeyframes?.find(k => k.id === data.kf1Id);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    window.addEventListener('mousedown', handler, true);
    return () => window.removeEventListener('mousedown', handler, true);
  }, [onClose]);

  if (!kf1) return null;

  return createPortal(
    <div
      ref={ref}
      className="segment-popover"
      style={{ position: 'fixed', left: data.x, top: data.y - 6, transform: 'translate(-50%, -100%)', zIndex: 9999 }}
      onMouseDown={e => e.stopPropagation()}
    >
      <EasingPicker
        easing={kf1.easing}
        alwaysOpen
        onChange={(easing: EasingConfig) => {
          dispatch({ type: 'UPDATE_PATH_KEYFRAME_EASING', layerId: data.layerId, keyframeId: data.kf1Id, easing });
        }}
      />
    </div>,
    document.body
  );
}

// ─── Marquee state ────────────────────────────────────────────────────────────

interface MarqueeState {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  active: boolean;
}

// ─── KF drag state ───────────────────────────────────────────────────────────

interface KfDragState {
  kfs: SelectedKeyframe[];
  startTimes: Map<string, number>;
  startMouseX: number;
}

export default function Timeline() {
  const { state, dispatch, togglePropertyKeyframe } = useApp();
  const timelineRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number>(0);
  const dragRef = useRef<KfDragState | null>(null);
  const [marquee, setMarquee] = useState<MarqueeState | null>(null);
  const [snapTarget, setSnapTarget] = useState<number | null>(null);
  const [segmentPopover, setSegmentPopover] = useState<SegmentPopoverData | null>(null);
  const [pathSegmentPopover, setPathSegmentPopover] = useState<PathSegmentPopoverData | null>(null);
  const [editingDurationKey, setEditingDurationKey] = useState<string | null>(null);

  const { zoom, duration, currentTime, isPlaying, loopPlayback, layers, snapEnabled, selectedKeyframes, selectedPathKfIds } = state;

  // ── Playback loop ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isPlaying) {
      cancelAnimationFrame(rafRef.current);
      return;
    }

    const startWall = performance.now();
    const startT = currentTime;

    function tick() {
      const elapsed = (performance.now() - startWall) / 1000;
      const newTime = startT + elapsed;
      if (newTime >= duration) {
        if (loopPlayback) {
          dispatch({ type: 'SET_TIME', time: newTime % duration });
          rafRef.current = requestAnimationFrame(tick);
        } else {
          dispatch({ type: 'SET_TIME', time: duration });
          dispatch({ type: 'SET_PLAYING', playing: false });
        }
        return;
      }
      dispatch({ type: 'SET_TIME', time: newTime });
      rafRef.current = requestAnimationFrame(tick);
    }

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [isPlaying]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Helpers ────────────────────────────────────────────────────────────────
  const xToTime = useCallback((x: number): number => {
    return Math.max(0, Math.min(duration, (x - LEFT_GUTTER) / zoom));
  }, [duration, zoom]);

  const clientXToTime = useCallback((clientX: number): number => {
    const timeline = timelineRef.current!;
    const rect = timeline.getBoundingClientRect();
    return xToTime(clientX - rect.left + timeline.scrollLeft);
  }, [xToTime]);

  // ── All KF times for snapping ─────────────────────────────────────────────
  const allKfTimes = useCallback((): number[] => {
    const times: number[] = [];
    for (const layer of layers) {
      for (const prop of ALL_PROPERTIES) {
        for (const kf of layer.tracks[prop]) {
          times.push(kf.time);
        }
      }
      for (const kf of layer.pathKeyframes ?? []) {
        times.push(kf.time);
      }
    }
    return times;
  }, [layers]);

  const snapTime = useCallback((t: number, excludeIds?: Set<string>): { time: number; snapped: boolean; snapTo: number | null } => {
    if (!snapEnabled) return { time: t, snapped: false, snapTo: null };
    const threshold = 8 / zoom;
    let best: number | null = null;
    let bestDist = threshold;

    for (const layer of layers) {
      for (const prop of ALL_PROPERTIES) {
        for (const kf of layer.tracks[prop]) {
          if (excludeIds?.has(kf.id)) continue;
          const dist = Math.abs(kf.time - t);
          if (dist < bestDist) { bestDist = dist; best = kf.time; }
        }
      }
      for (const kf of layer.pathKeyframes ?? []) {
        if (excludeIds?.has(kf.id)) continue;
        const dist = Math.abs(kf.time - t);
        if (dist < bestDist) { bestDist = dist; best = kf.time; }
      }
    }

    if (best !== null) {
      return { time: best, snapped: true, snapTo: best };
    }
    return { time: t, snapped: false, snapTo: null };
  }, [snapEnabled, zoom, layers]);

  // ── Playhead drag ──────────────────────────────────────────────────────────
  function startPlayheadDrag(e: React.MouseEvent) {
    e.preventDefault();
    dispatch({ type: 'SET_PLAYING', playing: false });

    function onMove(mv: MouseEvent) {
      const rawTime = clientXToTime(mv.clientX);
      const { time, snapTo } = snapTime(rawTime);
      setSnapTarget(snapTo);
      dispatch({ type: 'SET_TIME', time });
    }
    function onUp() {
      setSnapTarget(null);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    const rawTime = clientXToTime(e.clientX);
    const { time, snapTo } = snapTime(rawTime);
    setSnapTarget(snapTo);
    dispatch({ type: 'SET_TIME', time });
  }

  // ── Keyframe drag ──────────────────────────────────────────────────────────
  function startKfDrag(
    e: React.MouseEvent,
    layerId: string,
    property: AnimatableProperty,
    kf: PropertyKeyframe
  ) {
    e.preventDefault();
    e.stopPropagation();

    // Determine if this KF is in the selection
    const isInSelection = selectedKeyframes.some((s) => s.keyframeId === kf.id);

    let kfsToMove: SelectedKeyframe[];
    if (e.shiftKey) {
      // Shift+click: add to selection
      dispatch({ type: 'ADD_TO_KEYFRAME_SELECTION', kfs: [{ layerId, property, keyframeId: kf.id }] });
      kfsToMove = [...selectedKeyframes, { layerId, property, keyframeId: kf.id }];
    } else if (isInSelection) {
      // Drag all selected
      kfsToMove = selectedKeyframes;
    } else {
      // Select just this one
      dispatch({ type: 'SELECT_KEYFRAMES', kfs: [{ layerId, property, keyframeId: kf.id }] });
      kfsToMove = [{ layerId, property, keyframeId: kf.id }];
    }

    // Build startTimes map
    const startTimes = new Map<string, number>();
    for (const sel of kfsToMove) {
      const layer = layers.find((l) => l.id === sel.layerId);
      if (!layer) continue;
      const found = layer.tracks[sel.property].find((k) => k.id === sel.keyframeId);
      if (found) startTimes.set(sel.keyframeId, found.time);
    }

    dragRef.current = {
      kfs: kfsToMove,
      startTimes,
      startMouseX: e.clientX,
    };

    const excludeIds = new Set(kfsToMove.map((s) => s.keyframeId));

    function onMove(mv: MouseEvent) {
      const drag = dragRef.current;
      if (!drag) return;

      const timeline = timelineRef.current!;
      const rect = timeline.getBoundingClientRect();
      const pixelDelta = mv.clientX - drag.startMouseX;
      const timeDelta = pixelDelta / zoom;

      // Snap: compute proposed time for the dragged KF and snap it
      const proposedTime = (drag.startTimes.get(kf.id) ?? 0) + timeDelta;
      const { time: snappedTime, snapTo } = snapTime(proposedTime, excludeIds);
      setSnapTarget(snapTo);
      const snappedDelta = snappedTime - (drag.startTimes.get(kf.id) ?? 0);

      for (const sel of drag.kfs) {
        const startT = drag.startTimes.get(sel.keyframeId) ?? 0;
        const newTime = Math.max(0, Math.min(duration, startT + snappedDelta));
        dispatch({
          type: 'MOVE_PROPERTY_KEYFRAME_SILENT',
          layerId: sel.layerId,
          property: sel.property,
          keyframeId: sel.keyframeId,
          time: newTime,
        });
      }

      void rect; // suppress unused var
    }

    function onUp(mv: MouseEvent) {
      const drag = dragRef.current;
      dragRef.current = null;
      setSnapTarget(null);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);

      if (!drag) return;
      const pixelDelta = mv.clientX - drag.startMouseX;
      const timeDelta = pixelDelta / zoom;
      const proposedTime = (drag.startTimes.get(kf.id) ?? 0) + timeDelta;
      const excludeIds = new Set(drag.kfs.map((s) => s.keyframeId));
      const { time: snappedTime } = snapTime(proposedTime, excludeIds);
      const snappedDelta = snappedTime - (drag.startTimes.get(kf.id) ?? 0);

      for (const sel of drag.kfs) {
        const startT = drag.startTimes.get(sel.keyframeId) ?? 0;
        const newTime = Math.max(0, Math.min(duration, startT + snappedDelta));
        dispatch({
          type: 'MOVE_PROPERTY_KEYFRAME',
          layerId: sel.layerId,
          property: sel.property,
          keyframeId: sel.keyframeId,
          time: newTime,
        });
      }
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  // ── Path keyframe drag ────────────────────────────────────────────────────
  function startPathKfDrag(e: React.MouseEvent, layerId: string, kfId: string, kfTime: number) {
    e.preventDefault();
    e.stopPropagation();

    const isInSelection = selectedPathKfIds.includes(kfId);

    let kfIdsToMove: string[];
    if (e.shiftKey) {
      dispatch({ type: 'ADD_TO_PATH_KF_SELECTION', kfIds: [kfId] });
      kfIdsToMove = [...selectedPathKfIds, kfId];
    } else if (isInSelection) {
      kfIdsToMove = selectedPathKfIds;
    } else {
      dispatch({ type: 'SELECT_PATH_KEYFRAMES', kfIds: [kfId] });
      kfIdsToMove = [kfId];
    }
    dispatch({ type: 'SET_TIME', time: kfTime });

    // Map each kf id → { layerId, startTime } so we can apply a shared delta
    const startTimes = new Map<string, { lid: string; t: number }>();
    for (const id of kfIdsToMove) {
      for (const l of layers) {
        const kf = l.pathKeyframes?.find(k => k.id === id);
        if (kf) { startTimes.set(id, { lid: l.id, t: kf.time }); break; }
      }
    }

    const startMouseX = e.clientX;
    const excludeIds = new Set(kfIdsToMove);
    let moved = false;

    function computeDelta(clientX: number): number {
      const proposed = kfTime + (clientX - startMouseX) / zoom;
      const { time: snapped, snapTo } = snapTime(proposed, excludeIds);
      setSnapTarget(snapTo ?? null);
      return snapped - kfTime;
    }

    function onMove(mv: MouseEvent) {
      const pixelDelta = mv.clientX - startMouseX;
      if (!moved && Math.abs(pixelDelta) < 2) return;
      moved = true;
      const delta = computeDelta(mv.clientX);
      for (const [id, { lid, t }] of startTimes) {
        dispatch({ type: 'MOVE_PATH_KEYFRAME_SILENT', layerId: lid, keyframeId: id, time: Math.max(0, Math.min(duration, t + delta)) });
      }
    }
    function onUp(mv: MouseEvent) {
      setSnapTarget(null);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (!moved) return;
      const delta = computeDelta(mv.clientX);
      for (const [id, { lid, t }] of startTimes) {
        dispatch({ type: 'MOVE_PATH_KEYFRAME', layerId: lid, keyframeId: id, time: Math.max(0, Math.min(duration, t + delta)) });
      }
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  // ── Marquee drag select ────────────────────────────────────────────────────
  function startMarqueeDrag(e: React.MouseEvent) {
    const target = e.target as HTMLElement;
    if (target.closest('button, .keyframe-diamond')) return;
    e.preventDefault();

    const timeline = timelineRef.current!;
    const rect = timeline.getBoundingClientRect();

    const startX = e.clientX - rect.left + timeline.scrollLeft;
    const startY = e.clientY - rect.top + timeline.scrollTop;

    setMarquee({ startX, startY, currentX: startX, currentY: startY, active: true });

    let mouseX = e.clientX;
    let mouseY = e.clientY;
    let scrollSpeed = 0;
    let rafId: number | null = null;

    const SCROLL_ZONE = 40;
    const MAX_SPEED = 10;

    function updateMarquee() {
      const cx = mouseX - rect.left + timeline.scrollLeft;
      const cy = mouseY - rect.top + timeline.scrollTop;
      setMarquee({ startX, startY, currentX: cx, currentY: cy, active: true });
    }

    function scrollTick() {
      if (scrollSpeed !== 0) {
        timeline.scrollTop = Math.max(0, timeline.scrollTop + scrollSpeed);
        updateMarquee();
        rafId = requestAnimationFrame(scrollTick);
      } else {
        rafId = null;
      }
    }

    function onMove(mv: MouseEvent) {
      mouseX = mv.clientX;
      mouseY = mv.clientY;

      const relY = mv.clientY - rect.top;
      const h = rect.height;
      const clamped = Math.max(0, Math.min(h, relY));

      if (clamped < SCROLL_ZONE) {
        scrollSpeed = -MAX_SPEED * (1 - clamped / SCROLL_ZONE);
      } else if (clamped > h - SCROLL_ZONE) {
        scrollSpeed = MAX_SPEED * ((clamped - (h - SCROLL_ZONE)) / SCROLL_ZONE);
      } else {
        scrollSpeed = 0;
      }

      if (scrollSpeed !== 0 && rafId === null) {
        rafId = requestAnimationFrame(scrollTick);
      }

      updateMarquee();
    }

    function onUp(mv: MouseEvent) {
      scrollSpeed = 0;
      if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }

      const endX = mv.clientX - rect.left + timeline.scrollLeft;
      const endY = mv.clientY - rect.top + timeline.scrollTop;

      const minTime = xToTime(Math.min(startX, endX));
      const maxTime = xToTime(Math.max(startX, endX));
      const minY = Math.min(startY, endY);
      const maxY = Math.max(startY, endY);

      // Only select if it was a real drag (not a click)
      if (Math.abs(endX - startX) > 4 || Math.abs(endY - startY) > 4) {
        const selected: SelectedKeyframe[] = [];
        const selectedPathIds: string[] = [];
        let rowY = 0;

        for (const layer of visibleTimelineLayers) {
          rowY += LAYER_HEADER_HEIGHT;
          if (layer.expanded || state.selectedLayerId === layer.id) {
            for (const prop of ALL_PROPERTIES) {
              if (layer.tracks[prop].length > 0) {
                const rowCenter = rowY + TRACK_HEIGHT / 2;
                if (rowCenter >= minY && rowCenter <= maxY) {
                  for (const kf of layer.tracks[prop]) {
                    if (kf.time >= minTime && kf.time <= maxTime) {
                      selected.push({ layerId: layer.id, property: prop, keyframeId: kf.id });
                    }
                  }
                }
                rowY += TRACK_HEIGHT;
              }
            }
            // Path keyframe rows
            if ((layer.pathKeyframes?.length ?? 0) > 0) {
              for (const pt of layer.pathKeyframes![0].points) {
                const ptKfs = layer.pathKeyframes!.filter(kf => kf.movedPointIds?.includes(pt.id));
                if (ptKfs.length === 0) continue;
                const rowCenter = rowY + TRACK_HEIGHT / 2;
                if (rowCenter >= minY && rowCenter <= maxY) {
                  for (const kf of ptKfs) {
                    if (kf.time >= minTime && kf.time <= maxTime) {
                      selectedPathIds.push(kf.id);
                    }
                  }
                }
                rowY += TRACK_HEIGHT;
              }
            }
          }
        }

        if (selected.length > 0) dispatch({ type: 'SELECT_KEYFRAMES', kfs: selected });
        if (selectedPathIds.length > 0) dispatch({ type: 'SELECT_PATH_KEYFRAMES', kfIds: [...new Set(selectedPathIds)] });
      }

      setMarquee(null);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    }

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  // ── Double-click track to add keyframe ────────────────────────────────────
  function handleTrackDoubleClick(
    e: React.MouseEvent,
    layerId: string,
    property: AnimatableProperty
  ) {
    const layer = layers.find((l) => l.id === layerId);
    if (!layer || layer.locked) return;

    const t = clientXToTime(e.clientX);
    const exists = layer.tracks[property].some((kf) => Math.abs(kf.time - t) < 0.05);
    if (exists) return;

    const value = interpolateProperty(layer.tracks[property], t, PROPERTY_DEFAULTS[property]);
    const newKf: PropertyKeyframe = {
      id: `kf-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      time: t,
      value,
      easing: DEFAULT_EASING,
    };
    dispatch({ type: 'SET_TIME', time: t });
    dispatch({ type: 'ADD_PROPERTY_KEYFRAME', layerId, property, keyframe: newKf });
    dispatch({ type: 'SELECT_KEYFRAMES', kfs: [{ layerId, property, keyframeId: newKf.id }] });
  }

  // ── Zoom ──────────────────────────────────────────────────────────────────
  function handleWheel(e: React.WheelEvent) {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      dispatch({ type: 'SET_ZOOM', zoom: zoom * (e.deltaY < 0 ? 1.1 : 0.9) });
    }
  }

  // ── Ruler ─────────────────────────────────────────────────────────────────
  function renderRuler() {
    const ticks: React.ReactNode[] = [];
    const minorStep = zoom >= 100 ? 0.1 : zoom >= 50 ? 0.5 : 1;
    const count = Math.ceil(duration / minorStep);

    for (let i = 0; i <= count; i++) {
      const t = i * minorStep;
      if (t > duration + 0.001) break;
      const x = t * zoom;
      const isMajor = Math.round(t * 10) % 10 === 0;
      ticks.push(
        <div
          key={i}
          className={`ruler-tick ${isMajor ? 'ruler-tick--major' : ''}`}
          style={{ left: LEFT_GUTTER + x }}
        >
          {isMajor && <span className="ruler-label">{t.toFixed(1)}s</span>}
        </div>
      );
    }

    return (
      <div
        className="timeline-ruler"
        style={{ minWidth: LEFT_GUTTER + duration * zoom + 40, display: 'flex', alignItems: 'center' }}
        onMouseDown={startPlayheadDrag}
      >
        {/* Snap toggle button */}
        <div
          style={{ position: 'absolute', left: 4, top: '50%', transform: 'translateY(-50%)', zIndex: 11 }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            className={`snap-btn ${snapEnabled ? 'snap-btn--active' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              dispatch({ type: 'TOGGLE_SNAP' });
            }}
            title={snapEnabled ? 'Snap on' : 'Snap off'}
          >
            <MagnetStraight size={13} weight="fill" /> Snap
          </button>
        </div>
        {ticks}
        {/* Playhead — lives on the ruler so it never scrolls away */}
        <div
          className="playhead"
          style={{ left: playheadX, overflow: 'visible', height: '100vh' }}
          onMouseDown={startPlayheadDrag}
        />
      </div>
    );
  }

  // ── Property track row ────────────────────────────────────────────────────
  function renderPropertyTrack(layerId: string, property: AnimatableProperty) {
    const layer = layers.find((l) => l.id === layerId)!;
    const kfs = layer.tracks[property];
    const sorted = [...kfs].sort((a, b) => a.time - b.time);

    return (
      <div
        key={`${layerId}-${property}`}
        className="timeline-track timeline-track--property"
        style={{ height: TRACK_HEIGHT }}
        onDoubleClick={(e) => handleTrackDoubleClick(e, layerId, property)}
      >
        {/* Gutter */}
        <div className="track-label track-label--property" style={{ width: LEFT_GUTTER }}>
          <button
            className={`kf-toggle-btn ${kfs.some((kf) => Math.abs(kf.time - currentTime) < 0.001) ? 'kf-toggle-btn--active' : ''}`}
            style={{ marginRight: 4, fontSize: 9 }}
            title="Toggle keyframe at current time"
            onClick={(e) => {
              e.stopPropagation();
              togglePropertyKeyframe(layerId, property);
            }}
          >
            ◆
          </button>
          <span className="track-prop-name">{PROPERTY_LABELS[property]}</span>
        </div>

        {/* Track area */}
        <div className="track-area" style={{ position: 'relative' }}>
          {/* Easing curves between keyframes — no straight line, curve only */}
          {sorted.slice(0, -1).map((kf1, i) => {
            const kf2 = sorted[i + 1];
            const x1 = kf1.time * zoom;
            const x2 = kf2.time * zoom;
            const gapWidth = x2 - x1;
            if (gapWidth <= 0) return null;
            return (
              <svg
                key={kf1.id + '-curve'}
                style={{
                  position: 'absolute',
                  left: x1 + 4,
                  top: (TRACK_HEIGHT - (TRACK_HEIGHT - 10)) / 2,
                  width: Math.max(1, gapWidth - 8),
                  height: TRACK_HEIGHT - 10,
                  overflow: 'visible',
                  pointerEvents: 'none',
                  zIndex: 1,
                }}
              >
                <polyline
                  points={curvePoints(kf1.easing, Math.max(1, gapWidth - 8), TRACK_HEIGHT - 10, 30)}
                  fill="none"
                  stroke="rgba(245,197,66,0.6)"
                  strokeWidth={1.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            );
          })}

          {/* Segment pills — duration + easing label */}
          {sorted.slice(0, -1).map((kf1, i) => {
            const kf2 = sorted[i + 1];
            const x1 = kf1.time * zoom;
            const x2 = kf2.time * zoom;
            const gapWidth = x2 - x1;
            if (gapWidth < 80) return null;
            const durMs = Math.round((kf2.time - kf1.time) * 1000);
            const label = easingLabel(kf1.easing);
            const isOpen = segmentPopover?.kf1Id === kf1.id && segmentPopover?.kf2Id === kf2.id;
            const isEditingDur = editingDurationKey === kf1.id;

            function commitDuration(ms: number) {
              if (ms > 0) {
                const newTime = Math.min(duration, kf1.time + ms / 1000);
                dispatch({ type: 'MOVE_PROPERTY_KEYFRAME', layerId, property, keyframeId: kf2.id, time: newTime });
              }
              setEditingDurationKey(null);
            }

            return (
              <div
                key={kf1.id + '-pill'}
                className={`kf-segment-pill${isOpen ? ' kf-segment-pill--open' : ''}`}
                style={{ left: x1 + gapWidth / 2, top: '50%', transform: 'translate(-50%, -50%)' }}
                onMouseDown={(e) => e.stopPropagation()}
              >
                {/* Easing label — opens the easing popover */}
                <span
                  className="kf-segment-pill-easing"
                  onClick={(e) => {
                    e.stopPropagation();
                    const pill = (e.currentTarget as HTMLElement).closest('.kf-segment-pill') as HTMLElement;
                    const rect = pill.getBoundingClientRect();
                    setSegmentPopover(isOpen ? null : { layerId, property, kf1Id: kf1.id, kf2Id: kf2.id, x: rect.left + rect.width / 2, y: rect.top });
                  }}
                >
                  {label}
                </span>

                {/* Duration — click to edit inline */}
                {isEditingDur ? (
                  <>
                    <input
                      className="kf-segment-duration-input"
                      type="number"
                      min={1}
                      step={10}
                      defaultValue={durMs}
                      style={{ width: `${String(durMs).length + 0.5}ch` }}
                      ref={(el) => { if (el) el.select(); }}
                      onClick={(e) => e.stopPropagation()}
                      onBlur={(e) => commitDuration(parseInt(e.target.value))}
                      onKeyDown={(e) => {
                        e.stopPropagation();
                        if (e.key === 'Enter') commitDuration(parseInt((e.target as HTMLInputElement).value));
                        if (e.key === 'Escape') setEditingDurationKey(null);
                      }}
                    />
                    <span className="kf-segment-pill-duration">ms</span>
                  </>
                ) : (
                  <span
                    className="kf-segment-pill-duration"
                    title="Click to edit duration"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSegmentPopover(null);
                      setEditingDurationKey(kf1.id);
                    }}
                  >
                    {durMs}ms
                  </span>
                )}
              </div>
            );
          })}

          {/* Keyframe diamonds */}
          {kfs.map((kf) => {
            const isSelected = selectedKeyframes.some(
              (s) => s.layerId === layerId && s.property === property && s.keyframeId === kf.id
            );
            return (
              <div
                key={kf.id}
                className={`keyframe-diamond ${isSelected ? 'keyframe-diamond--selected' : ''}`}
                style={{ left: kf.time * zoom }}
                onMouseDown={(e) => startKfDrag(e, layerId, property, kf)}
                onClick={(e) => {
                  e.stopPropagation();
                  dispatch({ type: 'SET_TIME', time: kf.time });
                  if (!e.shiftKey) {
                    dispatch({ type: 'SELECT_KEYFRAMES', kfs: [{ layerId, property, keyframeId: kf.id }] });
                  }
                }}
                title={`${PROPERTY_LABELS[property]} = ${kf.value.toFixed(2)} @ ${kf.time.toFixed(2)}s`}
              />
            );
          })}
        </div>
      </div>
    );
  }

  // ── Collect a layer's own KF times (ghost diamonds on the collapsed header) ──
  function collectLayerKfTimesMs(layerId: string): Set<number> {
    const times = new Set<number>();
    const layer = layers.find(l => l.id === layerId);
    if (!layer) return times;
    for (const prop of ALL_PROPERTIES) {
      for (const kf of layer.tracks[prop]) times.add(Math.round(kf.time * 1000));
    }
    for (const kf of layer.pathKeyframes ?? []) times.add(Math.round(kf.time * 1000));
    return times;
  }

  // ── Visible layers for timeline: those with at least one keyframe ─────────
  const visibleTimelineLayers = layers.filter(
    (layer) =>
      ALL_PROPERTIES.some((p) => layer.tracks[p].length >= 1) ||
      (layer.pathKeyframes?.length ?? 0) >= 1
  );

  const totalWidth = LEFT_GUTTER + duration * zoom + 40;
  const playheadX = LEFT_GUTTER + currentTime * zoom;

  // Compute marquee rect for rendering
  const marqueeRect = marquee
    ? {
        left: Math.min(marquee.startX, marquee.currentX),
        top: Math.min(marquee.startY, marquee.currentY),
        width: Math.abs(marquee.currentX - marquee.startX),
        height: Math.abs(marquee.currentY - marquee.startY),
      }
    : null;

  // Snap indicator position
  const snapIndicatorLeft = snapTarget !== null ? LEFT_GUTTER + snapTarget * zoom : null;

  return (
    <div className="timeline-panel" onWheel={handleWheel}>
      {segmentPopover && (
        <SegmentPopover data={segmentPopover} onClose={() => setSegmentPopover(null)} />
      )}
      {pathSegmentPopover && (
        <PathSegmentPopover data={pathSegmentPopover} onClose={() => setPathSegmentPopover(null)} />
      )}
      {renderRuler()}

      <div className="timeline-body" ref={timelineRef} style={{ overflow: 'auto', flex: 1 }} onMouseDown={startMarqueeDrag}>
      <div className="timeline-tracks" style={{ width: totalWidth, position: 'relative' }}>
        {/* Marquee selection rect */}
        {marqueeRect && marqueeRect.width > 2 && (
          <div
            className="timeline-marquee"
            style={{
              left: marqueeRect.left,
              top: marqueeRect.top,
              width: marqueeRect.width,
              height: marqueeRect.height,
            }}
          />
        )}

        {layers.length === 0 ? (
          <div className="panel-empty" style={{ paddingLeft: LEFT_GUTTER + 8 }}>
            No layers yet
          </div>
        ) : visibleTimelineLayers.length === 0 ? (
          <div className="panel-empty" style={{ paddingLeft: LEFT_GUTTER + 8 }}>
            No animated layers
          </div>
        ) : (
          visibleTimelineLayers.map((layer) => {
            const isSelectedLayer = state.selectedLayerId === layer.id;
            const hasAnyKf = ALL_PROPERTIES.some((p) => layer.tracks[p].length > 0);

            return (
              <React.Fragment key={layer.id}>
                {/* Layer header row */}
                <div
                  className={`timeline-track timeline-track--header ${isSelectedLayer ? 'timeline-track--selected' : ''}`}
                  style={{ height: LAYER_HEADER_HEIGHT }}
                  onClick={() => dispatch({ type: 'SELECT_LAYER', layerId: layer.id })}
                >
                  <div className="track-label" style={{ width: LEFT_GUTTER, paddingLeft: 4 }}>
                    <button
                      className="icon-btn expand-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        dispatch({ type: 'TOGGLE_LAYER_EXPANDED', layerId: layer.id });
                      }}
                      title={layer.expanded ? 'Collapse' : 'Expand'}
                    >
                      {layer.expanded ? '▾' : '▸'}
                    </button>
                    <span className="layer-tag" style={{ fontSize: 9 }}>{layer.tagName}</span>
                    <span className="track-name">{layer.label}</span>
                    {hasAnyKf && <span className="track-kf-dot" title="Has keyframes" />}
                  </div>
                  <div className="track-area track-area--header" style={{ position: 'relative' }}>
                    {Array.from(collectLayerKfTimesMs(layer.id)).map(ms => (
                      <div
                        key={ms}
                        className="keyframe-diamond keyframe-diamond--ghost"
                        style={{ left: (ms / 1000) * zoom, pointerEvents: 'none' }}
                      />
                    ))}
                  </div>
                </div>

                {/* Property tracks — only for properties that have keyframes */}
                {layer.expanded &&
                  ALL_PROPERTIES
                    .filter((property) => layer.tracks[property].length > 0)
                    .map((property) => renderPropertyTrack(layer.id, property))}

                {/* Shape tracks — one row per point (only points with explicit moves) */}
                {layer.expanded && (layer.pathKeyframes?.length ?? 0) > 0 && (<>
                  {layer.pathKeyframes![0].points.map((pt, ptIdx) => {
                    const ptKfs = [...layer.pathKeyframes!.filter(kf => kf.movedPointIds?.includes(pt.id))].sort((a, b) => a.time - b.time);
                    if (ptKfs.length === 0) return null;
                    return (
                      <div
                        key={`${layer.id}-pt-${pt.id}`}
                        className="timeline-track timeline-track--property"
                        style={{ height: TRACK_HEIGHT }}
                      >
                        <div className="track-label track-label--property" style={{ width: LEFT_GUTTER }}>
                          <span className="track-prop-name">Pt {ptIdx + 1}</span>
                        </div>
                        <div className="track-area" style={{ position: 'relative' }}>
                          {/* Easing curves between consecutive keyframes */}
                          {ptKfs.slice(0, -1).map((kf1, i) => {
                            const kf2 = ptKfs[i + 1];
                            const x1 = kf1.time * zoom;
                            const x2 = kf2.time * zoom;
                            const gapWidth = x2 - x1;
                            if (gapWidth <= 0) return null;
                            return (
                              <svg
                                key={kf1.id + '-curve'}
                                style={{ position: 'absolute', left: x1 + 4, top: (TRACK_HEIGHT - (TRACK_HEIGHT - 10)) / 2, width: Math.max(1, gapWidth - 8), height: TRACK_HEIGHT - 10, overflow: 'visible', pointerEvents: 'none', zIndex: 1 }}
                              >
                                <polyline
                                  points={curvePoints(kf1.easing, Math.max(1, gapWidth - 8), TRACK_HEIGHT - 10, 30)}
                                  fill="none" stroke="rgba(124,108,247,0.6)" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"
                                />
                              </svg>
                            );
                          })}

                          {/* Segment pills between consecutive keyframes */}
                          {ptKfs.slice(0, -1).map((kf1, i) => {
                            const kf2 = ptKfs[i + 1];
                            const x1 = kf1.time * zoom;
                            const x2 = kf2.time * zoom;
                            const gapWidth = x2 - x1;
                            if (gapWidth < 80) return null;
                            const isOpen = pathSegmentPopover?.kf1Id === kf1.id;
                            return (
                              <div
                                key={kf1.id + '-pill'}
                                className={`kf-segment-pill${isOpen ? ' kf-segment-pill--open' : ''}`}
                                style={{ left: x1 + gapWidth / 2, top: '50%', transform: 'translate(-50%, -50%)' }}
                                onMouseDown={(e) => e.stopPropagation()}
                              >
                                <span
                                  className="kf-segment-pill-easing"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const pill = (e.currentTarget as HTMLElement).closest('.kf-segment-pill') as HTMLElement;
                                    const rect = pill.getBoundingClientRect();
                                    setPathSegmentPopover(isOpen ? null : { layerId: layer.id, kf1Id: kf1.id, x: rect.left + rect.width / 2, y: rect.top });
                                  }}
                                >
                                  {easingLabel(kf1.easing)}
                                </span>
                              </div>
                            );
                          })}

                          {/* Keyframe diamonds */}
                          {ptKfs.map(kf => {
                            const isSelected = selectedPathKfIds.includes(kf.id);
                            return (
                              <div
                                key={kf.id}
                                className={`keyframe-diamond ${isSelected ? 'keyframe-diamond--selected' : ''}`}
                                style={{ left: kf.time * zoom, background: isSelected ? '#a89ff7' : '#7c6cf7' }}
                                title={`Pt ${ptIdx + 1} @ ${kf.time.toFixed(2)}s`}
                                onMouseDown={(e) => startPathKfDrag(e, layer.id, kf.id, kf.time)}
                                onClick={(e) => e.stopPropagation()}
                              />
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </>)}
              </React.Fragment>
            );
          })
        )}
      </div>

      {/* Snap indicator line */}
      {snapIndicatorLeft !== null && (
        <div
          className="snap-indicator"
          style={{ left: snapIndicatorLeft, height: '100%' }}
        />
      )}

      </div>
    </div>
  );
}
