import React from 'react';
import { useApp } from '../context/AppContext';
import LayerPanel from './LayerPanel';
import MotionPathPanel from './MotionPathPanel';

export default function LeftPanel() {
  const { state, dispatch } = useApp();
  const { activeLeftPanel } = state;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: 'var(--layer-panel-w)', background: 'var(--surface)', overflow: 'hidden' }}>
      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <button
          className={`left-panel-tab ${activeLeftPanel === 'layers' ? 'left-panel-tab--active' : ''}`}
          onClick={() => dispatch({ type: 'SET_ACTIVE_LEFT_PANEL', panel: 'layers' })}
        >
          Layers
        </button>
        <button
          className={`left-panel-tab ${activeLeftPanel === 'motionPaths' ? 'left-panel-tab--active' : ''}`}
          onClick={() => dispatch({ type: 'SET_ACTIVE_LEFT_PANEL', panel: 'motionPaths' })}
        >
          Motion Paths
        </button>
      </div>
      {activeLeftPanel === 'layers' ? <LayerPanel /> : <MotionPathPanel />}
    </div>
  );
}
