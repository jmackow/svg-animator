import { Layer, PropertyTracks, ALL_PROPERTIES } from '../types';

const SKIP_TAGS = new Set([
  'defs', 'title', 'desc', 'style', 'script', 'filter',
  'linearGradient', 'radialGradient', 'pattern', 'clipPath',
  'mask', 'marker', 'symbol', 'metadata',
]);

// Presentation attributes that inherit down the tree — a group carrying one of
// these can be dissolved by copying it onto children that don't set it themselves.
const INHERITED_ATTRS = [
  'fill', 'fill-opacity', 'fill-rule',
  'stroke', 'stroke-opacity', 'stroke-width', 'stroke-linecap',
  'stroke-linejoin', 'stroke-miterlimit', 'stroke-dasharray', 'stroke-dashoffset',
  'color', 'visibility', 'shape-rendering', 'paint-order',
  'font-family', 'font-size', 'font-weight', 'font-style', 'text-anchor',
];

// Non-inherited attributes that still apply to every child individually when a
// group is dissolved (clipping/masking a group == clipping each of its children).
const PER_CHILD_ATTRS = ['clip-path', 'mask', 'filter'];

let idCounter = 0;
// `taken` guards against handing out an id the document already uses — the counter
// restarts every session, so without it a freshly-generated svga-el-1 can collide
// with one baked into a previously exported file.
function makeId(taken: Set<string>): string {
  let id = `svga-el-${++idCounter}`;
  while (taken.has(id)) id = `svga-el-${++idCounter}`;
  taken.add(id);
  return id;
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

// A group is only dissolved when doing so can't change how the artwork renders:
//  - transform/opacity must stay on a wrapper, because the canvas drives those two
//    as CSS on the shape itself and CSS would override a pushed-down attribute
//    (and group opacity isn't the same as per-child opacity where shapes overlap)
//  - a per-child attribute can't be merged onto a child that already sets its own
// Groups kept for these reasons are still never layers — only shapes are.
function canDissolve(g: Element): boolean {
  if (g.hasAttribute('transform') || g.hasAttribute('opacity')) return false;
  const conflicting = PER_CHILD_ATTRS.filter(a => g.hasAttribute(a));
  return Array.from(g.children).every(c => conflicting.every(a => !c.hasAttribute(a)));
}

function pushAttributesDown(g: Element, child: Element) {
  for (const attr of INHERITED_ATTRS) {
    const v = g.getAttribute(attr);
    if (v && !child.hasAttribute(attr)) child.setAttribute(attr, v);
  }

  for (const attr of PER_CHILD_ATTRS) {
    const v = g.getAttribute(attr);
    if (v && !child.hasAttribute(attr)) child.setAttribute(attr, v);
  }
}

// Recursively splice <g> wrappers out of the tree, pushing their attributes onto
// the children they wrapped, so the document ends up as flat as it safely can be.
// Innermost groups are handled first so a dissolved child exposes its own children
// to the next round.
function flattenGroups(parent: Element): boolean {
  let changed = false;
  for (const child of Array.from(parent.children)) {
    const tag = child.tagName.toLowerCase();
    if (SKIP_TAGS.has(tag)) continue;
    if (tag !== 'g') continue;

    if (flattenGroups(child)) changed = true;
    if (!canDissolve(child)) continue;

    for (const grandchild of Array.from(child.children)) {
      if (!SKIP_TAGS.has(grandchild.tagName.toLowerCase())) {
        pushAttributesDown(child, grandchild);
      }
      parent.insertBefore(grandchild, child);
    }
    parent.removeChild(child);
    changed = true;
  }
  return changed;
}

// Walks the flattened document and returns one entry per drawable element, in
// render order. Groups that survived flattening are never returned — only the
// shapes inside them are. Elements are given ids here if they lack one, and any
// element repeating an id already claimed is re-issued a fresh one so every layer
// maps to exactly one element.
function shapeElements(svgEl: Element): { list: Array<{ el: Element; id: string }>; changed: boolean } {
  const taken = new Set<string>();
  for (const el of Array.from(svgEl.ownerDocument!.querySelectorAll('[id]'))) {
    taken.add(el.getAttribute('id')!);
  }
  const seen = new Set<string>();
  const list: Array<{ el: Element; id: string }> = [];
  let changed = false;

  function walk(parent: Element) {
    for (const child of Array.from(parent.children)) {
      const tag = child.tagName.toLowerCase();
      if (SKIP_TAGS.has(tag)) continue;

      if (tag === 'g' || tag === 'svg') {
        walk(child);
        continue;
      }

      let id = child.getAttribute('id');
      if (!id || seen.has(id)) {
        id = makeId(taken);
        child.setAttribute('id', id);
        changed = true;
      }
      seen.add(id);
      list.push({ el: child, id });
    }
  }

  walk(svgEl);
  return { list, changed };
}

function newLayer(el: Element, id: string, index: number): Layer {
  return {
    id,
    elementId: id,
    tagName: el.tagName,
    label: getLabel(el, index),
    tracks: emptyTracks(),
    visible: true,
    locked: false,
    expanded: false,
    anchorX: 0,
    anchorY: 0,
    autoRotate: false,
  };
}

export function parseSvgLayers(svgSource: string): { layers: Layer[]; source: string } {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgSource, 'image/svg+xml');

  const errorNode = doc.querySelector('parsererror');
  if (errorNode) throw new Error('Invalid SVG');

  const svgEl = doc.documentElement;
  const flattened = flattenGroups(svgEl);
  const { list, changed } = shapeElements(svgEl);

  const layers = list.map(({ el, id }, i) => newLayer(el, id, i));

  const serializer = new XMLSerializer();
  const finalSource = flattened || changed ? serializer.serializeToString(doc) : svgSource;

  return { layers, source: finalSource };
}

// Projects saved before layers went flat carry group layers in their metadata —
// restoring those verbatim puts groups back in the panel, where deleting one takes
// its whole subtree with it. Rebuild the list from the flattened document instead,
// carrying each shape's saved animation data across by element id.
export function flattenProjectLayers(
  svgSource: string,
  savedLayers: Layer[]
): { layers: Layer[]; source: string } {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgSource, 'image/svg+xml');
  if (doc.querySelector('parsererror')) return { layers: savedLayers, source: svgSource };

  const svgEl = doc.documentElement;
  const flattened = flattenGroups(svgEl);
  const { list, changed } = shapeElements(svgEl);

  const savedByElement = new Map(savedLayers.map(l => [l.elementId, l]));
  const layers = list.map(({ el, id }, i) => {
    const saved = savedByElement.get(id);
    if (!saved) return newLayer(el, id, i);
    // Keep everything the user authored; drop the hierarchy field and trust the
    // document for the tag, since a dissolved wrapper may have changed it.
    const { parentId: _drop, ...rest } = saved as Layer & { parentId?: string };
    return { ...rest, id, elementId: id, tagName: el.tagName } as Layer;
  });

  const serializer = new XMLSerializer();
  const finalSource = flattened || changed ? serializer.serializeToString(doc) : svgSource;

  return { layers, source: finalSource };
}
