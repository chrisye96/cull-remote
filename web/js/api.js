// Longer than the server's 30 s command timeout, so server error codes arrive first.
const REQUEST_TIMEOUT_MS = 35000;

async function request(path, options = {}) {
  let res;
  try {
    res = await fetch(path, { ...options, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch {
    throw new Error('network');
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `http_${res.status}`);
  return body;
}

export const getStatus = () => request('/api/status');
export const getSources = () => request('/api/sources');
export const getPhotos = (sourceId) => request(`/api/photos?source=${encodeURIComponent(sourceId)}`);
export const previewUrl = (photoId, size) => `/api/preview/${photoId}?size=${size}`;

export async function sendOp(photoId, field, value) {
  const op = { opId: crypto.randomUUID(), photoId, field, value, ts: Date.now() };
  const { results } = await request('/api/ops', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ops: [op] }),
  });
  if (!results[0].ok) throw new Error(results[0].error);
}
