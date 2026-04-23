import React, { useEffect, useState } from 'react';
import { Eye, EyeSlash, PencilSimple, Trash } from '@phosphor-icons/react';
import { useApp } from '../context/AppContext';
import { MotionPath } from '../types';

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
      cs.transform = ''; cs.transformOrigin = ''; cs.transformBox = ''; cs.filter = ''; cs.cursor = '';
      setPreview({ content: (clone as Element).outerHTML, viewBox });
    } catch { /* skip */ }
  }, [elementId, state.svgSource]);

  return (
    <svg
      viewBox={preview?.viewBox ?? '0 0 1 1'}
      style={{ width: 28, height: 28, flexShrink: 0, background: 'var(--surface3)', borderRadius: 3, border: '1px solid var(--border)' }}
      dangerouslySetInnerHTML={{ __html: preview?.content ?? '' }}
    />
  );
}

function MotionPathRow({ mp, isSelected }: { mp: MotionPath; isSelected: boolean }) {
  const { state, dispatch } = useApp();
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(mp.label);
  const isVisible = mp.visible !== false;

  function startEdit(e: React.MouseEvent) {
    e.stopPropagation();
    setEditValue(mp.label);
    setEditing(true);
  }

  function commitEdit() {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== mp.label) {
      dispatch({ type: 'RENAME_MOTION_PATH', id: mp.id, label: trimmed });
    }
    setEditing(false);
  }

  function startDrawing(e: React.MouseEvent) {
    e.stopPropagation();
    dispatch({ type: 'SET_SELECTED_MOTION_PATH', id: mp.id });
    dispatch({ type: 'SET_DRAWING_MOTION_PATH', id: mp.id });
  }

  function deletePath(e: React.MouseEvent) {
    e.stopPropagation();
    dispatch({ type: 'DELETE_MOTION_PATH', id: mp.id });
  }

  function toggleVisible(e: React.MouseEvent) {
    e.stopPropagation();
    dispatch({ type: 'TOGGLE_MOTION_PATH_VISIBLE', id: mp.id });
  }

  return (
    <div
      className={`layer-row ${isSelected ? 'layer-row--selected' : ''}`}
      style={{ flexWrap: 'wrap' }}
      onClick={() => dispatch({ type: 'SET_SELECTED_MOTION_PATH', id: mp.id })}
    >
      <span style={{ fontSize: 14, flexShrink: 0, color: 'var(--text-muted)', opacity: isVisible ? 1 : 0.4 }}>⌇</span>
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
          style={{ opacity: isVisible ? 1 : 0.4 }}
          title={`${mp.label} — double-click to rename`}
          onDoubleClick={startEdit}
        >
          {mp.label}
        </span>
      )}
      <div className="layer-actions">
        <button className="icon-btn" title={isVisible ? 'Hide path' : 'Show path'} onClick={toggleVisible}>
          {isVisible ? <Eye size={14} weight="fill" /> : <EyeSlash size={14} weight="regular" />}
        </button>
        <button className="icon-btn" title="Redraw path" onClick={startDrawing}><PencilSimple size={14} weight="fill" /></button>
        <button className="icon-btn layer-delete-btn" title="Delete path" onClick={deletePath}><Trash size={14} weight="fill" /></button>
      </div>

      {isSelected && (
        <div style={{ width: '100%', padding: '4px 8px', borderTop: '1px solid var(--border)', background: 'var(--surface)' }}
          onClick={e => e.stopPropagation()}>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>Assign to layers:</div>
          {state.layers.map(layer => (
            <div key={layer.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', borderBottom: '1px solid var(--border)' }}>
              <input type="checkbox"
                checked={layer.motionPathId === mp.id}
                onChange={() => {
                  if (layer.motionPathId === mp.id) {
                    dispatch({ type: 'SET_LAYER_MOTION_PATH', layerId: layer.id, motionPathId: null });
                  } else {
                    dispatch({ type: 'SET_LAYER_MOTION_PATH', layerId: layer.id, motionPathId: mp.id });
                  }
                }}
                style={{ flexShrink: 0 }}
              />
              <LayerPreview elementId={layer.elementId} />
              <span style={{ fontSize: 12, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{layer.label}</span>
              {layer.motionPathId === mp.id && (
                <label style={{ fontSize: 10, display: 'flex', alignItems: 'center', gap: 4, color: 'var(--text-muted)', flexShrink: 0 }}>
                  <input type="checkbox" checked={layer.autoRotate ?? false}
                    onChange={(e) => dispatch({ type: 'SET_LAYER_AUTO_ROTATE', layerId: layer.id, autoRotate: e.target.checked })} />
                  auto-rotate
                </label>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function MotionPathPanel() {
  const { state, dispatch } = useApp();
  const { motionPaths, selectedMotionPathId } = state;

  function createPath() {
    const id = `mp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const newPath: MotionPath = { id, label: `Path ${motionPaths.length + 1}`, d: '', visible: true };
    dispatch({ type: 'ADD_MOTION_PATH', path: newPath });
    dispatch({ type: 'SET_SELECTED_MOTION_PATH', id });
    dispatch({ type: 'SET_DRAWING_MOTION_PATH', id });
  }

  return (
    <div className="layer-panel">
      <div className="panel-header" style={{ justifyContent: 'space-between' }}>
        <span>Motion Paths</span>
        <button className="btn" style={{ fontSize: 11, padding: '2px 8px' }} onClick={createPath}>+ New</button>
      </div>

      {motionPaths.length === 0 ? (
        <div className="panel-empty">Click "+ New" to draw a motion path</div>
      ) : (
        <div className="layer-list">
          {[...motionPaths].reverse().map(mp => (
            <MotionPathRow key={mp.id} mp={mp} isSelected={mp.id === selectedMotionPathId} />
          ))}
        </div>
      )}
    </div>
  );
}
