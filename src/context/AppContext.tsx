import React, {
  createContext,
  useContext,
  useReducer,
  useCallback,
  ReactNode,
} from 'react';
import {
  AppState,
  PropertyKeyframe,
  AnimatableProperty,
  SelectedKeyframe,
  ALL_PROPERTIES,
  PROPERTY_DEFAULTS,
  PropertyTracks,
  DEFAULT_EASING,
  EasingConfig,
  MotionPath,
  GradientDef,
} from '../types';
import { interpolateProperty } from '../utils/interpolate';

// ─── Initial state ────────────────────────────────────────────────────────────

export function emptyTracks(): PropertyTracks {
  const t = {} as PropertyTracks;
  for (const p of ALL_PROPERTIES) t[p] = [];
  return t;
}

const initialState: AppState = {
  svgSource: null,
  layers: [],
  selectedLayerId: null,
  selectedKeyframes: [],
  currentTime: 0,
  duration: 3,
  isPlaying: false,
  canvasWidth: 800,
  canvasHeight: 600,
  zoom: 120,
  canvasZoom: 1,
  snapEnabled: true,
  motionPaths: [],
  activeLeftPanel: 'layers',
  selectedMotionPathId: null,
  drawingMotionPathId: null,
  cmdHoverLayerId: null,
  loopPlayback: false,
};

// ─── Actions ──────────────────────────────────────────────────────────────────

export type Action =
  | { type: 'LOAD_SVG'; svgSource: string; layers: AppState['layers'] }
  | { type: 'LOAD_PROJECT'; svgSource: string; layers: AppState['layers']; duration: number; canvasWidth: number; canvasHeight: number; motionPaths?: MotionPath[] }
  | { type: 'SELECT_LAYER'; layerId: string | null }
  | { type: 'SELECT_KEYFRAMES'; kfs: SelectedKeyframe[] }
  | { type: 'ADD_TO_KEYFRAME_SELECTION'; kfs: SelectedKeyframe[] }
  | { type: 'MOVE_SELECTED_KFS_DELTA'; delta: number }
  | { type: 'DELETE_SELECTED_KFS' }
  | { type: 'SET_SELECTED_KFS_EASING'; easing: EasingConfig }
  | { type: 'SET_TIME'; time: number }
  | { type: 'SET_PLAYING'; playing: boolean }
  | { type: 'SET_DURATION'; duration: number }
  | { type: 'SET_CANVAS_SIZE'; width: number; height: number }
  | { type: 'SET_ZOOM'; zoom: number }
  | { type: 'TOGGLE_SNAP' }
  | { type: 'TOGGLE_LAYER_EXPANDED'; layerId: string }
  | { type: 'TOGGLE_LAYER_VISIBILITY'; layerId: string }
  | { type: 'TOGGLE_LAYER_LOCK'; layerId: string }
  | { type: 'ADD_PROPERTY_KEYFRAME'; layerId: string; property: AnimatableProperty; keyframe: PropertyKeyframe }
  | { type: 'UPDATE_PROPERTY_KEYFRAME'; layerId: string; property: AnimatableProperty; keyframeId: string; value?: number; easing?: EasingConfig }
  | { type: 'UPDATE_PROPERTY_KEYFRAME_SILENT'; layerId: string; property: AnimatableProperty; keyframeId: string; value?: number; easing?: EasingConfig }
  | { type: 'DELETE_PROPERTY_KEYFRAME'; layerId: string; property: AnimatableProperty; keyframeId: string }
  | { type: 'MOVE_PROPERTY_KEYFRAME'; layerId: string; property: AnimatableProperty; keyframeId: string; time: number }
  | { type: 'MOVE_PROPERTY_KEYFRAME_SILENT'; layerId: string; property: AnimatableProperty; keyframeId: string; time: number }
  | { type: 'SET_CANVAS_ZOOM'; zoom: number }
  | { type: 'ADD_MOTION_PATH'; path: MotionPath }
  | { type: 'UPDATE_MOTION_PATH_D'; id: string; d: string }
  | { type: 'DELETE_MOTION_PATH'; id: string }
  | { type: 'SET_LAYER_MOTION_PATH'; layerId: string; motionPathId: string | null }
  | { type: 'SET_LAYER_AUTO_ROTATE'; layerId: string; autoRotate: boolean }
  | { type: 'SET_LAYER_ANCHOR'; layerId: string; anchorX: number; anchorY: number }
  | { type: 'SET_ACTIVE_LEFT_PANEL'; panel: 'layers' | 'motionPaths' }
  | { type: 'SET_SELECTED_MOTION_PATH'; id: string | null }
  | { type: 'SET_DRAWING_MOTION_PATH'; id: string | null }
  | { type: 'RENAME_LAYER'; layerId: string; label: string }
  | { type: 'SET_LAYER_DEFAULT_COLORS'; layerId: string; defaultFill?: string; defaultStroke?: string }
  | { type: 'SET_CMD_HOVER_LAYER'; layerId: string | null }
  | { type: 'SET_LAYERS_DEFAULT_COLORS'; updates: Array<{ layerId: string; defaultFill?: string; defaultStroke?: string }> }
  | { type: 'SET_LAYER_GRADIENT'; layerId: string; target: 'fill' | 'stroke'; gradient: GradientDef | null }
  | { type: 'SET_LOOP_PLAYBACK'; loop: boolean };

// Actions that push to history
const UNDOABLE = new Set<Action['type']>([
  'RENAME_LAYER',
  'LOAD_SVG',
  'ADD_PROPERTY_KEYFRAME',
  'UPDATE_PROPERTY_KEYFRAME',
  'DELETE_PROPERTY_KEYFRAME',
  'MOVE_PROPERTY_KEYFRAME',
  'MOVE_SELECTED_KFS_DELTA',
  'DELETE_SELECTED_KFS',
  'SET_SELECTED_KFS_EASING',
  'TOGGLE_LAYER_VISIBILITY',
  'TOGGLE_LAYER_LOCK',
  'ADD_MOTION_PATH',
  'UPDATE_MOTION_PATH_D',
  'DELETE_MOTION_PATH',
  'SET_LAYER_MOTION_PATH',
  'SET_LAYER_ANCHOR',
  'SET_LAYER_AUTO_ROTATE',
]);

// ─── Core reducer ─────────────────────────────────────────────────────────────

function updateLayer(
  layers: AppState['layers'],
  layerId: string,
  fn: (l: AppState['layers'][0]) => AppState['layers'][0]
): AppState['layers'] {
  return layers.map((l) => (l.id === layerId ? fn(l) : l));
}

function updateTrack(
  layer: AppState['layers'][0],
  property: AnimatableProperty,
  fn: (kfs: PropertyKeyframe[]) => PropertyKeyframe[]
): AppState['layers'][0] {
  return { ...layer, tracks: { ...layer.tracks, [property]: fn(layer.tracks[property]) } };
}

function coreReducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'LOAD_SVG':
      return { ...state, svgSource: action.svgSource, layers: action.layers, selectedLayerId: null, selectedKeyframes: [], currentTime: 0, drawingMotionPathId: null };

    case 'LOAD_PROJECT':
      return { ...state, svgSource: action.svgSource, layers: action.layers, duration: action.duration, canvasWidth: action.canvasWidth, canvasHeight: action.canvasHeight, selectedLayerId: null, selectedKeyframes: [], currentTime: 0, isPlaying: false, motionPaths: action.motionPaths ?? [], drawingMotionPathId: null };

    case 'SELECT_LAYER':
      return { ...state, selectedLayerId: action.layerId, selectedKeyframes: [] };

    case 'SELECT_KEYFRAMES':
      return { ...state, selectedKeyframes: action.kfs };

    case 'ADD_TO_KEYFRAME_SELECTION': {
      // Merge, avoiding duplicates by keyframeId
      const existingIds = new Set(state.selectedKeyframes.map((k) => k.keyframeId));
      const newOnes = action.kfs.filter((k) => !existingIds.has(k.keyframeId));
      return { ...state, selectedKeyframes: [...state.selectedKeyframes, ...newOnes] };
    }

    case 'MOVE_SELECTED_KFS_DELTA': {
      const { duration } = state;
      const delta = action.delta;
      const selectedIds = new Set(state.selectedKeyframes.map((k) => k.keyframeId));
      const newLayers = state.layers.map((layer) => {
        const newTracks = { ...layer.tracks };
        for (const prop of ALL_PROPERTIES) {
          if (newTracks[prop].some((kf) => selectedIds.has(kf.id))) {
            newTracks[prop] = newTracks[prop].map((kf) =>
              selectedIds.has(kf.id)
                ? { ...kf, time: Math.max(0, Math.min(duration, kf.time + delta)) }
                : kf
            );
          }
        }
        return { ...layer, tracks: newTracks };
      });
      return { ...state, layers: newLayers };
    }

    case 'DELETE_SELECTED_KFS': {
      const selectedIds = new Set(state.selectedKeyframes.map((k) => k.keyframeId));
      const newLayers = state.layers.map((layer) => {
        const newTracks = { ...layer.tracks };
        for (const prop of ALL_PROPERTIES) {
          if (newTracks[prop].some((kf) => selectedIds.has(kf.id))) {
            newTracks[prop] = newTracks[prop].filter((kf) => !selectedIds.has(kf.id));
          }
        }
        return { ...layer, tracks: newTracks };
      });
      return { ...state, layers: newLayers, selectedKeyframes: [] };
    }

    case 'SET_SELECTED_KFS_EASING': {
      const selectedIds = new Set(state.selectedKeyframes.map((k) => k.keyframeId));
      const newLayers = state.layers.map((layer) => {
        const newTracks = { ...layer.tracks };
        for (const prop of ALL_PROPERTIES) {
          if (newTracks[prop].some((kf) => selectedIds.has(kf.id))) {
            newTracks[prop] = newTracks[prop].map((kf) =>
              selectedIds.has(kf.id) ? { ...kf, easing: action.easing } : kf
            );
          }
        }
        return { ...layer, tracks: newTracks };
      });
      return { ...state, layers: newLayers };
    }

    case 'SET_TIME':
      return { ...state, currentTime: Math.max(0, Math.min(state.duration, action.time)) };

    case 'SET_PLAYING':
      return { ...state, isPlaying: action.playing };

    case 'SET_DURATION':
      return { ...state, duration: Math.max(0.5, action.duration) };

    case 'SET_CANVAS_SIZE':
      return { ...state, canvasWidth: action.width, canvasHeight: action.height };

    case 'SET_ZOOM':
      return { ...state, zoom: Math.max(40, Math.min(600, action.zoom)) };

    case 'TOGGLE_SNAP':
      return { ...state, snapEnabled: !state.snapEnabled };

    case 'TOGGLE_LAYER_EXPANDED':
      return { ...state, layers: updateLayer(state.layers, action.layerId, (l) => ({ ...l, expanded: !l.expanded })) };

    case 'TOGGLE_LAYER_VISIBILITY':
      return { ...state, layers: updateLayer(state.layers, action.layerId, (l) => ({ ...l, visible: !l.visible })) };

    case 'TOGGLE_LAYER_LOCK':
      return { ...state, layers: updateLayer(state.layers, action.layerId, (l) => ({ ...l, locked: !l.locked })) };

    case 'ADD_PROPERTY_KEYFRAME':
      return {
        ...state,
        layers: updateLayer(state.layers, action.layerId, (l) =>
          updateTrack(l, action.property, (kfs) => [...kfs, action.keyframe])
        ),
      };

    case 'UPDATE_PROPERTY_KEYFRAME':
    case 'UPDATE_PROPERTY_KEYFRAME_SILENT':
      return {
        ...state,
        layers: updateLayer(state.layers, action.layerId, (l) =>
          updateTrack(l, action.property, (kfs) =>
            kfs.map((kf) =>
              kf.id === action.keyframeId
                ? {
                    ...kf,
                    ...(action.value !== undefined ? { value: action.value } : {}),
                    ...(action.easing !== undefined ? { easing: action.easing } : {}),
                  }
                : kf
            )
          )
        ),
      };

    case 'DELETE_PROPERTY_KEYFRAME': {
      const newSelectedKfs = state.selectedKeyframes.filter(
        (s) =>
          !(s.layerId === action.layerId &&
            s.property === action.property &&
            s.keyframeId === action.keyframeId)
      );
      return {
        ...state,
        selectedKeyframes: newSelectedKfs,
        layers: updateLayer(state.layers, action.layerId, (l) =>
          updateTrack(l, action.property, (kfs) => kfs.filter((kf) => kf.id !== action.keyframeId))
        ),
      };
    }

    case 'MOVE_PROPERTY_KEYFRAME':
    case 'MOVE_PROPERTY_KEYFRAME_SILENT':
      return {
        ...state,
        layers: updateLayer(state.layers, action.layerId, (l) =>
          updateTrack(l, action.property, (kfs) =>
            kfs.map((kf) =>
              kf.id === action.keyframeId
                ? { ...kf, time: Math.max(0, Math.min(state.duration, action.time)) }
                : kf
            )
          )
        ),
      };

    case 'SET_CANVAS_ZOOM':
      return { ...state, canvasZoom: Math.max(0.1, Math.min(4, action.zoom)) };

    case 'ADD_MOTION_PATH':
      return { ...state, motionPaths: [...state.motionPaths, action.path] };

    case 'UPDATE_MOTION_PATH_D':
      return { ...state, motionPaths: state.motionPaths.map(p => p.id === action.id ? { ...p, d: action.d } : p) };

    case 'DELETE_MOTION_PATH':
      return {
        ...state,
        motionPaths: state.motionPaths.filter(p => p.id !== action.id),
        layers: state.layers.map(l => l.motionPathId === action.id ? { ...l, motionPathId: undefined } : l),
        selectedMotionPathId: state.selectedMotionPathId === action.id ? null : state.selectedMotionPathId,
      };

    case 'SET_LAYER_MOTION_PATH':
      return { ...state, layers: updateLayer(state.layers, action.layerId, l => ({ ...l, motionPathId: action.motionPathId ?? undefined })) };

    case 'SET_LAYER_AUTO_ROTATE':
      return { ...state, layers: updateLayer(state.layers, action.layerId, l => ({ ...l, autoRotate: action.autoRotate })) };

    case 'SET_LAYER_ANCHOR':
      return { ...state, layers: updateLayer(state.layers, action.layerId, l => ({ ...l, anchorX: action.anchorX, anchorY: action.anchorY })) };

    case 'SET_ACTIVE_LEFT_PANEL':
      return { ...state, activeLeftPanel: action.panel };

    case 'SET_SELECTED_MOTION_PATH':
      return { ...state, selectedMotionPathId: action.id };

    case 'SET_DRAWING_MOTION_PATH':
      return { ...state, drawingMotionPathId: action.id };

    case 'RENAME_LAYER':
      return { ...state, layers: updateLayer(state.layers, action.layerId, l => ({ ...l, label: action.label })) };

    case 'SET_LAYER_DEFAULT_COLORS':
      return {
        ...state,
        layers: updateLayer(state.layers, action.layerId, l => ({
          ...l,
          ...(action.defaultFill !== undefined ? { defaultFill: action.defaultFill } : {}),
          ...(action.defaultStroke !== undefined ? { defaultStroke: action.defaultStroke } : {}),
        })),
      };

    case 'SET_LAYERS_DEFAULT_COLORS':
      return {
        ...state,
        layers: state.layers.map(l => {
          const upd = action.updates.find(u => u.layerId === l.id);
          if (!upd) return l;
          return {
            ...l,
            ...(upd.defaultFill !== undefined ? { defaultFill: upd.defaultFill } : {}),
            ...(upd.defaultStroke !== undefined ? { defaultStroke: upd.defaultStroke } : {}),
          };
        }),
      };

    case 'SET_CMD_HOVER_LAYER':
      return { ...state, cmdHoverLayerId: action.layerId };

    case 'SET_LOOP_PLAYBACK':
      return { ...state, loopPlayback: action.loop };

    case 'SET_LAYER_GRADIENT':
      return {
        ...state,
        layers: updateLayer(state.layers, action.layerId, l => ({
          ...l,
          ...(action.target === 'fill'
            ? { fillGradient: action.gradient ?? undefined }
            : { strokeGradient: action.gradient ?? undefined }),
        })),
      };

    default:
      return state;
  }
}

// ─── History wrapper ──────────────────────────────────────────────────────────

const MAX_HISTORY = 60;

interface History {
  past: AppState[];
  present: AppState;
  future: AppState[];
}

type HistoryAction = Action | { type: 'UNDO' } | { type: 'REDO' };

function historyReducer(history: History, action: HistoryAction): History {
  if (action.type === 'UNDO') {
    if (history.past.length === 0) return history;
    const previous = history.past[history.past.length - 1];
    return {
      past: history.past.slice(0, -1),
      present: previous,
      future: [history.present, ...history.future].slice(0, MAX_HISTORY),
    };
  }

  if (action.type === 'REDO') {
    if (history.future.length === 0) return history;
    const [next, ...rest] = history.future;
    return {
      past: [...history.past, history.present].slice(-MAX_HISTORY),
      present: next,
      future: rest,
    };
  }

  const newPresent = coreReducer(history.present, action as Action);

  if (UNDOABLE.has((action as Action).type)) {
    return {
      past: [...history.past, history.present].slice(-MAX_HISTORY),
      present: newPresent,
      future: [],
    };
  }

  return { ...history, present: newPresent };
}

// ─── Context ──────────────────────────────────────────────────────────────────

interface AppContextValue {
  state: AppState;
  dispatch: React.Dispatch<HistoryAction>;
  canUndo: boolean;
  canRedo: boolean;
  togglePropertyKeyframe: (layerId: string, property: AnimatableProperty) => void;
  deleteSelectedKeyframes: () => void;
  getOrCreateKfAt: (layerId: string, property: AnimatableProperty, time: number) => string;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [history, dispatch] = useReducer(historyReducer, {
    past: [],
    present: initialState,
    future: [],
  });

  const state = history.present;

  const togglePropertyKeyframe = useCallback(
    (layerId: string, property: AnimatableProperty) => {
      const layer = state.layers.find((l) => l.id === layerId);
      if (!layer || layer.locked) return;

      const existing = layer.tracks[property].find(
        (kf) => Math.abs(kf.time - state.currentTime) < 0.001
      );

      if (existing) {
        dispatch({ type: 'DELETE_PROPERTY_KEYFRAME', layerId, property, keyframeId: existing.id });
      } else {
        const value = interpolateProperty(
          layer.tracks[property],
          state.currentTime,
          PROPERTY_DEFAULTS[property]
        );
        const kf: PropertyKeyframe = {
          id: `kf-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          time: state.currentTime,
          value,
          easing: DEFAULT_EASING,
        };
        dispatch({ type: 'ADD_PROPERTY_KEYFRAME', layerId, property, keyframe: kf });
        dispatch({ type: 'SELECT_KEYFRAMES', kfs: [{ layerId, property, keyframeId: kf.id }] });
      }
    },
    [state.layers, state.currentTime]
  );

  const deleteSelectedKeyframes = useCallback(() => {
    if (state.selectedKeyframes.length === 0) return;
    dispatch({ type: 'DELETE_SELECTED_KFS' });
  }, [state.selectedKeyframes]);

  const getOrCreateKfAt = useCallback(
    (layerId: string, property: AnimatableProperty, time: number): string => {
      const layer = state.layers.find((l) => l.id === layerId);
      if (!layer) return '';

      // Check for existing KF within 0.001s
      const existing = layer.tracks[property].find(
        (kf) => Math.abs(kf.time - time) < 0.001
      );
      if (existing) return existing.id;

      // Create new KF with interpolated value
      const value = interpolateProperty(
        layer.tracks[property],
        time,
        PROPERTY_DEFAULTS[property]
      );
      const kf: PropertyKeyframe = {
        id: `kf-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        time,
        value,
        easing: DEFAULT_EASING,
      };
      dispatch({ type: 'ADD_PROPERTY_KEYFRAME', layerId, property, keyframe: kf });
      return kf.id;
    },
    [state.layers, state.currentTime] // eslint-disable-line react-hooks/exhaustive-deps
  );

  return (
    <AppContext.Provider
      value={{
        state,
        dispatch,
        canUndo: history.past.length > 0,
        canRedo: history.future.length > 0,
        togglePropertyKeyframe,
        deleteSelectedKeyframes,
        getOrCreateKfAt,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
