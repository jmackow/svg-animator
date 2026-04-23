import { Layer } from '../types';

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

export function moveElementInSvg(
  svgSource: string,
  elementId: string,
  beforeElementId: string | null,
  parentElementId: string | null
): string {
  const doc = new DOMParser().parseFromString(svgSource, 'image/svg+xml');
  const container = parentElementId ? doc.getElementById(parentElementId) : doc.documentElement;
  const el = doc.getElementById(elementId);
  if (!el || !container) return svgSource;
  const ref = beforeElementId ? doc.getElementById(beforeElementId) : null;
  if (ref) container.insertBefore(el, ref);
  else container.appendChild(el);
  return new XMLSerializer().serializeToString(doc.documentElement);
}

export function collectDescendantLayerIds(layerId: string, layers: Layer[]): string[] {
  const result = [layerId];
  layers.filter(l => l.parentId === layerId).forEach(c => result.push(...collectDescendantLayerIds(c.id, layers)));
  return result;
}
