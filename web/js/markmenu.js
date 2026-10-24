import { t } from './i18n.js';
import { markSign } from './grid.js';
import { MARK_FILTERS, filterName } from './state.js';

// The mark filters as a panel of buttons, two to a row: the two flags, each rating beside its
// "or more" (five stars has none: five or more is five), and the five colours in one line. Every button carries the number of photos it
// would show, so the panel doubles as a tally of the folder's marks.

const isFlag = (name) => name === 'pick' || name === 'reject';
const isRating = (name) => name.startsWith('star');

// The sign of one mark filter, as on a thumbnail: its flag, its star and number, or its colour.
export function filterSign(name) {
  if (isFlag(name)) return markSign({ kind: name });
  if (isRating(name)) return markSign({ kind: 'rating', value: name.slice(4) });
  const dot = document.createElement('span');
  dot.className = `dot ${name}`;
  return dot;
}

function span(className) {
  const el = document.createElement('span');
  el.className = className;
  return el;
}

// Build the buttons into `box`; `onPick` gets the name of the filter that was tapped.
// Returns the function that writes the counts and presses the filter in use.
export function buildMarkMenu(box, onPick) {
  const buttons = new Map();
  const colours = document.createElement('div');
  colours.className = 'colours';
  for (const name of MARK_FILTERS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.filter = name;
    button.append(filterSign(name));
    if (isFlag(name)) button.append(span('name'));
    button.append(span('count'));
    buttons.set(name, button);
    if (isFlag(name) || isRating(name)) box.append(button);
    else colours.append(button);
    if (name === 'reject' || name === 'star5') box.append(document.createElement('hr'));
  }
  box.append(colours);
  box.addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (button) onPick(button.dataset.filter);
  });

  // A filter that would show nothing cannot be chosen, unless it is the one to switch off.
  return (counts, selected) => {
    for (const [name, button] of buttons) {
      const count = String(counts[name]);
      const label = `${filterName(name)}, ${count}`;
      if (button.getAttribute('aria-label') === label && button.getAttribute('aria-pressed') === String(name === selected)) continue;
      button.setAttribute('aria-label', label);
      button.setAttribute('aria-pressed', String(name === selected));
      button.disabled = counts[name] === 0 && name !== selected;
      button.querySelector('.count').textContent = count;
      if (isFlag(name)) button.querySelector('.name').textContent = t(`mark.${name}`);
    }
  };
}
