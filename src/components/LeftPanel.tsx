import React from 'react';
import { useApp } from '../context/AppContext';
import LayerPanel from './LayerPanel';
import MotionPathPanel from './MotionPathPanel';

export default function LeftPanel() {
  const { state, dispatch } = useApp();
  const { activeLeftPanel } = state;

  return (
    <div className="layer-panel">
      {/* Tabs */}
      <div className="layer-panel-tabs">
        <button
          className={`tab-btn ${activeLeftPanel === 'layers' ? 'tab-btn--active' : ''}`}
          onClick={() => dispatch({ type: 'SET_ACTIVE_LEFT_PANEL', panel: 'layers' })}
        >
          Layers
        </button>
        <button
          className={`tab-btn ${activeLeftPanel === 'motionPaths' ? 'tab-btn--active' : ''}`}
          onClick={() => dispatch({ type: 'SET_ACTIVE_LEFT_PANEL', panel: 'motionPaths' })}
        >
          Motion Paths
        </button>
      </div>
      {activeLeftPanel === 'layers' ? <LayerPanel /> : <MotionPathPanel />}
    </div>
  );
}
