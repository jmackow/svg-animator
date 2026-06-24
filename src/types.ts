export type AnimatableProperty = 'x' | 'y' | 'scaleX' | 'scaleY' | 'rotation' | 'opacity' | 'trimStart' | 'trimEnd' | 'fillColor' | 'strokeColor' | 'motionOffset' | 'fillOpacity' | 'strokeOpacity';

export const ALL_PROPERTIES: AnimatableProperty[] = [
  'x', 'y', 'scaleX', 'scaleY', 'rotation', 'opacity', 'trimStart', 'trimEnd', 'fillColor', 'strokeColor', 'motionOffset', 'fillOpacity', 'strokeOpacity',
];

export const PROPERTY_LABELS: Record<AnimatableProperty, string> = {
  x: 'Position X',
  y: 'Position Y',
  scaleX: 'Scale X',
  scaleY: 'Scale Y',
  rotation: 'Rotation',
  opacity: 'Opacity',
  trimStart: 'Trim Start',
  trimEnd: 'Trim End',
  fillColor: 'Fill Color',
  strokeColor: 'Stroke Color',
  motionOffset: 'Motion Offset',
  fillOpacity: 'Fill Opacity',
  strokeOpacity: 'Stroke Opacity',
};

export const PROPERTY_DEFAULTS: Record<AnimatableProperty, number> = {
  x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1, trimStart: 0, trimEnd: 1, fillColor: 0, strokeColor: 0, motionOffset: 0, fillOpacity: 1, strokeOpacity: 1,
};

// ─── Easing ──────────────────────────────────────────────────────────────────

export type EasingPreset = 'linear' | 'ease' | 'ease-in' | 'ease-out' | 'ease-in-out';

export interface PresetEasingConfig {
  type: 'preset';
  name: EasingPreset;
}

export interface BezierEasingConfig {
  type: 'bezier';
  x1: number; // [0,1]
  y1: number; // unconstrained
  x2: number; // [0,1]
  y2: number; // unconstrained
}

export interface SpringEasingConfig {
  type: 'spring';
  stiffness: number; // 1–1000
  damping: number;   // 0.1–100
  mass: number;      // 0.1–10
}

export type EasingConfig = PresetEasingConfig | BezierEasingConfig | SpringEasingConfig;

export const DEFAULT_EASING: EasingConfig = { type: 'preset', name: 'ease' };

// ─── Keyframe / Layer ────────────────────────────────────────────────────────

export interface PropertyKeyframe {
  id: string;
  time: number;
  value: number;
  easing: EasingConfig; // easing FROM this keyframe to the next
}

export type PropertyTracks = Record<AnimatableProperty, PropertyKeyframe[]>;

export interface MotionPath {
  id: string;
  label: string;
  d: string; // SVG path data string (M/L commands only for now)
  visible?: boolean;
}

export interface GradientStop {
  id: string;
  offset: number;  // 0–1
  color: string;   // hex
  opacity: number; // 0–1
}

export interface GradientDef {
  type: 'linear';
  angle: number; // degrees, 0=left→right, 90=top→bottom
  stops: GradientStop[];
}

// ─── Path point animation ─────────────────────────────────────────────────────

export type PointType = 'corner' | 'smooth' | 'asymmetric';

export interface PathPoint {
  id: string;
  x: number; y: number;
  cpInX: number; cpInY: number;   // incoming bezier control point
  cpOutX: number; cpOutY: number; // outgoing bezier control point
  type: PointType;
}

export interface PathKeyframe {
  id: string;
  time: number;
  points: PathPoint[];
  closed: boolean;
  easing: EasingConfig; // easing FROM this keyframe to the next
  movedPointIds?: string[]; // which points were explicitly edited at this keyframe
}

export interface Layer {
  id: string;
  elementId: string;
  tagName: string;
  label: string;
  tracks: PropertyTracks;
  visible: boolean;
  locked: boolean;
  expanded: boolean;
  parentId?: string;
  anchorX: number;    // px from center, default 0
  anchorY: number;    // px from center, default 0
  motionPathId?: string;   // assigned MotionPath id
  autoRotate: boolean;     // default false
  defaultFill?: string;    // hex color read from element on import
  defaultStroke?: string;  // hex color read from element on import
  fillNone?: boolean;
  strokeNone?: boolean;
  skeletonMode?: boolean;
  skeletonColors?: { stroke?: string; strokeOpacity?: number; fill?: string; fillOpacity?: number; anchor?: string; strokeWidth?: number; handleScale?: number; patternSize?: number };
  fillGradient?: GradientDef;
  strokeGradient?: GradientDef;
  pathKeyframes?: PathKeyframe[]; // shape/morph keyframes
  baseValues?: Partial<Record<AnimatableProperty, number>>; // static transform values used when track has no keyframes
}

export interface SelectedKeyframe {
  layerId: string;
  property: AnimatableProperty;
  keyframeId: string;
}

export interface AppState {
  svgSource: string | null;
  layers: Layer[];
  selectedLayerId: string | null;
  selectedKeyframes: SelectedKeyframe[];
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  canvasWidth: number;
  canvasHeight: number;
  zoom: number;
  canvasZoom: number;
  snapEnabled: boolean;
  motionPaths: MotionPath[];
  activeLeftPanel: 'layers' | 'motionPaths';
  selectedMotionPathId: string | null;
  drawingMotionPathId: string | null;
  cmdHoverLayerId: string | null;
  loopPlayback: boolean;
  selectedPointId: string | null;   // selected anchor point id within the selected layer
  selectedPathKfIds: string[];       // selected path keyframe ids (in timeline)
  canvasBackground: string | null;
}
