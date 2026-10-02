import { $ } from './dom.js';
import { getSources } from './api.js';

export async function showSources(onPick) {
  const sources = await getSources();
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
