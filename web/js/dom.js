export const $ = (id) => document.getElementById(id);

const SVG_NS = 'http://www.w3.org/2000/svg';

// One Lucide icon from the vendored sprite.
export function icon(name) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', `/vendor/lucide.svg#${name}`);
  svg.append(use);
  return svg;
}
