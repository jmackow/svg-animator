import React, { useRef, useEffect, useCallback, useState } from 'react';
import { useApp } from '../context/AppContext';
import { GradientDef } from '../types';
import { interpolateTracks, unpackColor } from '../utils/interpolate';

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
import TransformOverlay from './TransformOverlay';
import MotionPathOverlay from './MotionPathOverlay';
import CmdHoverOverlay from './CmdHoverOverlay';

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

export default function Canvas() {
  const { state, dispatch } = useApp();
  const svgContainerRef = useRef<HTMLDivElement>(null);
  const canvasFrameRef = useRef<HTMLDivElement>(null);
  const [enteredGroupId, setEnteredGroupId] = useState<string | null>(null);

  // Stable refs so event handlers don't go stale across layer/time changes
  const layersRef = useRef(state.layers);
  const motionPathsRef = useRef(state.motionPaths);
  const enteredGroupIdRef = useRef<string | null>(null);
  const cmdHoverLayerIdLocalRef = useRef<string | null>(null); // local dedup

  useEffect(() => { layersRef.current = state.layers; }, [state.layers]);
  useEffect(() => { motionPathsRef.current = state.motionPaths; }, [state.motionPaths]);
  useEffect(() => { enteredGroupIdRef.current = enteredGroupId; }, [enteredGroupId]);

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

      const vals = interpolateTracks(layer.tracks, state.currentTime);
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
      if (layer.fillGradient) {
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
      if (layer.strokeGradient) {
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

    function findChildOfGroup(target: Element | null, groupLayerId: string) {
      let el: Element | null = target;
      while (el && el !== svgEl) {
        if (el.id) {
          const layer = layersRef.current.find((l) => l.elementId === el!.id && l.parentId === groupLayerId);
          if (layer) return layer;
        }
        el = el.parentElement;
      }
      return null;
    }

    function handleClick(e: MouseEvent) {
      const target = e.target as Element;
      if (e.metaKey || e.ctrlKey) {
        const layer = findLayer(target);
        dispatch({ type: 'SELECT_LAYER', layerId: layer?.id ?? null });
        setEnteredGroupId(null);
        return;
      }
      const eg = enteredGroupIdRef.current;
      if (eg) {
        const child = findChildOfGroup(target, eg);
        if (child) {
          dispatch({ type: 'SELECT_LAYER', layerId: child.id });
        } else {
          setEnteredGroupId(null);
          const layer = findLayer(target);
          dispatch({ type: 'SELECT_LAYER', layerId: layer?.id ?? null });
        }
        return;
      }
      const layer = findLayer(target);
      dispatch({ type: 'SELECT_LAYER', layerId: layer?.id ?? null });
    }

    function handleDblClick(e: MouseEvent) {
      const layer = findLayer(e.target as Element);
      if (layer && layer.tagName.toLowerCase() === 'g') {
        setEnteredGroupId(layer.id);
      }
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

    function handleKeyUp(e: KeyboardEvent) {
      if ((e.key === 'Meta' || e.key === 'Control') && cmdHoverLayerIdLocalRef.current !== null) {
        cmdHoverLayerIdLocalRef.current = null;
        dispatch({ type: 'SET_CMD_HOVER_LAYER', layerId: null });
      }
      if (e.key === 'Escape') setEnteredGroupId(null);
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
  }, [state.svgSource, dispatch]); // eslint-disable-line react-hooks/exhaustive-deps

  const { canvasZoom } = state;

  function handleWheel(e: React.WheelEvent) {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.1 : 0.9;
      dispatch({ type: 'SET_CANVAS_ZOOM', zoom: canvasZoom * factor });
    }
  }

  function handleCanvasAreaClick(e: React.MouseEvent) {
    // Deselect when clicking outside the canvas frame (gray background)
    if (!canvasFrameRef.current?.contains(e.target as Node)) {
      dispatch({ type: 'SELECT_LAYER', layerId: null });
    }
  }

  return (
    <div className="canvas-area" onWheel={handleWheel} onClick={handleCanvasAreaClick}>
      {enteredGroupId && (
        <div className="canvas-group-breadcrumb">
          Inside: <strong>{state.layers.find((l) => l.id === enteredGroupId)?.label ?? 'Group'}</strong>
          <button onClick={() => setEnteredGroupId(null)}>✕ Exit</button>
        </div>
      )}
      {!state.svgSource ? (
        <div className="canvas-empty">
          <div className="canvas-empty-icon">⬛</div>
          <div>Import an SVG to get started</div>
        </div>
      ) : (
        <div className="canvas-viewport">
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
              }}
            >
              <div ref={svgContainerRef} className="svg-host" />
              <TransformOverlay
                svgContainerRef={svgContainerRef}
                canvasWidth={state.canvasWidth}
                canvasHeight={state.canvasHeight}
              />
              <CmdHoverOverlay
                svgContainerRef={svgContainerRef}
                canvasWidth={state.canvasWidth}
                canvasHeight={state.canvasHeight}
              />
              <MotionPathOverlay
                svgContainerRef={svgContainerRef}
                canvasFrameRef={canvasFrameRef}
                canvasWidth={state.canvasWidth}
                canvasHeight={state.canvasHeight}
                canvasZoom={state.canvasZoom}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
