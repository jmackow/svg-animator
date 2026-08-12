const SKIP_IMPORT_TAGS = new Set(['defs', 'style', 'title', 'desc', 'metadata', 'script']);

export function stripIds(svgText: string): string {
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  doc.documentElement.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'));
  return new XMLSerializer().serializeToString(doc.documentElement);
}

// NOTE: skips <defs> and <style> — internal gradient/mask references from imported SVG may break
export function appendSvgChildrenToExisting(existingSvg: string, newSvg: string): string {
  const existingDoc = new DOMParser().parseFromString(existingSvg, 'image/svg+xml');
  const newDoc = new DOMParser().parseFromString(newSvg, 'image/svg+xml');
  const root = existingDoc.documentElement;
  for (const child of Array.from(newDoc.documentElement.children)) {
    if (SKIP_IMPORT_TAGS.has(child.tagName.toLowerCase())) continue;
    root.appendChild(existingDoc.importNode(child, true));
  }
  return new XMLSerializer().serializeToString(root);
}

export function appendRawElementToSvg(existingSvg: string, rawXml: string): string {
  const doc = new DOMParser().parseFromString(existingSvg, 'image/svg+xml');
  const tempDoc = new DOMParser().parseFromString(
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">${rawXml}</svg>`,
    'image/svg+xml'
  );
  const el = tempDoc.documentElement.firstElementChild;
  if (el) doc.documentElement.appendChild(doc.importNode(el, true));
  return new XMLSerializer().serializeToString(doc.documentElement);
}

export function createMinimalSvg(width: number, height: number, innerXml: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${innerXml}</svg>`;
}

export function removeElementsFromSvg(svgSource: string, elementIds: string[]): string {
  const doc = new DOMParser().parseFromString(svgSource, 'image/svg+xml');
  for (const id of elementIds) {
    const el = doc.getElementById(id);
    el?.parentNode?.removeChild(el);
  }
  return new XMLSerializer().serializeToString(doc.documentElement);
}

// Moves an element to sit directly before the target. With no target it goes to
// the end of `parentElementId` (or the root), which is the top of the z-order.
export function moveElementInSvg(
  svgSource: string,
  elementId: string,
  beforeElementId: string | null,
  parentElementId?: string | null
): string {
  const doc = new DOMParser().parseFromString(svgSource, 'image/svg+xml');
  const el = doc.getElementById(elementId);
  if (!el) return svgSource;
  const ref = beforeElementId ? doc.getElementById(beforeElementId) : null;
  if (ref && ref.parentNode) {
    ref.parentNode.insertBefore(el, ref);
  } else {
    const container = parentElementId ? doc.getElementById(parentElementId) : doc.documentElement;
    (container ?? doc.documentElement).appendChild(el);
  }
  return new XMLSerializer().serializeToString(doc.documentElement);
}

// Marks a <g> as user-created (Cmd+G) rather than leftover import structure, so
// the flattening pass knows to leave it alone and keep it as a real layer.
export const USER_GROUP_ATTR = 'data-svga-group';

// Wraps the given elements in a new <g>, placed where the topmost of them sat so
// the group keeps their z-order. Relative order among them is preserved.
export function groupElementsInSvg(
  svgSource: string,
  elementIds: string[],
  groupId: string
): string {
  const doc = new DOMParser().parseFromString(svgSource, 'image/svg+xml');
  const root = doc.documentElement;
  const wanted = new Set(elementIds);
  // querySelectorAll yields document order, which is z-order for SVG.
  const targets = Array.from(root.querySelectorAll('[id]')).filter(el =>
    wanted.has(el.getAttribute('id')!)
  );
  if (targets.length === 0) return svgSource;

  const topmost = targets[targets.length - 1];
  const group = doc.createElementNS('http://www.w3.org/2000/svg', 'g');
  group.setAttribute('id', groupId);
  group.setAttribute(USER_GROUP_ATTR, '1');
  topmost.parentNode!.insertBefore(group, topmost.nextSibling);
  for (const el of targets) group.appendChild(el);

  return new XMLSerializer().serializeToString(root);
}

// Dissolves a user group, leaving its children in place at the group's position.
export function ungroupElementInSvg(svgSource: string, groupId: string): string {
  const doc = new DOMParser().parseFromString(svgSource, 'image/svg+xml');
  const group = doc.getElementById(groupId);
  if (!group?.parentNode) return svgSource;
  while (group.firstChild) group.parentNode.insertBefore(group.firstChild, group);
  group.parentNode.removeChild(group);
  return new XMLSerializer().serializeToString(doc.documentElement);
}

export function extractSvgDimensions(svgSource: string): { width: number; height: number } | null {
  const doc = new DOMParser().parseFromString(svgSource, 'image/svg+xml');
  const svgEl = doc.querySelector('svg');
  if (!svgEl) return null;
  const vb = svgEl.getAttribute('viewBox');
  if (vb) {
    const parts = vb.trim().split(/[\s,]+/).map(Number);
    if (parts.length >= 4 && parts[2] > 0 && parts[3] > 0) {
      return { width: Math.round(parts[2]), height: Math.round(parts[3]) };
    }
  }
  const wAttr = svgEl.getAttribute('width') ?? '';
  const hAttr = svgEl.getAttribute('height') ?? '';
  if (!wAttr.includes('%') && !hAttr.includes('%')) {
    const w = parseFloat(wAttr);
    const h = parseFloat(hAttr);
    if (w > 0 && h > 0) return { width: Math.round(w), height: Math.round(h) };
  }
  return null;
}

