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
  PathKeyframe,
  PathPoint,
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
  selectedPointId: null,
  selectedPathKfIds: [],
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
  | { type: 'RENAME_MOTION_PATH'; id: string; label: string }
  | { type: 'TOGGLE_MOTION_PATH_VISIBLE'; id: string }
  | { type: 'RENAME_LAYER'; layerId: string; label: string }
  | { type: 'SET_LAYER_DEFAULT_COLORS'; layerId: string; defaultFill?: string; defaultStroke?: string }
  | { type: 'SET_CMD_HOVER_LAYER'; layerId: string | null }
  | { type: 'SET_LAYERS_DEFAULT_COLORS'; updates: Array<{ layerId: string; defaultFill?: string; defaultStroke?: string }> }
  | { type: 'SET_LAYER_GRADIENT'; layerId: string; target: 'fill' | 'stroke'; gradient: GradientDef | null }
  | { type: 'SET_LAYER_COLOR_NONE'; layerId: string; target: 'fill' | 'stroke'; none: boolean }
  | { type: 'SET_LOOP_PLAYBACK'; loop: boolean }
  | { type: 'SELECT_POINT'; pointId: string | null }
  | { type: 'ADD_PATH_KEYFRAME'; layerId: string; keyframe: PathKeyframe }
  | { type: 'UPDATE_PATH_KEYFRAME'; layerId: string; keyframeId: string; points: PathPoint[]; movedPointId?: string }
  | { type: 'DELETE_PATH_KEYFRAME'; layerId: string; keyframeId: string }
  | { type: 'UPDATE_PATH_KEYFRAME_SILENT'; layerId: string; keyframeId: string; points: PathPoint[]; movedPointId?: string }
  | { type: 'MOVE_PATH_KEYFRAME'; layerId: string; keyframeId: string; time: number }
  | { type: 'MOVE_PATH_KEYFRAME_SILENT'; layerId: string; keyframeId: string; time: number }
  | { type: 'SELECT_PATH_KEYFRAMES'; kfIds: string[] }
  | { type: 'ADD_TO_PATH_KF_SELECTION'; kfIds: string[] }
  | { type: 'MERGE_LAYERS'; newLayers: AppState['layers']; newSvgSource: string }
  | { type: 'DELETE_LAYER'; layerId: string; newSvgSource: string }
  | { type: 'REORDER_LAYER'; layerId: string; beforeId: string | null; newSvgSource: string }
  | { type: 'SET_LAYER_BASE_VALUE'; layerId: string; property: AnimatableProperty; value: number }
  | { type: 'SET_LAYER_BASE_VALUE_SILENT'; layerId: string; property: AnimatableProperty; value: number }
  | { type: 'ADD_PROPERTY_KEYFRAME_SILENT'; layerId: string; property: AnimatableProperty; keyframe: PropertyKeyframe }
  | { type: 'SET_LAYER_ANCHOR_SILENT'; layerId: string; anchorX: number; anchorY: number };

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
  'ADD_PATH_KEYFRAME',
  'UPDATE_PATH_KEYFRAME',
  'DELETE_PATH_KEYFRAME',
  'MOVE_PATH_KEYFRAME',
  'MERGE_LAYERS',
  'DELETE_LAYER',
  'REORDER_LAYER',
  'SET_LAYER_BASE_VALUE',
]);

// ─── Layer tree helpers ───────────────────────────────────────────────────────

function collectDescendants(layerId: string, layers: AppState['layers']): string[] {
  const result = [layerId];
  layers.filter(l => l.parentId === layerId).forEach(c => result.push(...collectDescendants(c.id, layers)));
  return result;
}

function collectSubtree(layerId: string, layers: AppState['layers']): AppState['layers'] {
  const layer = layers.find(l => l.id === layerId);
  if (!layer) return [];
  const result: AppState['layers'] = [layer];
  layers.filter(l => l.parentId === layerId).forEach(c => result.push(...collectSubtree(c.id, layers)));
  return result;
}

function findEndOfSiblingGroup(remaining: AppState['layers'], parentId: string | undefined): number {
  const siblingIds = new Set(remaining.filter(l => l.parentId === parentId).map(l => l.id));
  if (siblingIds.size === 0) return remaining.length;
  function isDescendantOfSibling(l: AppState['layers'][0]): boolean {
    if (!l.parentId) return false;
    if (siblingIds.has(l.parentId)) return true;
    const parent = remaining.find(p => p.id === l.parentId);
    return parent ? isDescendantOfSibling(parent) : false;
  }
  let last = -1;
  remaining.forEach((l, i) => { if (siblingIds.has(l.id) || isDescendantOfSibling(l)) last = i; });
  return last + 1;
}

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

    case 'SELECT_LAYER': {
      const sameLayer = action.layerId !== null && action.layerId === state.selectedLayerId;
      return {
        ...state,
        selectedLayerId: action.layerId,
        selectedKeyframes: [],
        selectedPathKfIds: [],
        selectedPointId: sameLayer ? state.selectedPointId : null,
        // Auto-expand newly selected layer so its tracks are visible; don't collapse if re-clicking same layer
        layers: action.layerId && !sameLayer
          ? updateLayer(state.layers, action.layerId, l => ({ ...l, expanded: true }))
          : state.layers,
      };
    }

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
      const selectedPathIds = new Set(state.selectedPathKfIds);
      const newLayers = state.layers.map((layer) => {
        const newTracks = { ...layer.tracks };
        for (const prop of ALL_PROPERTIES) {
          if (newTracks[prop].some((kf) => selectedIds.has(kf.id))) {
            newTracks[prop] = newTracks[prop].filter((kf) => !selectedIds.has(kf.id));
          }
        }
        const newPathKfs = selectedPathIds.size > 0 && layer.pathKeyframes
          ? layer.pathKeyframes.filter((kf) => !selectedPathIds.has(kf.id))
          : layer.pathKeyframes;
        return { ...layer, tracks: newTracks, pathKeyframes: newPathKfs };
      });
      return { ...state, layers: newLayers, selectedKeyframes: [], selectedPathKfIds: [] };
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
    case 'ADD_PROPERTY_KEYFRAME_SILENT':
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
    case 'SET_LAYER_ANCHOR_SILENT':
      return { ...state, layers: updateLayer(state.layers, action.layerId, l => ({ ...l, anchorX: action.anchorX, anchorY: action.anchorY })) };

    case 'SET_ACTIVE_LEFT_PANEL':
      return { ...state, activeLeftPanel: action.panel };

    case 'SET_SELECTED_MOTION_PATH':
      return { ...state, selectedMotionPathId: action.id };

    case 'SET_DRAWING_MOTION_PATH':
      return { ...state, drawingMotionPathId: action.id };

    case 'RENAME_MOTION_PATH':
      return { ...state, motionPaths: state.motionPaths.map(p => p.id === action.id ? { ...p, label: action.label } : p) };

    case 'TOGGLE_MOTION_PATH_VISIBLE':
      return { ...state, motionPaths: state.motionPaths.map(p => p.id === action.id ? { ...p, visible: p.visible === false ? true : false } : p) };

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

    case 'SELECT_POINT':
      return { ...state, selectedPointId: action.pointId };

    case 'ADD_PATH_KEYFRAME':
      return {
        ...state,
        layers: updateLayer(state.layers, action.layerId, l => ({
          ...l,
          pathKeyframes: [...(l.pathKeyframes ?? []), action.keyframe],
        })),
      };

    case 'UPDATE_PATH_KEYFRAME':
    case 'UPDATE_PATH_KEYFRAME_SILENT':
      return {
        ...state,
        layers: updateLayer(state.layers, action.layerId, l => ({
          ...l,
          pathKeyframes: (l.pathKeyframes ?? []).map(kf => {
            if (kf.id !== action.keyframeId) return kf;
            const movedPointIds = action.movedPointId
              ? Array.from(new Set([...(kf.movedPointIds ?? []), action.movedPointId]))
              : kf.movedPointIds;
            return { ...kf, points: action.points, movedPointIds };
          }),
        })),
      };

    case 'DELETE_PATH_KEYFRAME':
      return {
        ...state,
        layers: updateLayer(state.layers, action.layerId, l => ({
          ...l,
          pathKeyframes: (l.pathKeyframes ?? []).filter(kf => kf.id !== action.keyframeId),
        })),
      };

    case 'MOVE_PATH_KEYFRAME':
    case 'MOVE_PATH_KEYFRAME_SILENT':
      return {
        ...state,
        layers: updateLayer(state.layers, action.layerId, l => ({
          ...l,
          pathKeyframes: (l.pathKeyframes ?? []).map(kf =>
            kf.id === action.keyframeId ? { ...kf, time: action.time } : kf
          ),
        })),
      };

    case 'SELECT_PATH_KEYFRAMES':
      return { ...state, selectedPathKfIds: action.kfIds };

    case 'ADD_TO_PATH_KF_SELECTION':
      return { ...state, selectedPathKfIds: Array.from(new Set([...state.selectedPathKfIds, ...action.kfIds])) };

    case 'MERGE_LAYERS':
      return { ...state, svgSource: action.newSvgSource, layers: [...state.layers, ...action.newLayers] };

    case 'DELETE_LAYER': {
      const deletedIds = new Set(collectDescendants(action.layerId, state.layers));
      return {
        ...state,
        svgSource: action.newSvgSource,
        layers: state.layers.filter(l => !deletedIds.has(l.id)),
        selectedLayerId: deletedIds.has(state.selectedLayerId ?? '') ? null : state.selectedLayerId,
        selectedKeyframes: state.selectedKeyframes.filter(kf => !deletedIds.has(kf.layerId)),
        selectedPathKfIds: [],
      };
    }

    case 'REORDER_LAYER': {
      const subtree = collectSubtree(action.layerId, state.layers);
      const subtreeIds = new Set(subtree.map(l => l.id));
      const remaining = state.layers.filter(l => !subtreeIds.has(l.id));
      const insertIdx = action.beforeId !== null
        ? remaining.findIndex(l => l.id === action.beforeId)
        : findEndOfSiblingGroup(remaining, subtree[0]?.parentId);
      const idx = insertIdx === -1 ? remaining.length : insertIdx;
      return {
        ...state,
        svgSource: action.newSvgSource,
        layers: [...remaining.slice(0, idx), ...subtree, ...remaining.slice(idx)],
      };
    }

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

    case 'SET_LAYER_COLOR_NONE':
      return {
        ...state,
        layers: updateLayer(state.layers, action.layerId, l => ({
          ...l,
          ...(action.target === 'fill'
            ? { fillNone: action.none }
            : { strokeNone: action.none }),
        })),
      };

    case 'SET_LAYER_BASE_VALUE':
    case 'SET_LAYER_BASE_VALUE_SILENT':
      return {
        ...state,
        layers: updateLayer(state.layers, action.layerId, l => ({
          ...l,
          baseValues: { ...l.baseValues, [action.property]: action.value },
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

type HistoryAction = Action | { type: 'UNDO' } | { type: 'REDO' } | { type: 'PUSH_SNAPSHOT' };

function historyReducer(history: History, action: HistoryAction): History {
  if (action.type === 'PUSH_SNAPSHOT') {
    return {
      past: [...history.past, history.present].slice(-MAX_HISTORY),
      present: history.present,
      future: [],
    };
  }

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
  getOrCreateKfAt: (layerId: string, property: AnimatableProperty, time: number, silent?: boolean) => string;
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
        const defaultVal = layer.tracks[property].length === 0
          ? (layer.baseValues?.[property] ?? PROPERTY_DEFAULTS[property])
          : PROPERTY_DEFAULTS[property];
        const value = interpolateProperty(
          layer.tracks[property],
          state.currentTime,
          defaultVal
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
    if (state.selectedKeyframes.length === 0 && state.selectedPathKfIds.length === 0) return;
    dispatch({ type: 'DELETE_SELECTED_KFS' });
  }, [state.selectedKeyframes, state.selectedPathKfIds]);

  const getOrCreateKfAt = useCallback(
    (layerId: string, property: AnimatableProperty, time: number, silent = false): string => {
      const layer = state.layers.find((l) => l.id === layerId);
      if (!layer) return '';

      // Check for existing KF within 0.001s
      const existing = layer.tracks[property].find(
        (kf) => Math.abs(kf.time - time) < 0.001
      );
      if (existing) return existing.id;

      // Create new KF with interpolated value (or base value when no keyframes yet)
      const defaultVal = layer.tracks[property].length === 0
        ? (layer.baseValues?.[property] ?? PROPERTY_DEFAULTS[property])
        : PROPERTY_DEFAULTS[property];
      const value = interpolateProperty(
        layer.tracks[property],
        time,
        defaultVal
      );
      const kf: PropertyKeyframe = {
        id: `kf-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        time,
        value,
        easing: DEFAULT_EASING,
      };
      dispatch({ type: silent ? 'ADD_PROPERTY_KEYFRAME_SILENT' : 'ADD_PROPERTY_KEYFRAME', layerId, property, keyframe: kf });
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
