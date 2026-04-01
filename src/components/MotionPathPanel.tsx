import React, { useEffect, useState } from 'react';
import { PencilSimple, Trash } from '@phosphor-icons/react';
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

export default function MotionPathPanel() {
  const { state, dispatch } = useApp();
  const { motionPaths, selectedMotionPathId } = state;

  function createPath() {
    const id = `mp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const newPath: MotionPath = { id, label: `Path ${motionPaths.length + 1}`, d: '' };
    dispatch({ type: 'ADD_MOTION_PATH', path: newPath });
    dispatch({ type: 'SET_SELECTED_MOTION_PATH', id });
    dispatch({ type: 'SET_DRAWING_MOTION_PATH', id });
  }

  function deletePath(id: string) {
    dispatch({ type: 'DELETE_MOTION_PATH', id });
  }

  function startDrawing(id: string) {
    dispatch({ type: 'SET_SELECTED_MOTION_PATH', id });
    dispatch({ type: 'SET_DRAWING_MOTION_PATH', id });
  }

  function assignedLayers(pathId: string) {
    return state.layers.filter(l => l.motionPathId === pathId);
  }

  function toggleAssign(layerId: string, pathId: string) {
    const layer = state.layers.find(l => l.id === layerId);
    if (!layer) return;
    if (layer.motionPathId === pathId) {
      dispatch({ type: 'SET_LAYER_MOTION_PATH', layerId, motionPathId: null });
    } else {
      dispatch({ type: 'SET_LAYER_MOTION_PATH', layerId, motionPathId: pathId });
    }
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
          {motionPaths.map(mp => {
            const isSelected = mp.id === selectedMotionPathId;
            return (
              <div key={mp.id} className={`layer-row ${isSelected ? 'layer-row--selected' : ''}`}
                style={{ flexWrap: 'wrap' }}
                onClick={() => dispatch({ type: 'SET_SELECTED_MOTION_PATH', id: mp.id })}>
                <span style={{ flex: 1, fontSize: 12 }}>&#8967; {mp.label}</span>
                <div className="layer-actions">
                  <button className="icon-btn" title="Redraw path" onClick={(e) => { e.stopPropagation(); startDrawing(mp.id); }}><PencilSimple size={14} weight="fill" /></button>
                  <button className="icon-btn" title="Delete path" onClick={(e) => { e.stopPropagation(); deletePath(mp.id); }}><Trash size={14} weight="fill" /></button>
                </div>
                {isSelected && (
                  <div style={{ width: '100%', padding: '4px 8px', borderTop: '1px solid var(--border)', background: 'var(--surface)' }}
                    onClick={e => e.stopPropagation()}>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>Assign to layers:</div>
                    {state.layers.map(layer => (
                      <div key={layer.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', borderBottom: '1px solid var(--border)' }}>
                        <input type="checkbox"
                          checked={layer.motionPathId === mp.id}
                          onChange={() => toggleAssign(layer.id, mp.id)}
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
          })}
        </div>
      )}
    </div>
  );
}
