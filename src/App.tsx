import React, { useEffect, useRef, useState } from 'react';
import { AppProvider, useApp } from './context/AppContext';
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
        if (state.selectedKeyframes.length > 0) {
          e.preventDefault();
          deleteSelectedKeyframes();
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
  }, [dispatch, deleteSelectedKeyframes, state.selectedKeyframes, state.isPlaying, state.svgSource, state.currentTime, state.duration]);

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
  );
}
