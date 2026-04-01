import React, { useEffect, useState } from 'react';
import { Eye, EyeSlash, Lock, LockOpen } from '@phosphor-icons/react';
import { useApp } from '../context/AppContext';
import { Layer } from '../types';

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

function LayerRow({ layer, depth, hasChildren }: { layer: Layer; depth: number; hasChildren: boolean }) {
  const { state, dispatch } = useApp();
  const isSelected = state.selectedLayerId === layer.id;
  const isHovered = state.cmdHoverLayerId === layer.id;
  const isGroup = layer.tagName.toLowerCase() === 'g';
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

  return (
    <div
      className={`layer-row ${isSelected ? 'layer-row--selected' : ''} ${isHovered ? 'layer-row--hovered' : ''}`}
      style={{ paddingLeft: 4 + depth * 14 }}
      onClick={() => dispatch({ type: 'SELECT_LAYER', layerId: layer.id })}
    >
      {isGroup && hasChildren ? (
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
        <span style={{ width: 20, display: 'inline-block', flexShrink: 0 }} />
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
      </div>
    </div>
  );
}

function LayerTree({ layers, parentId, depth }: { layers: Layer[]; parentId: string | undefined; depth: number }) {
  const children = layers.filter((l) => l.parentId === parentId);
  if (children.length === 0) return null;

  return (
    <>
      {children.map((layer) => {
        const layerChildren = layers.filter((l) => l.parentId === layer.id);
        const isGroup = layer.tagName.toLowerCase() === 'g';
        return (
          <React.Fragment key={layer.id}>
            <LayerRow layer={layer} depth={depth} hasChildren={layerChildren.length > 0} />
            {isGroup && layer.expanded && (
              <LayerTree layers={layers} parentId={layer.id} depth={depth + 1} />
            )}
          </React.Fragment>
        );
      })}
    </>
  );
}

export default function LayerPanel() {
  const { state } = useApp();

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
          <LayerTree layers={state.layers} parentId={undefined} depth={0} />
        </div>
      )}
    </div>
  );
}
