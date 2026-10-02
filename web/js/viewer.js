import { $ } from './dom.js';
import { getPhotos, previewUrl, sendOp } from './api.js';
import { messageFor } from './messages.js';
import { KEY, isUnmarked, toggledValue, setField, shouldAdvance } from './state.js';

const size = matchMedia('(min-width: 768px)').matches ? 'hd' : 'std';
let all = [];
let list = [];
let index = 0;
let onlyUnmarked = true;

function showError(text) {
  $('error').textContent = text;
  $('error').hidden = !text;
}

function applyFilter() {
  list = onlyUnmarked ? all.filter(isUnmarked) : all.slice();
  index = 0;
  $('filter').textContent = onlyUnmarked ? '仅未标记' : '全部照片';
}

function render() {
  const photo = list[index];
  $('photo').hidden = !photo;
  $('actions').hidden = !photo;
  $('empty').hidden = Boolean(photo);
  $('title').textContent = photo ? `${photo.name}  ${index + 1}/${list.length}` : '';
  if (!photo) {
    $('empty').textContent = onlyUnmarked ? '这里没有未标记的照片' : '这里没有照片';
    return;
  }
  $('photo').src = previewUrl(photo.id, size);
  for (const button of $('actions').querySelectorAll('button')) {
    const { field } = button.dataset;
    const value = field === 'label' ? button.dataset.value : Number(button.dataset.value);
    const current = photo[KEY[field]];
    button.classList.toggle('on', field === 'rating' ? current >= value : current === value);
    button.setAttribute('aria-pressed', String(current === value));
  }
  // Warm the next two previews so swiping feels instant.
  for (const next of list.slice(index + 1, index + 3)) new Image().src = previewUrl(next.id, size);
}

function go(delta) {
  const target = index + delta;
  if (target < 0 || target >= list.length) return;
  index = target;
  showError('');
  render();
}

async function mark(field, rawValue) {
  const photo = list[index];
  if (!photo) return;
  const value = toggledValue(photo, field, field === 'label' ? rawValue : Number(rawValue));
  const previous = setField(photo, field, value);
  showError('');
  render();
  try {
    await sendOp(photo.id, field, value);
    if (shouldAdvance(field, value) && list[index] === photo) go(1);
  } catch (e) {
    setField(photo, field, previous);
    render();
    showError(messageFor(e.message));
  }
}

export function initViewer(onBack) {
  $('back').addEventListener('click', onBack);
  $('filter').addEventListener('click', () => {
    onlyUnmarked = !onlyUnmarked;
    applyFilter();
    render();
  });
  $('actions').addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (button) mark(button.dataset.field, button.dataset.value);
  });
  $('photo').addEventListener('error', () => showError('预览加载失败，点照片中间重试'));

  const stage = $('stage');
  let startX = null;
  stage.addEventListener('touchstart', (event) => { startX = event.touches[0].clientX; }, { passive: true });
  stage.addEventListener('touchend', (event) => {
    if (startX === null) return;
    const dx = event.changedTouches[0].clientX - startX;
    startX = null;
    if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1);
  });
  // Tap the left or right third to step; tap the middle to retry a failed preview.
  stage.addEventListener('click', (event) => {
    const third = stage.clientWidth / 3;
    if (event.clientX < third) go(-1);
    else if (event.clientX > third * 2) go(1);
    else if (!$('error').hidden) render();
  });
}

export async function openViewer(source) {
  all = [];
  applyFilter();
  render();
  $('title').textContent = source.name;
  $('empty').textContent = '加载中';
  all = await getPhotos(source.id);
  applyFilter();
  render();
}
