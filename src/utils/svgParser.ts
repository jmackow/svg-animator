import { Layer, PropertyTracks, ALL_PROPERTIES } from '../types';

const SKIP_TAGS = new Set([
  'defs', 'title', 'desc', 'style', 'script', 'filter',
  'linearGradient', 'radialGradient', 'pattern', 'clipPath',
  'mask', 'marker', 'symbol', 'metadata',
]);

let idCounter = 0;
function makeId(): string {
  return `svga-el-${++idCounter}`;
}

function getLabel(el: Element, index: number): string {
  return (
    el.getAttribute('id') ||
    el.getAttribute('inkscape:label') ||
    el.getAttribute('aria-label') ||
    `${el.tagName} ${index + 1}`
  );
}

function emptyTracks(): PropertyTracks {
  const t = {} as PropertyTracks;
  for (const p of ALL_PROPERTIES) t[p] = [];
  return t;
}

export function parseSvgLayers(svgSource: string): { layers: Layer[]; source: string } {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgSource, 'image/svg+xml');

  const errorNode = doc.querySelector('parsererror');
  if (errorNode) throw new Error('Invalid SVG');

  const svgEl = doc.documentElement;
  const layers: Layer[] = [];
  let changed = false;

  function walk(parent: Element, depth = 0, parentId?: string) {
    let index = 0;
    for (const child of Array.from(parent.children)) {
      const tag = child.tagName.toLowerCase();
      if (SKIP_TAGS.has(tag)) continue;

      if (!child.getAttribute('id')) {
        child.setAttribute('id', makeId());
        changed = true;
      }

      const id = child.getAttribute('id')!;
      layers.push({
        id,
        elementId: id,
        tagName: child.tagName,
        label: getLabel(child, index),
        tracks: emptyTracks(),
        visible: true,
        locked: false,
        expanded: false,
        parentId,
        anchorX: 0,
        anchorY: 0,
        autoRotate: false,
      });

      if ((tag === 'g' || tag === 'svg') && depth < 2) {
        walk(child, depth + 1, id);
      }
      index++;
    }
  }

  walk(svgEl);

  const serializer = new XMLSerializer();
  const finalSource = changed ? serializer.serializeToString(doc) : svgSource;

  return { layers, source: finalSource };
}
