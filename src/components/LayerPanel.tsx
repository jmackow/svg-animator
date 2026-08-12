import React, { useEffect, useRef, useState } from 'react';
import { Eye, EyeSlash, Lock, LockOpen, Trash } from '@phosphor-icons/react';
import { useApp } from '../context/AppContext';
import { Layer } from '../types';
import { removeElementsFromSvg, moveElementInSvg } from '../utils/svgDom';

interface DragState {
  draggingId: string;
  currentBeforeId: string | null;
}

interface DragProps {
  draggingId: string | null;
  dropIndicator: { beforeId: string | null } | null;
  onDragStart: (id: string) => void;
  registerRef: (id: string, el: HTMLDivElement | null) => void;
  onSelect: (id: string, e: React.MouseEvent) => void;
}

function LayerPreview({ elementId }: { elementId: string }) {
  const { state } = useApp();
  const [preview, setPreview] = useState<{ content: string; viewBox: string } | null>(null);

  useEffect(() => {
    const svgEl = document.querySelector('.svg-host svg') as SVGSVGElement | null;
    if (!svgEl) return;
    const el = svgEl.getElementById(elementId) as SVGGraphicsElement | null;
    if (!el) return;
    try {
      const b = el.getBBox();
      if (b.width < 1 && b.height < 1) return;
      const pad = Math.max(4, (b.width + b.height) * 0.06);
      const viewBox = `${b.x - pad} ${b.y - pad} ${b.width + pad * 2} ${b.height + pad * 2}`;
      const clone = el.cloneNode(true) as SVGGraphicsElement;
      const cs = (clone as unknown as HTMLElement).style;
      cs.transform = '';
      cs.transformOrigin = '';
      cs.transformBox = '';
      cs.filter = '';
      cs.cursor = '';
      setPreview({ content: (clone as Element).outerHTML, viewBox });
    } catch {
      // skip if getBBox throws
    }
  }, [elementId, state.svgSource]);

  return (
    <svg
      viewBox={preview?.viewBox ?? '0 0 1 1'}
      style={{ width: 26, height: 26, flexShrink: 0, background: 'var(--surface3)', borderRadius: 3, border: '1px solid var(--border)' }}
      dangerouslySetInnerHTML={{ __html: preview?.content ?? '' }}
    />
  );
}

function LayerRow({
  layer,
  dragProps,
}: {
  layer: Layer;
  dragProps: DragProps;
}) {
  const { state, dispatch } = useApp();
  const isSelected = state.selectedLayerIds.includes(layer.id);
  const isHovered = state.cmdHoverLayerId === layer.id;
  const isDragging = dragProps.draggingId === layer.id;
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(layer.label);

  function startEdit(e: React.MouseEvent) {
    e.stopPropagation();
    setEditValue(layer.label);
    setEditing(true);
  }

  function commitEdit() {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== layer.label) {
      dispatch({ type: 'RENAME_LAYER', layerId: layer.id, label: trimmed });
    }
    setEditing(false);
  }

  function handleDelete(e: React.MouseEvent) {
    e.stopPropagation();
    if (!state.svgSource) return;
    const newSvgSource = removeElementsFromSvg(state.svgSource, [layer.elementId]);
    dispatch({ type: 'DELETE_LAYER', layerId: layer.id, newSvgSource });
  }

  return (
    <div
      ref={(el) => dragProps.registerRef(layer.id, el)}
      className={`layer-row ${isSelected ? 'layer-row--selected' : ''} ${isHovered ? 'layer-row--hovered' : ''} ${isDragging ? 'layer-row--dragging' : ''}`}
      style={{ paddingLeft: 4 }}
      onClick={(e) => dragProps.onSelect(layer.id, e)}
    >
      <span
        className="layer-drag-handle"
        title="Drag to reorder"
        onMouseDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
          dragProps.onDragStart(layer.id);
        }}
      >
        ≡
      </span>
      <LayerPreview elementId={layer.elementId} />
      <span className="layer-tag">{layer.tagName}</span>
      {editing ? (
        <input
          className="layer-rename-input"
          value={editValue}
          autoFocus
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitEdit();
            if (e.key === 'Escape') setEditing(false);
            e.stopPropagation();
          }}
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <span
          className="layer-label"
          title={`${layer.label} — double-click to rename`}
          onDoubleClick={startEdit}
        >
          {layer.label}
        </span>
      )}
      <div className="layer-actions">
        <button
          className="icon-btn"
          title={layer.visible ? 'Hide' : 'Show'}
          onClick={(e) => {
            e.stopPropagation();
            dispatch({ type: 'TOGGLE_LAYER_VISIBILITY', layerId: layer.id });
          }}
        >
          {layer.visible
            ? <Eye size={14} weight="fill" />
            : <EyeSlash size={14} weight="regular" />}
        </button>
        <button
          className="icon-btn"
          title={layer.locked ? 'Unlock' : 'Lock'}
          onClick={(e) => {
            e.stopPropagation();
            dispatch({ type: 'TOGGLE_LAYER_LOCK', layerId: layer.id });
          }}
        >
          {layer.locked
            ? <Lock size={14} weight="fill" />
            : <LockOpen size={14} weight="regular" />}
        </button>
        <button
          className="icon-btn layer-delete-btn"
          title="Delete layer"
          onClick={handleDelete}
        >
          <Trash size={13} weight="regular" />
        </button>
      </div>
    </div>
  );
}

function LayerList({ layers, dragProps }: { layers: Layer[]; dragProps: DragProps }) {
  // Reversed so the highest z-order layer appears at the top of the list
  const ordered = [...layers].reverse();

  return (
    <>
      {ordered.map((layer, idx) => {
        const di = dragProps.dropIndicator;
        // beforeId=null means append to end of data = highest z-order = visual top
        const showIndicatorAbove = idx === 0 && !!di && di.beforeId === null;
        // beforeId=layer.id means insert before this layer in data = lower z-order = below in visual
        const showIndicatorBelow = !!di && di.beforeId === layer.id;

        return (
          <React.Fragment key={layer.id}>
            {showIndicatorAbove && <div className="layer-drop-indicator" style={{ marginLeft: 4 }} />}
            <LayerRow layer={layer} dragProps={dragProps} />
            {showIndicatorBelow && <div className="layer-drop-indicator" style={{ marginLeft: 4 }} />}
          </React.Fragment>
        );
      })}
    </>
  );
}

export default function LayerPanel() {
  const { state, dispatch } = useApp();

  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const dragRef = useRef<DragState | null>(null);
  const layersRef = useRef(state.layers);
  const svgSourceRef = useRef(state.svgSource);
  const selectionAnchorRef = useRef<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropIndicator, setDropIndicator] = useState<{ beforeId: string | null } | null>(null);

  useEffect(() => {
    layersRef.current = state.layers;
    svgSourceRef.current = state.svgSource;
  });

  function registerRef(id: string, el: HTMLDivElement | null) {
    if (el) rowRefs.current.set(id, el);
    else rowRefs.current.delete(id);
  }

  function startDrag(id: string) {
    dragRef.current = { draggingId: id, currentBeforeId: null };
    setDraggingId(id);
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'grabbing';
  }

  useEffect(() => {
    function computeBeforeId(mouseY: number, draggingId: string): string | null {
      const siblings = layersRef.current.filter(l => l.id !== draggingId);
      // Display is reversed (high data index = visual top). Iterate from high→low index.
      // Return the last sibling (lowest data index) whose midpoint the mouse is below —
      // that sibling is visually above the cursor, so drop goes just below it in visual = before it in data.
      let result: string | null = null;
      for (let i = siblings.length - 1; i >= 0; i--) {
        const sib = siblings[i];
        const el = rowRefs.current.get(sib.id);
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        if (mouseY > rect.top + rect.height / 2) result = sib.id;
      }
      return result;
    }

    function onMove(e: MouseEvent) {
      const drag = dragRef.current;
      if (!drag) return;
      const beforeId = computeBeforeId(e.clientY, drag.draggingId);
      drag.currentBeforeId = beforeId;
      setDropIndicator({ beforeId });
    }

    function onUp(e: MouseEvent) {
      const drag = dragRef.current;
      if (!drag) return;
      dragRef.current = null;
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      setDraggingId(null);
      setDropIndicator(null);

      const layers = layersRef.current;
      const svgSource = svgSourceRef.current;
      if (!svgSource) return;

      const movedLayer = layers.find(l => l.id === drag.draggingId);
      if (!movedLayer) return;

      const beforeId = computeBeforeId(e.clientY, drag.draggingId);

      // Check if position actually changed
      const currIdx = layers.findIndex(l => l.id === drag.draggingId);
      const targetIdx = beforeId !== null
        ? layers.findIndex(l => l.id === beforeId)
        : layers.length;
      const adjustedTarget = currIdx < targetIdx ? targetIdx - 1 : targetIdx;
      if (currIdx === adjustedTarget) return;

      const beforeElementId = beforeId
        ? layers.find(l => l.id === beforeId)?.elementId ?? null
        : null;

      const newSvgSource = moveElementInSvg(svgSource, movedLayer.elementId, beforeElementId);
      dispatch({ type: 'REORDER_LAYER', layerId: drag.draggingId, beforeId, newSvgSource });
    }

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [dispatch]);

  // Shift extends from the last plain click to the row clicked, over the list as
  // it reads on screen; cmd/ctrl toggles a single row in or out.
  function handleSelect(id: string, e: React.MouseEvent) {
    if (e.metaKey || e.ctrlKey) {
      dispatch({ type: 'ADD_TO_LAYER_SELECTION', layerId: id });
      selectionAnchorRef.current = id;
      return;
    }

    if (e.shiftKey && selectionAnchorRef.current) {
      const ordered = [...state.layers].reverse().map(l => l.id);
      const from = ordered.indexOf(selectionAnchorRef.current);
      const to = ordered.indexOf(id);
      if (from !== -1 && to !== -1) {
        const [lo, hi] = from < to ? [from, to] : [to, from];
        // Put the clicked row last so it becomes the primary layer.
        const range = ordered.slice(lo, hi + 1).filter(rid => rid !== id);
        dispatch({ type: 'SET_LAYER_SELECTION', layerIds: [...range, id] });
        return;
      }
    }

    dispatch({ type: 'SELECT_LAYER', layerId: id });
    selectionAnchorRef.current = id;
  }

  const dragProps: DragProps = {
    draggingId,
    dropIndicator,
    onDragStart: startDrag,
    registerRef,
    onSelect: handleSelect,
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
      <div className="panel-header">
        <span>Layers</span>
        <span className="panel-count">{state.layers.length}</span>
      </div>
      {state.layers.length === 0 ? (
        <div className="panel-empty">Import an SVG to see layers</div>
      ) : (
        <div className="layer-list">
          <LayerList layers={state.layers} dragProps={dragProps} />
        </div>
      )}
    </div>
  );
}
