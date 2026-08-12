import React, { useRef, useEffect, useCallback, useState } from 'react';
import { useApp } from '../context/AppContext';
import { GradientDef } from '../types';
import { getLayerValues, unpackColor } from '../utils/interpolate';
import { interpolatePathPoints, buildPath } from '../utils/pathPoints';

function applyGradientToDefs(svgEl: SVGSVGElement, gradId: string, grad: GradientDef): string {
  const ns = 'http://www.w3.org/2000/svg';
  let defs = svgEl.querySelector('defs');
  if (!defs) { defs = document.createElementNS(ns, 'defs'); svgEl.insertBefore(defs, svgEl.firstChild); }
  let el = defs.querySelector(`#${gradId}`) as SVGLinearGradientElement | null;
  if (!el) {
    el = document.createElementNS(ns, 'linearGradient') as SVGLinearGradientElement;
    el.setAttribute('id', gradId);
    el.setAttribute('gradientUnits', 'objectBoundingBox');
    defs.appendChild(el);
  }
  // angle → x1/y1/x2/y2 in objectBoundingBox
  const rad = (grad.angle * Math.PI) / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  el.setAttribute('x1', String(0.5 - cos / 2));
  el.setAttribute('y1', String(0.5 - sin / 2));
  el.setAttribute('x2', String(0.5 + cos / 2));
  el.setAttribute('y2', String(0.5 + sin / 2));
  // rebuild stops
  while (el.firstChild) el.removeChild(el.firstChild);
  for (const stop of grad.stops) {
    const s = document.createElementNS(ns, 'stop');
    s.setAttribute('offset', String(stop.offset));
    s.setAttribute('stop-color', stop.color);
    s.setAttribute('stop-opacity', String(stop.opacity));
    el.appendChild(s);
  }
  return `url(#${gradId})`;
}

function removeGradFromDefs(svgEl: SVGSVGElement, gradId: string) {
  svgEl.querySelector(`defs #${gradId}`)?.remove();
}

function upsertSkeletonHatch(svgEl: SVGSVGElement, elementId: string, fillHex: string, patternSize: number) {
  const HATCH_ID = `svga-skeleton-hatch-${elementId}`;
  const ns = 'http://www.w3.org/2000/svg';
  let defs = svgEl.querySelector('defs');
  if (!defs) { defs = document.createElementNS(ns, 'defs'); svgEl.insertBefore(defs, svgEl.firstChild); }
  let pat = defs.querySelector(`#${HATCH_ID}`) as SVGPatternElement | null;
  // Recreate pattern when size changes (can't resize just by changing attributes on existing lines)
  const currentSize = pat ? parseFloat(pat.getAttribute('width') ?? '0') : -1;
  if (!pat || currentSize !== patternSize) {
    pat?.remove();
    pat = document.createElementNS(ns, 'pattern') as SVGPatternElement;
    pat.setAttribute('id', HATCH_ID);
    pat.setAttribute('patternUnits', 'userSpaceOnUse');
    pat.setAttribute('width', String(patternSize));
    pat.setAttribute('height', String(patternSize));
    const ps = patternSize;
    const half = ps / 2;
    for (const [x1, y1, x2, y2] of [[0, ps, ps, 0], [-half, half, half, -half], [half, ps + half, ps + half, half]] as [number,number,number,number][]) {
      const l = document.createElementNS(ns, 'line');
      l.setAttribute('x1', String(x1)); l.setAttribute('y1', String(y1));
      l.setAttribute('x2', String(x2)); l.setAttribute('y2', String(y2));
      l.setAttribute('stroke-width', '1.5');
      l.setAttribute('stroke-linecap', 'square');
      pat.appendChild(l);
    }
    defs.appendChild(pat);
  }
  // Update line color (pure hex — element fill-opacity controls transparency)
  for (const l of Array.from(pat.querySelectorAll('line'))) {
    l.setAttribute('stroke', fillHex);
  }
}

function removeSkeletonHatch(svgEl: SVGSVGElement, elementId: string) {
  svgEl.querySelector(`defs #svga-skeleton-hatch-${elementId}`)?.remove();
}
import TransformOverlay from './TransformOverlay';
import MotionPathOverlay from './MotionPathOverlay';
import CmdHoverOverlay from './CmdHoverOverlay';
import PathPointOverlay from './PathPointOverlay';
import SnapGuideOverlay from './SnapGuideOverlay';
import SkeletonOverlay from './SkeletonOverlay';
import { SnapProvider } from '../context/SnapContext';

// Parse the first M coordinate from an SVG path data string
function parsePathStart(d: string): { x: number; y: number } | null {
  const m = d.match(/[Mm]\s*([-\d.]+)[,\s]+([-\d.]+)/);
  if (!m) return null;
  return { x: parseFloat(m[1]), y: parseFloat(m[2]) };
}

// Convert any CSS/SVG color string to #rrggbb hex (best effort)
function svgColorToHex(color: string): string | undefined {
  if (!color || color === 'none' || color === 'transparent' || color.startsWith('url(')) return undefined;
  if (/^#[0-9a-f]{3,6}$/i.test(color)) {
    // Normalise 3-digit hex
    if (color.length === 4) {
      const [, r, g, b] = color;
      return `#${r}${r}${g}${g}${b}${b}`;
    }
    return color.toLowerCase();
  }
  const rgb = color.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/i);
  if (rgb) {
    return '#' + [rgb[1], rgb[2], rgb[3]].map(n => parseInt(n).toString(16).padStart(2, '0')).join('');
  }
  // Named color: use a temporary div
  try {
    const div = document.createElement('div');
    div.style.color = color;
    document.body.appendChild(div);
    const computed = window.getComputedStyle(div).color;
    document.body.removeChild(div);
    const m2 = computed.match(/\d+/g);
    if (m2 && m2.length >= 3) {
      return '#' + m2.slice(0, 3).map(n => parseInt(n).toString(16).padStart(2, '0')).join('');
    }
  } catch { /* ignore */ }
  return undefined;
}

function isInputEl(el: Element | null): boolean {
  return (
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    (el instanceof HTMLElement && el.isContentEditable)
  );
}

export default function Canvas() {
  const { state, dispatch } = useApp();
  const svgContainerRef = useRef<HTMLDivElement>(null);
  const canvasFrameRef = useRef<HTMLDivElement>(null);
  const canvasAreaRef = useRef<HTMLDivElement>(null);

  // Marquee rect in client coords (null when not dragging)
  const [marquee, setMarquee] = useState<{ left: number; top: number; right: number; bottom: number } | null>(null);

  // Pan state
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const panXRef = useRef(0);
  const panYRef = useRef(0);
  const spaceHeldRef = useRef(false);
  const mouseOverCanvasRef = useRef(false);
  const panDragRef = useRef<{ startX: number; startY: number; startPanX: number; startPanY: number } | null>(null);
  const pannedRef = useRef(false);
  const canvasZoomRef = useRef(state.canvasZoom);

  // Stable refs so event handlers don't go stale across layer/time changes
  const layersRef = useRef(state.layers);
  const motionPathsRef = useRef(state.motionPaths);
  const stateRef = useRef(state);
  const cmdHoverLayerIdLocalRef = useRef<string | null>(null); // local dedup

  useEffect(() => { layersRef.current = state.layers; }, [state.layers]);
  useEffect(() => { motionPathsRef.current = state.motionPaths; }, [state.motionPaths]);
  useEffect(() => { stateRef.current = state; }, [state]);
  useEffect(() => { panXRef.current = panX; }, [panX]);
  useEffect(() => { panYRef.current = panY; }, [panY]);
  useEffect(() => { canvasZoomRef.current = state.canvasZoom; }, [state.canvasZoom]);

  // Space key → pan mode. Use capture phase so we intercept before App's play/pause handler,
  // but only when mouse is actually over the canvas.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === ' ' && mouseOverCanvasRef.current && !isInputEl(document.activeElement)) {
        if (!spaceHeldRef.current) {
          spaceHeldRef.current = true;
          setSpaceHeld(true);
        }
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    }
    function onKeyUp(e: KeyboardEvent) {
      if (e.key === ' ' && spaceHeldRef.current) {
        spaceHeldRef.current = false;
        setSpaceHeld(false);
        panDragRef.current = null;
      }
    }
    window.addEventListener('keydown', onKeyDown, { capture: true });
    window.addEventListener('keyup', onKeyUp, { capture: true });
    return () => {
      window.removeEventListener('keydown', onKeyDown, { capture: true });
      window.removeEventListener('keyup', onKeyUp, { capture: true });
    };
  }, []);

  // Wheel → zoom (ctrl/meta) or touchpad pan (plain scroll)
  useEffect(() => {
    const el = canvasAreaRef.current;
    if (!el) return;
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const factor = e.deltaY < 0 ? 1.1 : 0.9;
        dispatch({ type: 'SET_CANVAS_ZOOM', zoom: canvasZoomRef.current * factor });
      } else {
        setPanX((px) => px - e.deltaX);
        setPanY((py) => py - e.deltaY);
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [dispatch]);

  const applyTransforms = useCallback(() => {
    const container = svgContainerRef.current;
    if (!container) return;
    const svgEl = container.querySelector('svg');
    if (!svgEl) return;

    for (const layer of state.layers) {
      const el = svgEl.getElementById(layer.elementId);
      if (!el) continue;
      const s = (el as unknown as HTMLElement).style;

      if (!layer.visible) {
        s.display = 'none';
        continue;
      }
      s.display = '';

      const vals = getLayerValues(layer, state.currentTime);
      s.transformBox = 'fill-box';
      const ax = layer.anchorX ?? 0;
      const ay = layer.anchorY ?? 0;
      s.transformOrigin = `calc(50% + ${ax}px) calc(50% + ${ay}px)`;

      // Trim path
      const hasTrimKfs = layer.tracks.trimStart.length > 0 || layer.tracks.trimEnd.length > 0;
      if (hasTrimKfs) {
        try {
          const totalLen = (el as unknown as SVGGeometryElement).getTotalLength();
          const ts = vals.trimStart;
          const te = vals.trimEnd;
          const seg = Math.max(0, te - ts) * totalLen;
          s.strokeDasharray = `${seg} ${totalLen}`;
          s.strokeDashoffset = String(-ts * totalLen);
        } catch {
          // element doesn't support getTotalLength, skip
        }
      } else {
        s.strokeDasharray = '';
        s.strokeDashoffset = '';
      }

      // Fill / stroke color
      const fillGradId = `svga-fg-${layer.elementId}`;
      const strokeGradId = `svga-sg-${layer.elementId}`;
      if (layer.skeletonMode) {
        const sk = layer.skeletonColors ?? {};
        const skFill        = sk.fill        ?? '#ffffff';
        const skStroke      = sk.stroke      ?? '#ffffff';
        const skPatternSize = sk.patternSize ?? 8;
        upsertSkeletonHatch(svgEl as SVGSVGElement, layer.elementId, skFill, skPatternSize);
        removeGradFromDefs(svgEl as SVGSVGElement, fillGradId);
        removeGradFromDefs(svgEl as SVGSVGElement, strokeGradId);
        s.fill        = `url(#svga-skeleton-hatch-${layer.elementId})`;
        s.fillOpacity = String(sk.fillOpacity   ?? 0.32);
        s.stroke      = skStroke;
        s.strokeOpacity = String(sk.strokeOpacity ?? 0.9);
        s.strokeWidth = String(sk.strokeWidth ?? 1);
      } else {
        removeSkeletonHatch(svgEl as SVGSVGElement, layer.elementId);
        s.strokeWidth = '';
        if (layer.fillNone) {
          removeGradFromDefs(svgEl as SVGSVGElement, fillGradId);
          s.fill = 'none';
        } else if (layer.fillGradient) {
          s.fill = applyGradientToDefs(svgEl as SVGSVGElement, fillGradId, layer.fillGradient);
        } else {
          removeGradFromDefs(svgEl as SVGSVGElement, fillGradId);
          if (layer.tracks.fillColor.length > 0) {
            s.fill = unpackColor(vals.fillColor);
          } else if (layer.defaultFill) {
            s.fill = layer.defaultFill;
          } else {
            s.fill = '';
          }
        }
        if (layer.strokeNone) {
          removeGradFromDefs(svgEl as SVGSVGElement, strokeGradId);
          s.stroke = 'none';
        } else if (layer.strokeGradient) {
          s.stroke = applyGradientToDefs(svgEl as SVGSVGElement, strokeGradId, layer.strokeGradient);
        } else {
          removeGradFromDefs(svgEl as SVGSVGElement, strokeGradId);
          if (layer.tracks.strokeColor.length > 0) {
            s.stroke = unpackColor(vals.strokeColor);
          } else if (layer.defaultStroke) {
            s.stroke = layer.defaultStroke;
          } else {
            s.stroke = '';
          }
        }

        // Fill / stroke opacity
        if (layer.tracks.fillOpacity.length > 0) {
          s.fillOpacity = String(vals.fillOpacity);
        } else {
          s.fillOpacity = '';
        }
        if (layer.tracks.strokeOpacity.length > 0) {
          s.strokeOpacity = String(vals.strokeOpacity);
        } else {
          s.strokeOpacity = '';
        }
      }

      // Motion path – compute origin adjustment so element starts at its natural position
      const mp = layer.motionPathId ? state.motionPaths.find(p => p.id === layer.motionPathId) : null;
      let adjX = 0, adjY = 0;
      if (mp && mp.d) {
        const pathStart = parsePathStart(mp.d);
        if (pathStart) {
          try {
            const bbox = (el as unknown as SVGGraphicsElement).getBBox();
            const cx = bbox.x + bbox.width / 2 + ax;
            const cy = bbox.y + bbox.height / 2 + ay;
            adjX = cx - pathStart.x;
            adjY = cy - pathStart.y;
          } catch { /* skip */ }
        }
        const offsetPct = (vals.motionOffset ?? 0) * 100;
        (s as any).offsetPath = `path('${mp.d}')`;
        (s as any).offsetDistance = `${offsetPct}%`;
        (s as any).offsetRotate = (layer.autoRotate ?? false) ? 'auto' : '0deg';
        (s as any).offsetAnchor = 'auto';
      } else {
        (s as any).offsetPath = '';
        (s as any).offsetDistance = '';
        (s as any).offsetRotate = '';
        (s as any).offsetAnchor = '';
      }

      s.transform = `translate(${vals.x + adjX}px, ${vals.y + adjY}px) rotate(${vals.rotation}deg) scale(${vals.scaleX}, ${vals.scaleY})`;
      s.opacity = String(vals.opacity);

      // Path keyframe shape animation — runs for every layer, not just the selected one
      if (layer.pathKeyframes && layer.pathKeyframes.length > 0) {
        const pts = interpolatePathPoints(layer.pathKeyframes, state.currentTime);
        if (pts) {
          const tag = layer.tagName.toLowerCase();
          const closed = layer.pathKeyframes[0]?.closed ?? false;
          if (tag === 'polygon' || tag === 'polyline') {
            el.setAttribute('points', pts.map(p => `${p.x.toFixed(3)},${p.y.toFixed(3)}`).join(' '));
          } else {
            el.setAttribute('d', buildPath(pts, closed));
          }
        }
      }
    }

  }, [state.layers, state.currentTime, state.motionPaths]);

  // Re-render SVG when source changes; also read default fill/stroke
  useEffect(() => {
    const container = svgContainerRef.current;
    if (!container || !state.svgSource) {
      if (container) container.innerHTML = '';
      return;
    }

    container.innerHTML = state.svgSource;
    const svgEl = container.querySelector('svg');
    if (svgEl) {
      if (!svgEl.getAttribute('viewBox')) {
        const w = svgEl.getAttribute('width') || state.canvasWidth;
        const h = svgEl.getAttribute('height') || state.canvasHeight;
        svgEl.setAttribute('viewBox', `0 0 ${w} ${h}`);
      }
      svgEl.setAttribute('width', String(state.canvasWidth));
      svgEl.setAttribute('height', String(state.canvasHeight));

      // Read default fill/stroke from each element
      const updates: Array<{ layerId: string; defaultFill?: string; defaultStroke?: string }> = [];
      for (const layer of state.layers) {
        const el = svgEl.getElementById(layer.elementId);
        if (!el) continue;
        const fillAttr = el.getAttribute('fill');
        const strokeAttr = el.getAttribute('stroke');
        const computedFill = fillAttr
          ? svgColorToHex(fillAttr)
          : svgColorToHex(window.getComputedStyle(el).fill ?? '');
        const computedStroke = strokeAttr
          ? svgColorToHex(strokeAttr)
          : svgColorToHex(window.getComputedStyle(el).stroke ?? '');
        if (computedFill !== undefined || computedStroke !== undefined) {
          updates.push({ layerId: layer.id, defaultFill: computedFill, defaultStroke: computedStroke });
        }
      }
      if (updates.length) {
        dispatch({ type: 'SET_LAYERS_DEFAULT_COLORS', updates });
      }
    }
    applyTransforms();
  }, [state.svgSource, state.canvasWidth, state.canvasHeight]); // eslint-disable-line react-hooks/exhaustive-deps

  // Apply transforms on time/layer changes
  useEffect(() => {
    applyTransforms();
  }, [applyTransforms]);

  // Set cursor on all layer elements when layers change
  useEffect(() => {
    const svgEl = svgContainerRef.current?.querySelector('svg');
    if (!svgEl) return;
    for (const layer of state.layers) {
      const el = svgEl.getElementById(layer.elementId);
      if (el) (el as SVGElement).style.cursor = 'pointer';
    }
  }, [state.layers]);

  // Single stable effect for event handlers – only re-registers when svgSource changes
  useEffect(() => {
    const container = svgContainerRef.current;
    if (!container || !state.svgSource) return;
    const svgEl = container.querySelector('svg');
    if (!svgEl) return;

    // The innermost layer under the cursor, ignoring grouping.
    function findLayer(target: Element | null) {
      let el: Element | null = target;
      while (el && el !== svgEl) {
        if (el.id) {
          const layer = layersRef.current.find((l) => l.elementId === el!.id);
          if (layer) return layer;
        }
        el = el.parentElement;
      }
      return null;
    }

    // Clicking a shape picks the outermost group holding it, so a group reads as
    // one object. Double-click reaches past that to the shape itself.
    function findSelectableLayer(target: Element | null) {
      const layer = findLayer(target);
      if (!layer) return null;
      let outermost = layer;
      let guard = 0;
      while (outermost.parentId && guard++ < 50) {
        const parent = layersRef.current.find(l => l.id === outermost.parentId);
        if (!parent) break;
        outermost = parent;
      }
      return outermost;
    }

    function handleClick(e: MouseEvent) {
      const target = e.target as Element;
      dispatch({ type: 'SET_SELECTED_MOTION_PATH', id: null });
      if (e.metaKey || e.ctrlKey) {
        const layer = findSelectableLayer(target);
        if (layer) {
          dispatch({ type: 'ADD_TO_LAYER_SELECTION', layerId: layer.id });
        } else {
          dispatch({ type: 'SELECT_LAYER', layerId: null });
        }
        return;
      }
      const clickedLayer = findSelectableLayer(target);
      if (!clickedLayer) {
        // Clicking SVG background — if a path-like layer is currently selected (anchor edit mode),
        // just clear the selected point rather than deselecting the whole layer.
        const cur = layersRef.current.find(l => l.id === stateRef.current.selectedLayerId);
        const isPathLike = cur && ['path', 'polyline', 'polygon', 'rect', 'circle', 'ellipse'].includes(cur.tagName.toLowerCase());
        if (isPathLike) {
          dispatch({ type: 'SELECT_POINT', pointId: null });
          return;
        }
      }
      dispatch({ type: 'SELECT_LAYER', layerId: clickedLayer?.id ?? null });
    }

    function handleMouseMove(e: MouseEvent) {
      if (!(e.metaKey || e.ctrlKey)) {
        if (cmdHoverLayerIdLocalRef.current !== null) {
          cmdHoverLayerIdLocalRef.current = null;
          dispatch({ type: 'SET_CMD_HOVER_LAYER', layerId: null });
        }
        return;
      }
      const layer = findLayer(e.target as Element);
      const newId = layer?.id ?? null;
      if (newId === cmdHoverLayerIdLocalRef.current) return;
      cmdHoverLayerIdLocalRef.current = newId;
      dispatch({ type: 'SET_CMD_HOVER_LAYER', layerId: newId });
    }

    function handleMouseLeave() {
      if (cmdHoverLayerIdLocalRef.current !== null) {
        cmdHoverLayerIdLocalRef.current = null;
        dispatch({ type: 'SET_CMD_HOVER_LAYER', layerId: null });
      }
    }

    // Reach inside a group to the individual shape.
    function handleDblClick(e: MouseEvent) {
      const layer = findLayer(e.target as Element);
      if (layer) dispatch({ type: 'SELECT_LAYER', layerId: layer.id });
    }

    function handleKeyUp(e: KeyboardEvent) {
      if ((e.key === 'Meta' || e.key === 'Control') && cmdHoverLayerIdLocalRef.current !== null) {
        cmdHoverLayerIdLocalRef.current = null;
        dispatch({ type: 'SET_CMD_HOVER_LAYER', layerId: null });
      }
    }

    svgEl.addEventListener('click', handleClick);
    svgEl.addEventListener('dblclick', handleDblClick);
    svgEl.addEventListener('mousemove', handleMouseMove);
    svgEl.addEventListener('mouseleave', handleMouseLeave);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      svgEl.removeEventListener('click', handleClick);
      svgEl.removeEventListener('dblclick', handleDblClick);
      svgEl.removeEventListener('mousemove', handleMouseMove);
      svgEl.removeEventListener('mouseleave', handleMouseLeave);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [state.svgSource, state.canvasWidth, state.canvasHeight, dispatch]); // eslint-disable-line react-hooks/exhaustive-deps

  const { canvasZoom } = state;

  function handleCanvasAreaClick(e: React.MouseEvent) {
    if (pannedRef.current) { pannedRef.current = false; return; }
    if (!canvasFrameRef.current?.contains(e.target as Node)) {
      dispatch({ type: 'SELECT_LAYER', layerId: null });
      dispatch({ type: 'SET_SELECTED_MOTION_PATH', id: null });
    }
  }

  // Rubber-band select. Only starts on empty space — a drag that begins on a shape
  // is left alone so the transform overlay keeps its move behaviour.
  function startMarqueeSelect(e: React.MouseEvent) {
    const svgEl = svgContainerRef.current?.querySelector('svg') as SVGSVGElement | null;
    if (!svgEl) return false;

    let el: Element | null = e.target as Element;
    while (el && el !== svgEl) {
      if (el.id && layersRef.current.some(l => l.elementId === el!.id)) return false;
      el = el.parentElement;
    }

    const startX = e.clientX;
    const startY = e.clientY;
    const additive = e.shiftKey || e.metaKey || e.ctrlKey;
    const baseSelection = additive ? [...stateRef.current.selectedLayerIds] : [];
    let moved = false;

    function rectFrom(mx: number, my: number) {
      return {
        left: Math.min(startX, mx), top: Math.min(startY, my),
        right: Math.max(startX, mx), bottom: Math.max(startY, my),
      };
    }

    function hitLayerIds(r: ReturnType<typeof rectFrom>): string[] {
      const hits: string[] = [];
      for (const layer of layersRef.current) {
        // Only outermost layers — a group is picked as a whole, never alongside
        // the children it contains.
        if (layer.parentId) continue;
        if (!layer.visible || layer.locked) continue;
        const node = svgEl!.getElementById(layer.elementId) as SVGGraphicsElement | null;
        if (!node) continue;
        const b = node.getBoundingClientRect();
        if (b.width === 0 && b.height === 0) continue;
        // Intersection, not containment — brushing a shape picks it up.
        if (b.right >= r.left && b.left <= r.right && b.bottom >= r.top && b.top <= r.bottom) {
          hits.push(layer.id);
        }
      }
      return hits;
    }

    function onMove(mv: MouseEvent) {
      if (!moved && Math.abs(mv.clientX - startX) < 3 && Math.abs(mv.clientY - startY) < 3) return;
      moved = true;
      const r = rectFrom(mv.clientX, mv.clientY);
      setMarquee(r);
      const hits = hitLayerIds(r);
      const merged = [...baseSelection.filter(id => !hits.includes(id)), ...hits];
      dispatch({ type: 'SET_LAYER_SELECTION', layerIds: merged });
    }

    function onUp() {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      setMarquee(null);
      if (moved) pannedRef.current = true; // suppress the click that clears selection
    }

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return true;
  }

  function handleCanvasMouseDown(e: React.MouseEvent) {
    if (!spaceHeldRef.current && e.button === 0) {
      startMarqueeSelect(e);
      return;
    }
    if (!spaceHeldRef.current || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    pannedRef.current = false;
    const startX = e.clientX;
    const startY = e.clientY;
    const startPanX = panXRef.current;
    const startPanY = panYRef.current;
    panDragRef.current = { startX, startY, startPanX, startPanY };
    setIsPanning(true);

    function onMouseMove(mv: MouseEvent) {
      if (!panDragRef.current) return;
      const dx = mv.clientX - panDragRef.current.startX;
      const dy = mv.clientY - panDragRef.current.startY;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) pannedRef.current = true;
      const nx = panDragRef.current.startPanX + dx;
      const ny = panDragRef.current.startPanY + dy;
      panXRef.current = nx;
      panYRef.current = ny;
      setPanX(nx);
      setPanY(ny);
    }
    function onMouseUp() {
      panDragRef.current = null;
      setIsPanning(false);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    }
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }

  return (
    <div
      ref={canvasAreaRef}
      className="canvas-area"
      style={{ cursor: spaceHeld ? (isPanning ? 'grabbing' : 'grab') : undefined }}
      onClick={handleCanvasAreaClick}
      onMouseDown={handleCanvasMouseDown}
      onMouseEnter={() => { mouseOverCanvasRef.current = true; }}
      onMouseLeave={() => { mouseOverCanvasRef.current = false; }}
    >
      {marquee && (
        <div
          className="canvas-marquee"
          style={{
            left: marquee.left,
            top: marquee.top,
            width: marquee.right - marquee.left,
            height: marquee.bottom - marquee.top,
          }}
        />
      )}
      {!state.svgSource ? (
        <div className="canvas-empty">
          <div className="canvas-empty-icon">⬛</div>
          <div>Import an SVG to get started</div>
        </div>
      ) : (
        <div className="canvas-viewport" style={{ transform: `translate(${panX}px, ${panY}px)` }}>
          {/* Layout wrapper sized to the zoomed canvas so scrolling works */}
          <div style={{ width: state.canvasWidth * canvasZoom, height: state.canvasHeight * canvasZoom, flexShrink: 0, position: 'relative' }}>
            <div
              ref={canvasFrameRef}
              className="canvas-frame"
              style={{
                width: state.canvasWidth,
                height: state.canvasHeight,
                transform: `scale(${canvasZoom})`,
                transformOrigin: 'top left',
                position: 'absolute',
                top: 0,
                left: 0,
                ...(state.canvasBackground ? { background: state.canvasBackground } : {}),
              }}
            >
              <div ref={svgContainerRef} className="svg-host" />
              {/* PathPointOverlay / MotionPathOverlay / SkeletonOverlay stay inside the CSS-scaled
                  frame — their coordinate systems divide by canvasZoom internally. */}
              <MotionPathOverlay
                svgContainerRef={svgContainerRef}
                canvasFrameRef={canvasFrameRef}
                canvasWidth={state.canvasWidth}
                canvasHeight={state.canvasHeight}
                canvasZoom={state.canvasZoom}
              />
              <SkeletonOverlay
                svgContainerRef={svgContainerRef}
                canvasFrameRef={canvasFrameRef}
                canvasZoom={state.canvasZoom}
              />
            </div>
            {/* TransformOverlay / CmdHoverOverlay / SnapGuideOverlay / PathPointOverlay live
                OUTSIDE the CSS-scaled frame. PathPointOverlay is last so it renders on top of
                TransformOverlay — anchor circles intercept events before the bounding box does. */}
            <SnapProvider>
              <TransformOverlay
                svgContainerRef={svgContainerRef}
                canvasWidth={state.canvasWidth}
                canvasHeight={state.canvasHeight}
                canvasZoom={state.canvasZoom}
              />
              <CmdHoverOverlay
                svgContainerRef={svgContainerRef}
                canvasWidth={state.canvasWidth}
                canvasHeight={state.canvasHeight}
              />
              <SnapGuideOverlay canvasWidth={state.canvasWidth} canvasHeight={state.canvasHeight} />
              <PathPointOverlay
                svgContainerRef={svgContainerRef}
                canvasFrameRef={canvasFrameRef}
                canvasWidth={state.canvasWidth}
                canvasHeight={state.canvasHeight}
                canvasZoom={state.canvasZoom}
              />
            </SnapProvider>
          </div>
        </div>
      )}
    </div>
  );
}
