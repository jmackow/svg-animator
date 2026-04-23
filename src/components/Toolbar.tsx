import React, { useRef, useState, useEffect } from 'react';
import { ArrowCounterClockwise, ArrowClockwise } from '@phosphor-icons/react';
import { useApp } from '../context/AppContext';
import { emptyTracks } from '../context/AppContext';
import ThemePicker from './ThemePicker';
import { parseSvgLayers } from '../utils/svgParser';
import { exportAnimatedSvg, downloadSvg, extractProjectMetadata } from '../utils/exporter';
import { stripIds, appendSvgChildrenToExisting, appendRawElementToSvg, createMinimalSvg, extractSvgDimensions } from '../utils/svgDom';
import { importAnimations, mergeImportedTracks } from '../utils/animationImporter';
import { Layer } from '../types';

export default function Toolbar() {
  const { state, dispatch, canUndo, canRedo } = useApp();
  const svgFileRef = useRef<HTMLInputElement>(null);
  const imageFileRef = useRef<HTMLInputElement>(null);
  const importBtnRef = useRef<HTMLDivElement>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [canvasW, setCanvasW] = useState(String(state.canvasWidth));
  const [canvasH, setCanvasH] = useState(String(state.canvasHeight));
  const [duration, setDuration] = useState(String(state.duration));
  const loop: 'none' | 'infinite' = state.loopPlayback ? 'infinite' : 'none';
  function setLoop(l: 'none' | 'infinite') { dispatch({ type: 'SET_LOOP_PLAYBACK', loop: l === 'infinite' }); }

  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (importBtnRef.current && !importBtnRef.current.contains(e.target as Node)) {
        setImportOpen(false);
      }
    }
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, []);

  function handleSvgImport(e: React.ChangeEvent<HTMLInputElement>) {
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
        } else if (state.svgSource === null) {
          const { layers, source } = parseSvgLayers(text);
          const { layerTracks, maxDuration, strippedSource } = importAnimations(source, layers);
          const finalLayers = mergeImportedTracks(layers, layerTracks);
          dispatch({ type: 'LOAD_SVG', svgSource: strippedSource, layers: finalLayers });
          if (maxDuration > 0.5) dispatch({ type: 'SET_DURATION', duration: maxDuration });
          const dims = extractSvgDimensions(source);
          if (dims) {
            dispatch({ type: 'SET_CANVAS_SIZE', width: dims.width, height: dims.height });
            setCanvasW(String(dims.width));
            setCanvasH(String(dims.height));
          }
        } else {
          const stripped = stripIds(text);
          const { layers: newLayers, source: newSource } = parseSvgLayers(stripped);
          const { layerTracks, maxDuration, strippedSource } = importAnimations(newSource, newLayers);
          const finalNewLayers = mergeImportedTracks(newLayers, layerTracks);
          const mergedSvg = appendSvgChildrenToExisting(state.svgSource, strippedSource);
          dispatch({ type: 'MERGE_LAYERS', newLayers: finalNewLayers, newSvgSource: mergedSvg });
          if (maxDuration > state.duration) dispatch({ type: 'SET_DURATION', duration: maxDuration });
        }
      } catch {
        alert('Failed to parse SVG file.');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  function handleImageImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      const img = new Image();
      img.onload = () => {
        const W = img.naturalWidth || state.canvasWidth;
        const H = img.naturalHeight || state.canvasHeight;
        const label = file.name.replace(/\.[^.]+$/, '');
        const elemId = `svga-img-${Date.now()}`;
        const imageTag = `<image id="${elemId}" href="${dataUrl}" x="0" y="0" width="${W}" height="${H}" />`;

        const newLayer: Layer = {
          id: elemId,
          elementId: elemId,
          tagName: 'image',
          label,
          tracks: emptyTracks(),
          visible: true,
          locked: false,
          expanded: false,
          anchorX: 0,
          anchorY: 0,
          autoRotate: false,
        };

        if (state.svgSource === null) {
          const svgSource = createMinimalSvg(W, H, imageTag);
          dispatch({ type: 'LOAD_SVG', svgSource, layers: [newLayer] });
        } else {
          const newSvgSource = appendRawElementToSvg(state.svgSource, imageTag);
          dispatch({ type: 'MERGE_LAYERS', newLayers: [newLayer], newSvgSource });
        }
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
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
        <div className="import-btn-group" ref={importBtnRef}>
          <button className="btn" onClick={() => setImportOpen(o => !o)}>
            Import ▾
          </button>
          {importOpen && (
            <div className="import-dropdown">
              <button
                className="import-dropdown-item"
                onClick={() => { setImportOpen(false); svgFileRef.current?.click(); }}
              >
                SVG
              </button>
              <button
                className="import-dropdown-item"
                onClick={() => { setImportOpen(false); imageFileRef.current?.click(); }}
              >
                Image
              </button>
            </div>
          )}
        </div>
        <input ref={svgFileRef} type="file" accept=".svg,image/svg+xml" onChange={handleSvgImport} style={{ display: 'none' }} />
        <input ref={imageFileRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp" onChange={handleImageImport} style={{ display: 'none' }} />
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
