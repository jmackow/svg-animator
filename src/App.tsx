import React, { useEffect, useRef, useState } from 'react';
import { AppProvider, useApp } from './context/AppContext';
import { removeElementsFromSvg, stripIds, appendSvgChildrenToExisting, extractSvgDimensions } from './utils/svgDom';
import { parseSvgLayers } from './utils/svgParser';
import { extractProjectMetadata } from './utils/exporter';
import { importAnimations, mergeImportedTracks } from './utils/animationImporter';
import { ThemeProvider } from './context/ThemeContext';
import Toolbar from './components/Toolbar';
import LeftPanel from './components/LeftPanel';
import Canvas from './components/Canvas';
import PropertiesPanel from './components/PropertiesPanel';
import Timeline from './components/Timeline';

function isInputFocused(): boolean {
  const el = document.activeElement;
  return (
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    (el instanceof HTMLElement && el.isContentEditable)
  );
}

function KeyboardShortcuts() {
  const { dispatch, deleteSelectedKeyframes, state } = useApp();

  // Paste SVG from clipboard (e.g. Figma "Copy as SVG")
  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      if (isInputFocused()) return;
      const svgText =
        e.clipboardData?.getData('image/svg+xml') ||
        e.clipboardData?.getData('text/plain') ||
        '';
      if (!svgText.trim().includes('<svg')) return;
      e.preventDefault();
      try {
        const saved = extractProjectMetadata(svgText);
        if (saved) {
          dispatch({ type: 'LOAD_PROJECT', svgSource: svgText, layers: saved.layers, duration: saved.duration, canvasWidth: saved.canvasWidth, canvasHeight: saved.canvasHeight, motionPaths: saved.motionPaths ?? [] });
          return;
        }
        if (state.svgSource === null) {
          const { layers, source } = parseSvgLayers(svgText);
          const { layerTracks, maxDuration, strippedSource } = importAnimations(source, layers);
          const finalLayers = mergeImportedTracks(layers, layerTracks);
          dispatch({ type: 'LOAD_SVG', svgSource: strippedSource, layers: finalLayers });
          if (maxDuration > 0.5) dispatch({ type: 'SET_DURATION', duration: maxDuration });
          const dims = extractSvgDimensions(source);
          if (dims) dispatch({ type: 'SET_CANVAS_SIZE', width: dims.width, height: dims.height });
        } else {
          const stripped = stripIds(svgText);
          const { layers: newLayers, source: newSource } = parseSvgLayers(stripped);
          const { layerTracks, maxDuration, strippedSource } = importAnimations(newSource, newLayers);
          const finalNewLayers = mergeImportedTracks(newLayers, layerTracks);
          const mergedSvg = appendSvgChildrenToExisting(state.svgSource, strippedSource);
          dispatch({ type: 'MERGE_LAYERS', newLayers: finalNewLayers, newSvgSource: mergedSvg });
          if (maxDuration > state.duration) dispatch({ type: 'SET_DURATION', duration: maxDuration });
        }
      } catch { /* ignore invalid SVG */ }
    }
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [dispatch, state.svgSource]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey;

      if (meta && !e.shiftKey && e.key === 'z') {
        e.preventDefault();
        dispatch({ type: 'UNDO' });
        return;
      }
      if (meta && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) {
        e.preventDefault();
        dispatch({ type: 'REDO' });
        return;
      }

      if (isInputFocused()) return;

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (state.selectedKeyframes.length > 0 || state.selectedPathKfIds.length > 0) {
          e.preventDefault();
          deleteSelectedKeyframes();
        } else if (state.selectedLayerId && state.svgSource) {
          e.preventDefault();
          const layer = state.layers.find(l => l.id === state.selectedLayerId);
          if (layer) {
            const newSvgSource = removeElementsFromSvg(state.svgSource, [layer.elementId]);
            dispatch({ type: 'DELETE_LAYER', layerId: state.selectedLayerId, newSvgSource });
          }
        }
        return;
      }

      if (e.key === ' ') {
        e.preventDefault();
        if (state.svgSource) {
          if (state.isPlaying) {
            dispatch({ type: 'SET_PLAYING', playing: false });
          } else {
            if (state.currentTime >= state.duration) dispatch({ type: 'SET_TIME', time: 0 });
            dispatch({ type: 'SET_PLAYING', playing: true });
          }
        }
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [dispatch, deleteSelectedKeyframes, state.selectedKeyframes, state.selectedPathKfIds, state.isPlaying, state.svgSource, state.currentTime, state.duration, state.selectedLayerId, state.layers]);

  return null;
}

const MIN_LEFT = 160;
const MAX_LEFT = 480;
const MIN_RIGHT = 160;
const MAX_RIGHT = 480;
const MIN_TIMELINE = 100;
const MAX_TIMELINE = 600;

export default function App() {
  const [leftWidth, setLeftWidth] = useState(220);
  const [rightWidth, setRightWidth] = useState(210);
  const [timelineH, setTimelineH] = useState(220);
  const draggingLeft = useRef(false);
  const draggingRight = useRef(false);
  const draggingTimeline = useRef(false);

  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (draggingLeft.current) {
        setLeftWidth(Math.max(MIN_LEFT, Math.min(MAX_LEFT, e.clientX)));
      }
      if (draggingRight.current) {
        const appWidth = document.documentElement.clientWidth;
        setRightWidth(Math.max(MIN_RIGHT, Math.min(MAX_RIGHT, appWidth - e.clientX)));
      }
      if (draggingTimeline.current) {
        const appHeight = document.documentElement.clientHeight;
        const newH = appHeight - e.clientY;
        setTimelineH(Math.max(MIN_TIMELINE, Math.min(MAX_TIMELINE, newH)));
      }
    }
    function onMouseUp() {
      draggingLeft.current = false;
      draggingRight.current = false;
      draggingTimeline.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  return (
    <ThemeProvider>
    <AppProvider>
      <KeyboardShortcuts />
      <div
        className="app"
        style={{
          '--layer-panel-w': `${leftWidth}px`,
          '--props-panel-w': `${rightWidth}px`,
          '--timeline-h': `${timelineH}px`,
        } as React.CSSProperties}
      >
        <Toolbar />
        <div className="main-area">
          <LeftPanel />
          {/* Left resize handle */}
          <div
            className="resize-handle resize-handle--vertical"
            onMouseDown={() => {
              draggingLeft.current = true;
              document.body.style.cursor = 'col-resize';
              document.body.style.userSelect = 'none';
            }}
          />
          <Canvas />
          {/* Right resize handle */}
          <div
            className="resize-handle resize-handle--vertical"
            onMouseDown={() => {
              draggingRight.current = true;
              document.body.style.cursor = 'col-resize';
              document.body.style.userSelect = 'none';
            }}
          />
          <PropertiesPanel />
        </div>
        {/* Timeline resize handle */}
        <div
          className="resize-handle resize-handle--horizontal"
          onMouseDown={() => {
            draggingTimeline.current = true;
            document.body.style.cursor = 'row-resize';
            document.body.style.userSelect = 'none';
          }}
        />
        <Timeline />
      </div>
    </AppProvider>
    </ThemeProvider>
  );
}
