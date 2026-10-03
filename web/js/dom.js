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

// Play a one-shot CSS animation class, restarting it if it is already running, and
// remove the class afterwards so it cannot replay when the element is shown again.
export function playAnimation(el, className) {
  el.classList.remove(className);
  void el.offsetWidth;
  el.classList.add(className);
  // animationcancel fires when the element or an ancestor becomes display:none.
  const done = () => {
    el.classList.remove(className);
    el.removeEventListener('animationend', done);
    el.removeEventListener('animationcancel', done);
  };
  el.addEventListener('animationend', done);
  el.addEventListener('animationcancel', done);
}
