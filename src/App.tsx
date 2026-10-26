import React, { useEffect, useRef, useState } from 'react';
import { AppProvider, useApp, emptyTracks } from './context/AppContext';
import { AnimatableProperty, EasingConfig, PathPoint, ALL_PROPERTIES, Layer } from './types';
import { removeElementsFromSvg, stripIds, appendSvgChildrenToExisting, extractSvgDimensions, groupElementsInSvg, ungroupElementInSvg, collectElementIds, duplicateElementsInSvg } from './utils/svgDom';
import { parseSvgLayers, flattenProjectLayers } from './utils/svgParser';
import { extractProjectMetadata } from './utils/exporter';
import { importAnimations, mergeImportedTracks, stripAnimationMarkup } from './utils/animationImporter';
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

type CopiedKf =
  | { type: 'property'; layerId: string; property: AnimatableProperty; value: number; easing: EasingConfig }
  | { type: 'path'; layerId: string; points: PathPoint[]; closed: boolean; easing: EasingConfig; movedPointIds: string[] };

function KeyboardShortcuts() {
  const { dispatch, deleteSelectedKeyframes, state } = useApp();
  const kfClipboardRef = useRef<CopiedKf[]>([]);

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
          const flat = flattenProjectLayers(stripAnimationMarkup(svgText), saved.layers);
          dispatch({ type: 'LOAD_PROJECT', svgSource: flat.source, layers: flat.layers, duration: saved.duration, canvasWidth: saved.canvasWidth, canvasHeight: saved.canvasHeight, motionPaths: saved.motionPaths ?? [] });
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
          // Hand over the open document's ids so the pasted shapes get their own.
          const { layers: newLayers, source: newSource } = parseSvgLayers(
            stripped,
            collectElementIds(state.svgSource)
          );
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

      // Cmd/Ctrl+A with the timeline in play selects every keyframe there —
      // property tracks and anchor-point (path) tracks alike.
      if (meta && (e.key === 'a' || e.key === 'A')) {
        const timelineActive =
          state.selectedKeyframes.length > 0 || state.selectedPathKfIds.length > 0;
        if (!timelineActive) return;
        e.preventDefault();

        const allKfs: { layerId: string; property: AnimatableProperty; keyframeId: string }[] = [];
        const allPathKfIds: string[] = [];
        for (const layer of state.layers) {
          for (const property of ALL_PROPERTIES) {
            for (const kf of layer.tracks[property]) {
              allKfs.push({ layerId: layer.id, property, keyframeId: kf.id });
            }
          }
          for (const kf of layer.pathKeyframes ?? []) allPathKfIds.push(kf.id);
        }
        dispatch({ type: 'SELECT_KEYFRAMES', kfs: allKfs });
        dispatch({ type: 'SELECT_PATH_KEYFRAMES', kfIds: allPathKfIds });
        return;
      }

      // Cmd/Ctrl+D duplicates the selection, copy landing just above the original.
      if (meta && (e.key === 'd' || e.key === 'D')) {
        e.preventDefault();
        if (!state.svgSource || state.selectedLayerIds.length === 0) return;

        // Duplicating a group already brings its children along, so drop any
        // selected layer that sits inside another selected one.
        const selected = new Set(state.selectedLayerIds);
        const nestedInSelection = (layer: Layer) => {
          let pid = layer.parentId;
          let guard = 0;
          while (pid && guard++ < 50) {
            if (selected.has(pid)) return true;
            pid = state.layers.find(l => l.id === pid)?.parentId;
          }
          return false;
        };
        const roots = state.layers.filter(l => selected.has(l.id) && !nestedInSelection(l));
        if (roots.length === 0) return;

        const { source, idMap } = duplicateElementsInSvg(
          state.svgSource,
          roots.map(l => l.elementId)
        );
        dispatch({
          type: 'DUPLICATE_LAYERS',
          sourceLayerIds: roots.map(l => l.id),
          idMap,
          newSvgSource: source,
        });
        return;
      }

      // Cmd/Ctrl+G groups the selection; Cmd/Ctrl+Shift+G dissolves a group.
      if (meta && (e.key === 'g' || e.key === 'G')) {
        e.preventDefault();
        if (!state.svgSource) return;

        if (e.shiftKey) {
          const group = state.layers.find(
            l => state.selectedLayerIds.includes(l.id) && l.tagName.toLowerCase() === 'g'
          );
          if (!group) return;
          dispatch({
            type: 'UNGROUP_LAYER',
            groupId: group.id,
            newSvgSource: ungroupElementInSvg(state.svgSource, group.elementId),
          });
          return;
        }

        if (state.selectedLayerIds.length < 2) return;
        // Only group siblings — mixing levels would have to reparent across groups.
        const picked = state.layers.filter(l => state.selectedLayerIds.includes(l.id));
        const parentId = picked[0].parentId;
        if (picked.some(l => l.parentId !== parentId)) return;

        const groupId = `svga-group-${Date.now().toString(36)}`;
        dispatch({
          type: 'GROUP_LAYERS',
          groupLayer: {
            id: groupId,
            elementId: groupId,
            tagName: 'g',
            label: 'Group',
            tracks: emptyTracks(),
            visible: true,
            locked: false,
            expanded: true,
            parentId,
            anchorX: 0,
            anchorY: 0,
            autoRotate: false,
          },
          childIds: picked.map(l => l.id),
          newSvgSource: groupElementsInSvg(state.svgSource, picked.map(l => l.elementId), groupId),
        });
        return;
      }

      if (meta && e.key === 'c') {
        const copied: CopiedKf[] = [];
        for (const sel of state.selectedKeyframes) {
          const layer = state.layers.find(l => l.id === sel.layerId);
          const kf = layer?.tracks[sel.property]?.find(k => k.id === sel.keyframeId);
          if (kf) copied.push({ type: 'property', layerId: sel.layerId, property: sel.property, value: kf.value, easing: kf.easing });
        }
        for (const kfId of state.selectedPathKfIds) {
          for (const layer of state.layers) {
            const kf = layer.pathKeyframes?.find(k => k.id === kfId);
            if (kf) { copied.push({ type: 'path', layerId: layer.id, points: kf.points, closed: kf.closed, easing: kf.easing, movedPointIds: kf.movedPointIds ?? [] }); break; }
          }
        }
        if (copied.length > 0) { kfClipboardRef.current = copied; e.preventDefault(); }
        return;
      }

      if (meta && e.key === 'v') {
        if (kfClipboardRef.current.length === 0) return;
        e.preventDefault(); // prevents SVG paste event from also firing
        const t = state.currentTime;
        for (const item of kfClipboardRef.current) {
          if (item.type === 'property') {
            const layer = state.layers.find(l => l.id === item.layerId);
            if (!layer) continue;
            const existing = layer.tracks[item.property]?.find(k => Math.abs(k.time - t) < 0.001);
            if (existing) {
              dispatch({ type: 'UPDATE_PROPERTY_KEYFRAME', layerId: item.layerId, property: item.property, keyframeId: existing.id, value: item.value, easing: item.easing });
            } else {
              dispatch({ type: 'ADD_PROPERTY_KEYFRAME', layerId: item.layerId, property: item.property, keyframe: { id: `kf-${Date.now()}-${Math.random().toString(36).slice(2)}`, time: t, value: item.value, easing: item.easing } });
            }
          } else {
            const layer = state.layers.find(l => l.id === item.layerId);
            if (!layer) continue;
            const existing = layer.pathKeyframes?.find(k => Math.abs(k.time - t) < 0.001);
            if (existing) {
              dispatch({ type: 'UPDATE_PATH_KEYFRAME', layerId: item.layerId, keyframeId: existing.id, points: item.points, movedPointIds: item.movedPointIds });
            } else {
              dispatch({ type: 'ADD_PATH_KEYFRAME', layerId: item.layerId, keyframe: { id: `pkf-${Date.now()}-${Math.random().toString(36).slice(2)}`, time: t, points: item.points, closed: item.closed, easing: item.easing, movedPointIds: item.movedPointIds } });
            }
          }
        }
        return;
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (state.selectedKeyframes.length > 0 || state.selectedPathKfIds.length > 0) {
          e.preventDefault();
          deleteSelectedKeyframes();
        } else if (state.selectedLayerIds.length > 0 && state.svgSource) {
          e.preventDefault();
          const doomed = state.layers.filter(l => state.selectedLayerIds.includes(l.id));
          if (doomed.length) {
            // Strip every element in one pass, then retire the layers one by one —
            // each DELETE_LAYER carries the same already-final source.
            const newSvgSource = removeElementsFromSvg(state.svgSource, doomed.map(l => l.elementId));
            for (const l of doomed) {
              dispatch({ type: 'DELETE_LAYER', layerId: l.id, newSvgSource });
            }
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
  }, [dispatch, deleteSelectedKeyframes, state.selectedKeyframes, state.selectedPathKfIds, state.isPlaying, state.svgSource, state.currentTime, state.duration, state.selectedLayerId, state.selectedLayerIds, state.layers, kfClipboardRef]);

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
        <div className="small-screen-overlay">
          <div className="small-screen-overlay-text">Animation is a big screen activity</div>
        </div>
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
