// Development stand-in for the Lightroom plugin. It answers the bridge of the LRC_DEV=1
// instance with a small fake catalog, so the web app can be exercised without Lightroom.
// Marks live in memory. Preview images are borrowed from the real preview cache.
// Usage: node spike/stand-in-plugin.mjs [pluginPort]
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const base = `http://127.0.0.1:${process.argv[2] ?? 47811}`;
const headers = { 'x-lrc-plugin': '1' };
const previewDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '.cache', 'previews');
const KEY = { rating: 'rating', label: 'label', pickStatus: 'pick' };

const samples = (await readdir(previewDir).catch(() => [])).filter((name) => name.endsWith('_std.jpg'));
if (!samples.length) {
  console.error(`No sample images in ${previewDir}. Open a folder once with the real server first.`);
  process.exit(1);
}

// Ids stay the same across restarts, so marks queued while the stand-in was down still
// find their photo when it comes back.
const photoId = (folderNo, i) => `00000000-0000-4000-8000-${String(folderNo).padStart(2, '0')}${String(i).padStart(10, '0')}`;

function folder(name, depth, count, folderNo) {
  const photos = Array.from({ length: count }, (_, i) => ({
    id: photoId(folderNo, i),
    name: `${name}_${String(i + 1).padStart(4, '0')}.NEF`,
    time: 1700000000 + i * 60,
    rating: 0,
    label: 'none',
    pick: 0,
  }));
  return { source: { id: `f:X:\\Demo\\${name}`, kind: 'folder', name, depth, count }, photos };
}

const folders = [folder('Small', 0, 12, 1), folder('Medium', 0, 60, 2), folder('Large', 0, 600, 3)];
const byId = new Map(folders.flatMap((f) => f.photos).map((photo, i) => [photo.id, { photo, sample: samples[i % samples.length] }]));

const fail = (error) => ({ type: 'application/json', body: JSON.stringify({ ok: false, error }) });
const ok = (data) => ({ type: 'application/json', body: JSON.stringify({ ok: true, data }) });

async function answer({ type, params }) {
  if (type === 'listSources') return ok(folders.map((f) => f.source));
  if (type === 'listPhotos') {
    const found = folders.find((f) => f.source.id === params.sourceId);
    return found ? ok(found.photos) : fail('source_not_found');
  }
  const entry = byId.get(params.photoId);
  if (!entry) return fail('photo_not_found');
  if (type === 'getPreview') return { type: 'image/jpeg', body: await readFile(path.join(previewDir, entry.sample)) };
  if (type === 'setMeta') {
    entry.photo[KEY[params.field]] = params.value;
    console.log(`setMeta ${entry.photo.name} ${params.field}=${params.value}`);
    return ok(true);
  }
  return fail('unknown_command');
}

console.log(`Stand-in plugin polling ${base}. Ctrl+C makes "Lightroom" go offline.`);
for (;;) {
  try {
    const cmd = await (await fetch(`${base}/next`, { headers })).json();
    if (!cmd.id) continue;
    // Like the real plugin: answer in the background and go straight back to polling.
    answer(cmd)
      .then(({ type, body }) => fetch(`${base}/result/${cmd.id}`, { method: 'POST', headers: { ...headers, 'content-type': type }, body }))
      .catch(() => {}); // The server went away; it times the command out on its own.
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 1000)); // The server is not up yet.
  }
}
