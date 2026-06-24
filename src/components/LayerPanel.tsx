import React, { useEffect, useRef, useState } from 'react';
import { Eye, EyeSlash, Lock, LockOpen, Trash, Polygon } from '@phosphor-icons/react';
import { useApp } from '../context/AppContext';
import { Layer } from '../types';
import { removeElementsFromSvg, moveElementInSvg } from '../utils/svgDom';

interface DragState {
  draggingId: string;
  parentId: string | undefined;
  currentBeforeId: string | null;
}

interface DragProps {
  draggingId: string | null;
  dropIndicator: { parentId: string | undefined; beforeId: string | null } | null;
  onDragStart: (id: string, parentId: string | undefined) => void;
  registerRef: (id: string, el: HTMLDivElement | null) => void;
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
  depth,
  hasChildren,
  dragProps,
}: {
  layer: Layer;
  depth: number;
  hasChildren: boolean;
  dragProps: DragProps;
}) {
  const { state, dispatch } = useApp();
  const isSelected = state.selectedLayerId === layer.id;
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
      style={{ paddingLeft: 4 + depth * 14 }}
      onClick={() => dispatch({ type: 'SELECT_LAYER', layerId: layer.id })}
    >
      <span
        className="layer-drag-handle"
        title="Drag to reorder"
        onMouseDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
          dragProps.onDragStart(layer.id, layer.parentId);
        }}
      >
        ≡
      </span>
      {hasChildren ? (
        <button
          className="icon-btn expand-btn"
          style={{ marginRight: 2 }}
          onClick={(e) => {
            e.stopPropagation();
            dispatch({ type: 'TOGGLE_LAYER_EXPANDED', layerId: layer.id });
          }}
          title={layer.expanded ? 'Collapse' : 'Expand'}
        >
          {layer.expanded ? '▾' : '▸'}
        </button>
      ) : (
        <span style={{ width: 12, display: 'inline-block', flexShrink: 0 }} />
      )}
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
          className={`icon-btn${layer.skeletonMode ? ' layer-skeleton-btn--active' : ''}`}
          title={layer.skeletonMode ? 'Disable skeleton mode' : 'Enable skeleton mode'}
          onClick={(e) => {
            e.stopPropagation();
            dispatch({ type: 'TOGGLE_LAYER_SKELETON', layerId: layer.id });
          }}
        >
          <Polygon size={13} weight={layer.skeletonMode ? 'fill' : 'regular'} />
        </button>
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

function LayerTree({
  layers,
  parentId,
  depth,
  dragProps,
}: {
  layers: Layer[];
  parentId: string | undefined;
  depth: number;
  dragProps: DragProps;
}) {
  // Reversed so the highest z-order layer appears at the top of the list
  const children = layers.filter((l) => l.parentId === parentId).reverse();
  if (children.length === 0) return null;

  return (
    <>
      {children.map((layer, idx) => {
        const layerChildren = layers.filter((l) => l.parentId === layer.id);
        const isGroup = layer.tagName.toLowerCase() === 'g';
        const isFirst = idx === 0;

        const di = dragProps.dropIndicator;
        // beforeId=null means append to end of data = highest z-order = visual top
        const showIndicatorAbove = isFirst && !!di && di.parentId === parentId && di.beforeId === null;
        // beforeId=layer.id means insert before this layer in data = lower z-order = below in visual
        const showIndicatorBelow = !!di && di.parentId === parentId && di.beforeId === layer.id;

        return (
          <React.Fragment key={layer.id}>
            {showIndicatorAbove && (
              <div className="layer-drop-indicator" style={{ marginLeft: 4 + depth * 14 }} />
            )}
            <LayerRow
              layer={layer}
              depth={depth}
              hasChildren={layerChildren.length > 0}
              dragProps={dragProps}
            />
            {isGroup && layer.expanded && (
              <LayerTree
                layers={layers}
                parentId={layer.id}
                depth={depth + 1}
                dragProps={dragProps}
              />
            )}
            {showIndicatorBelow && (
              <div className="layer-drop-indicator" style={{ marginLeft: 4 + depth * 14 }} />
            )}
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
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropIndicator, setDropIndicator] = useState<{ parentId: string | undefined; beforeId: string | null } | null>(null);

  useEffect(() => {
    layersRef.current = state.layers;
    svgSourceRef.current = state.svgSource;
  });

  function registerRef(id: string, el: HTMLDivElement | null) {
    if (el) rowRefs.current.set(id, el);
    else rowRefs.current.delete(id);
  }

  function startDrag(id: string, parentId: string | undefined) {
    dragRef.current = { draggingId: id, parentId, currentBeforeId: null };
    setDraggingId(id);
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'grabbing';
  }

  useEffect(() => {
    function computeBeforeId(mouseY: number, draggingId: string, parentId: string | undefined): string | null {
      const layers = layersRef.current;
      const siblings = layers.filter(l => l.parentId === parentId && l.id !== draggingId);
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
      const beforeId = computeBeforeId(e.clientY, drag.draggingId, drag.parentId);
      drag.currentBeforeId = beforeId;
      setDropIndicator({ parentId: drag.parentId, beforeId });
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

      const beforeId = computeBeforeId(e.clientY, drag.draggingId, drag.parentId);

      // Check if position actually changed
      const siblings = layers.filter(l => l.parentId === drag.parentId);
      const currIdx = siblings.findIndex(l => l.id === drag.draggingId);
      const targetIdx = beforeId !== null
        ? siblings.findIndex(l => l.id === beforeId)
        : siblings.length;
      const adjustedTarget = currIdx < targetIdx ? targetIdx - 1 : targetIdx;
      if (currIdx === adjustedTarget) return;

      const parentElementId = movedLayer.parentId
        ? layers.find(l => l.id === movedLayer.parentId)?.elementId ?? null
        : null;
      const beforeElementId = beforeId
        ? layers.find(l => l.id === beforeId)?.elementId ?? null
        : null;

      const newSvgSource = moveElementInSvg(svgSource, movedLayer.elementId, beforeElementId, parentElementId);
      dispatch({ type: 'REORDER_LAYER', layerId: drag.draggingId, beforeId, newSvgSource });
    }

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [dispatch]);

  const dragProps: DragProps = {
    draggingId,
    dropIndicator,
    onDragStart: startDrag,
    registerRef,
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
          <LayerTree layers={state.layers} parentId={undefined} depth={0} dragProps={dragProps} />
        </div>
      )}
    </div>
  );
}
