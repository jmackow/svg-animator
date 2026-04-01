import React, { useRef, useEffect, useState, useCallback } from 'react';
import { MagnetStraight } from '@phosphor-icons/react';
import { useApp } from '../context/AppContext';
import {
  AnimatableProperty, ALL_PROPERTIES, PROPERTY_LABELS, PropertyKeyframe,
  DEFAULT_EASING, PROPERTY_DEFAULTS, SelectedKeyframe,
} from '../types';
import { interpolateProperty } from '../utils/interpolate';
import { curvePoints } from '../utils/easing';

const TRACK_HEIGHT = 28;
const LAYER_HEADER_HEIGHT = 32;
const RULER_HEIGHT = 24;
const LEFT_GUTTER = 180;

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

  const { zoom, duration, currentTime, isPlaying, loopPlayback, layers, snapEnabled, selectedKeyframes } = state;

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
          if (dist < bestDist) {
            bestDist = dist;
            best = kf.time;
          }
        }
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

  // ── Marquee drag select ────────────────────────────────────────────────────
  function startMarqueeDrag(e: React.MouseEvent<HTMLDivElement>, trackAreaTopY: number) {
    // Only start if not on a diamond
    if ((e.target as HTMLElement).classList.contains('keyframe-diamond')) return;
    e.preventDefault();

    const timeline = timelineRef.current!;
    const rect = timeline.getBoundingClientRect();

    const startX = e.clientX - rect.left + timeline.scrollLeft;
    const startY = e.clientY - rect.top + timeline.scrollTop;

    setMarquee({ startX, startY, currentX: startX, currentY: startY, active: true });

    function onMove(mv: MouseEvent) {
      const currentX = mv.clientX - rect.left + timeline.scrollLeft;
      const currentY = mv.clientY - rect.top + timeline.scrollTop;
      setMarquee({ startX, startY, currentX, currentY, active: true });
    }

    function onUp(mv: MouseEvent) {
      const endX = mv.clientX - rect.left + timeline.scrollLeft;
      const endY = mv.clientY - rect.top + timeline.scrollTop;

      const minTime = xToTime(Math.min(startX, endX));
      const maxTime = xToTime(Math.max(startX, endX));
      const minY = Math.min(startY, endY);
      const maxY = Math.max(startY, endY);

      // Only select if it was a real drag (not a click)
      if (Math.abs(endX - startX) > 4 || Math.abs(endY - startY) > 4) {
        // Find all KFs whose time falls in [minTime, maxTime] and whose row is in [minY, maxY]
        const selected: SelectedKeyframe[] = [];
        let rowY = RULER_HEIGHT;

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
          }
        }

        if (selected.length > 0) {
          dispatch({ type: 'SELECT_KEYFRAMES', kfs: selected });
        }
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
        onMouseDown={(e) => startMarqueeDrag(e, 0)}
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

        {/* Track area SVG for easing curves */}
        <div className="track-area" style={{ position: 'relative' }}>
          {/* Connecting lines + easing curves in SVG */}
          <svg
            style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', overflow: 'visible', pointerEvents: 'none' }}
          >
            {sorted.length > 1 &&
              sorted.slice(0, -1).map((kf1, i) => {
                const kf2 = sorted[i + 1];
                const x1 = kf1.time * zoom;
                const x2 = kf2.time * zoom;
                const gapWidth = x2 - x1;
                const midY = TRACK_HEIGHT / 2;

                return (
                  <g key={kf1.id + '-segment'}>
                    {/* Connecting line */}
                    <line
                      x1={x1} y1={midY}
                      x2={x2} y2={midY}
                      stroke="rgba(245,197,66,0.3)"
                      strokeWidth={2}
                    />
                    {/* Easing curve preview if gap is wide enough */}
                    {gapWidth > 50 && (
                      <g
                        transform={`translate(${x1 + 4}, ${(TRACK_HEIGHT - (TRACK_HEIGHT - 10)) / 2})`}
                        style={{ pointerEvents: 'all' }}
                        onClick={(e) => {
                          e.stopPropagation();
                          dispatch({ type: 'SELECT_KEYFRAMES', kfs: [{ layerId, property, keyframeId: kf1.id }] });
                        }}
                      >
                        <rect
                          x={0} y={0}
                          width={gapWidth - 8}
                          height={TRACK_HEIGHT - 10}
                          fill="transparent"
                          style={{ cursor: 'pointer' }}
                        />
                        <polyline
                          points={curvePoints(kf1.easing, gapWidth - 8, TRACK_HEIGHT - 10, 30)}
                          fill="none"
                          stroke="rgba(245,197,66,0.5)"
                          strokeWidth={1.5}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          style={{ pointerEvents: 'none' }}
                        />
                      </g>
                    )}
                  </g>
                );
              })}
          </svg>

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

  // ── Visible layers for timeline ───────────────────────────────────────────
  // A layer is "animated" if it has ≥1 keyframe, or is a group with animated descendants
  function hasAnimatedContent(layerId: string): boolean {
    const layer = layers.find((l) => l.id === layerId);
    if (!layer) return false;
    if (ALL_PROPERTIES.some((p) => layer.tracks[p].length >= 1)) return true;
    return layers.some((l) => l.parentId === layerId && hasAnimatedContent(l.id));
  }

  // Layers to show in timeline: animated, and all ancestors are expanded
  const visibleTimelineLayers = layers.filter((layer) => {
    if (!hasAnimatedContent(layer.id)) return false;
    let pid = layer.parentId;
    while (pid) {
      const parent = layers.find((l) => l.id === pid);
      if (!parent) break;
      if (!parent.expanded) return false;
      pid = parent.parentId;
    }
    return true;
  });

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
    <div className="timeline-panel" onWheel={handleWheel} ref={timelineRef}>
      {renderRuler()}

      <div className="timeline-tracks" style={{ width: totalWidth, position: 'relative' }}>
        {/* Marquee selection rect */}
        {marqueeRect && marqueeRect.width > 2 && (
          <div
            className="timeline-marquee"
            style={{
              left: marqueeRect.left,
              top: marqueeRect.top - RULER_HEIGHT,
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
            const isGroup = layer.tagName.toLowerCase() === 'g';
            const hasChildren = layers.some((l) => l.parentId === layer.id);
            // Depth for indentation
            let depth = 0;
            let pid = layer.parentId;
            while (pid) {
              const parent = layers.find((l) => l.id === pid);
              if (!parent) break;
              depth++;
              pid = parent.parentId;
            }

            return (
              <React.Fragment key={layer.id}>
                {/* Layer header row */}
                <div
                  className={`timeline-track timeline-track--header ${isSelectedLayer ? 'timeline-track--selected' : ''}`}
                  style={{ height: LAYER_HEADER_HEIGHT }}
                  onClick={() => dispatch({ type: 'SELECT_LAYER', layerId: layer.id })}
                >
                  <div className="track-label" style={{ width: LEFT_GUTTER, paddingLeft: 4 + depth * 10 }}>
                    {isGroup && hasChildren ? (
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
                    ) : (
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
                    )}
                    <span className="layer-tag" style={{ fontSize: 9 }}>{layer.tagName}</span>
                    <span className="track-name">{layer.label}</span>
                    {hasAnyKf && <span className="track-kf-dot" title="Has keyframes" />}
                  </div>
                  <div className="track-area track-area--header" />
                </div>

                {/* Property tracks — only for properties that have keyframes */}
                {(layer.expanded || isSelectedLayer) &&
                  ALL_PROPERTIES
                    .filter((property) => layer.tracks[property].length > 0)
                    .map((property) => renderPropertyTrack(layer.id, property))}
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

      {/* Playhead */}
      <div
        className="playhead"
        style={{ left: playheadX }}
        onMouseDown={startPlayheadDrag}
      />
    </div>
  );
}
