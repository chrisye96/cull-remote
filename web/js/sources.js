import { $ } from './dom.js';
import { getSources } from './api.js';

let cached = null;

// The source tree is fetched once per page load; Back reuses it, the refresh button forces it.
export async function showSources(onPick, { force = false } = {}) {
  if (force || !cached) cached = await getSources();
  const sources = cached;
  const list = $('source-list');
  list.textContent = '';
  for (const source of sources) {
    const item = document.createElement('li');
    item.style.paddingInlineStart = `${source.depth * 16}px`;
    if (source.id) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = `${source.name}（${source.count}）`;
      button.addEventListener('click', () => onPick(source));
      item.append(button);
    } else {
      item.textContent = source.name;
    }
    list.append(item);
  }
}
