import React, { useRef, useState } from 'react';
import { ArrowCounterClockwise, ArrowClockwise } from '@phosphor-icons/react';
import { useApp } from '../context/AppContext';
import ThemePicker from './ThemePicker';
import { parseSvgLayers } from '../utils/svgParser';
import { exportAnimatedSvg, downloadSvg, extractProjectMetadata } from '../utils/exporter';

export default function Toolbar() {
  const { state, dispatch, canUndo, canRedo } = useApp();
  const fileRef = useRef<HTMLInputElement>(null);
  const [canvasW, setCanvasW] = useState(String(state.canvasWidth));
  const [canvasH, setCanvasH] = useState(String(state.canvasHeight));
  const [duration, setDuration] = useState(String(state.duration));
  const loop: 'none' | 'infinite' = state.loopPlayback ? 'infinite' : 'none';
  function setLoop(l: 'none' | 'infinite') { dispatch({ type: 'SET_LOOP_PLAYBACK', loop: l === 'infinite' }); }

  function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      try {
        const saved = extractProjectMetadata(text);
        if (saved) {
          dispatch({
            type: 'LOAD_PROJECT',
            svgSource: text,
            layers: saved.layers,
            duration: saved.duration,
            canvasWidth: saved.canvasWidth,
            canvasHeight: saved.canvasHeight,
            motionPaths: saved.motionPaths ?? [],
          });
          setDuration(String(saved.duration));
          setCanvasW(String(saved.canvasWidth));
          setCanvasH(String(saved.canvasHeight));
        } else {
          const { layers, source } = parseSvgLayers(text);
          dispatch({ type: 'LOAD_SVG', svgSource: source, layers });
        }
      } catch {
        alert('Failed to parse SVG file.');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  function handlePlayPause() {
    if (state.isPlaying) {
      dispatch({ type: 'SET_PLAYING', playing: false });
    } else {
      if (state.currentTime >= state.duration) {
        dispatch({ type: 'SET_TIME', time: 0 });
      }
      dispatch({ type: 'SET_PLAYING', playing: true });
    }
  }

  function handleStop() {
    dispatch({ type: 'SET_PLAYING', playing: false });
    dispatch({ type: 'SET_TIME', time: 0 });
  }

  function handleExport() {
    if (!state.svgSource) return;

    // Compute motion path origin adjustments from the live SVG DOM
    const motionAdjustments = new Map<string, { x: number; y: number }>();
    const liveSvg = document.querySelector('.svg-host svg') as SVGSVGElement | null;
    if (liveSvg) {
      for (const layer of state.layers) {
        if (!layer.motionPathId) continue;
        const mp = state.motionPaths.find(p => p.id === layer.motionPathId);
        if (!mp?.d) continue;
        const pathStartMatch = mp.d.match(/[Mm]\s*([-\d.]+)[,\s]+([-\d.]+)/);
        if (!pathStartMatch) continue;
        const psX = parseFloat(pathStartMatch[1]);
        const psY = parseFloat(pathStartMatch[2]);
        const el = liveSvg.getElementById(layer.elementId) as SVGGraphicsElement | null;
        if (!el) continue;
        try {
          const bbox = el.getBBox();
          const ax = layer.anchorX ?? 0;
          const ay = layer.anchorY ?? 0;
          const cx = bbox.x + bbox.width / 2 + ax;
          const cy = bbox.y + bbox.height / 2 + ay;
          motionAdjustments.set(layer.id, { x: cx - psX, y: cy - psY });
        } catch { /* skip */ }
      }
    }

    const svg = exportAnimatedSvg(
      state.svgSource,
      state.layers,
      state.duration,
      {
        version: 1,
        layers: state.layers,
        duration: state.duration,
        canvasWidth: state.canvasWidth,
        canvasHeight: state.canvasHeight,
        motionPaths: state.motionPaths,
      },
      state.motionPaths,
      motionAdjustments,
      loop
    );
    downloadSvg(svg);
  }

  function applyCanvasSize() {
    const w = parseInt(canvasW);
    const h = parseInt(canvasH);
    if (w > 0 && h > 0) dispatch({ type: 'SET_CANVAS_SIZE', width: w, height: h });
  }

  function applyDuration() {
    const d = parseFloat(duration);
    if (d > 0) dispatch({ type: 'SET_DURATION', duration: d });
  }

  return (
    <div className="toolbar">
      <div className="toolbar-group">
        <button className="btn" onClick={() => fileRef.current?.click()}>
          Import SVG
        </button>
        <input ref={fileRef} type="file" accept=".svg,image/svg+xml" onChange={handleImport} style={{ display: 'none' }} />
      </div>

      <div className="toolbar-group">
        <button
          className="btn"
          onClick={() => dispatch({ type: 'UNDO' })}
          disabled={!canUndo}
          title="Undo (⌘Z)"
        >
          <ArrowCounterClockwise size={15} weight="fill" /> Undo
        </button>
        <button
          className="btn"
          onClick={() => dispatch({ type: 'REDO' })}
          disabled={!canRedo}
          title="Redo (⌘⇧Z)"
        >
          <ArrowClockwise size={15} weight="fill" /> Redo
        </button>
      </div>

      <div className="toolbar-group">
        <button
          className={`btn ${state.isPlaying ? 'btn-active' : ''}`}
          onClick={handlePlayPause}
          disabled={!state.svgSource}
          title={state.isPlaying ? 'Pause' : 'Play'}
        >
          {state.isPlaying ? '⏸' : '▶'}
        </button>
        <button className="btn" onClick={handleStop} disabled={!state.svgSource} title="Stop">
          ⏹
        </button>
      </div>

      <div className="toolbar-group">
        <label className="toolbar-label">Duration</label>
        <input
          className="toolbar-input"
          type="number"
          min="0.5"
          max="60"
          step="0.5"
          value={duration}
          onChange={(e) => setDuration(e.target.value)}
          onBlur={applyDuration}
          onKeyDown={(e) => e.key === 'Enter' && applyDuration()}
          style={{ width: 52 }}
        />
        <span className="toolbar-label">s</span>
      </div>

      <div className="toolbar-group">
        <label className="toolbar-label">Canvas</label>
        <input
          className="toolbar-input"
          type="number"
          min="1"
          value={canvasW}
          onChange={(e) => setCanvasW(e.target.value)}
          onBlur={applyCanvasSize}
          onKeyDown={(e) => e.key === 'Enter' && applyCanvasSize()}
          style={{ width: 52 }}
        />
        <span className="toolbar-label">×</span>
        <input
          className="toolbar-input"
          type="number"
          min="1"
          value={canvasH}
          onChange={(e) => setCanvasH(e.target.value)}
          onBlur={applyCanvasSize}
          onKeyDown={(e) => e.key === 'Enter' && applyCanvasSize()}
          style={{ width: 52 }}
        />
      </div>

      <div className="toolbar-group" style={{ marginLeft: 'auto' }}>
        <button
          className="btn"
          onClick={() => dispatch({ type: 'SET_CANVAS_ZOOM', zoom: state.canvasZoom / 1.25 })}
          title="Zoom out"
        >−</button>
        <input
          className="toolbar-input"
          type="number"
          min={10}
          max={400}
          step={10}
          value={Math.round(state.canvasZoom * 100)}
          onChange={(e) => {
            const v = parseInt(e.target.value);
            if (v > 0) dispatch({ type: 'SET_CANVAS_ZOOM', zoom: v / 100 });
          }}
          style={{ width: 48, textAlign: 'center' }}
          title="Canvas zoom %"
        />
        <span className="toolbar-label">%</span>
        <button
          className="btn"
          onClick={() => dispatch({ type: 'SET_CANVAS_ZOOM', zoom: state.canvasZoom * 1.25 })}
          title="Zoom in"
        >+</button>
        <button
          className="btn"
          onClick={() => dispatch({ type: 'SET_CANVAS_ZOOM', zoom: 1 })}
          title="Reset zoom"
          style={{ fontSize: 10 }}
        >1:1</button>
      </div>

      <div className="toolbar-group">
        <label className="toolbar-label">Loop</label>
        <div className="loop-toggle">
          <button
            className={`loop-toggle-btn ${loop === 'none' ? 'loop-toggle-btn--active' : ''}`}
            onClick={() => setLoop('none')}
            title="Play once then freeze"
          >None</button>
          <button
            className={`loop-toggle-btn ${loop === 'infinite' ? 'loop-toggle-btn--active' : ''}`}
            onClick={() => setLoop('infinite')}
            title="Loop forever"
          >∞ Forever</button>
        </div>
        <button className="btn btn-primary" onClick={handleExport} disabled={!state.svgSource}>
          Export SVG
        </button>
      </div>

      <div className="toolbar-group">
        <ThemePicker />
      </div>
    </div>
  );
}
