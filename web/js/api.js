// Longer than the server's 30 s command timeout, so server error codes arrive first.
const REQUEST_TIMEOUT_MS = 35000;
// The status probe decides between Lightroom and the offline copy, so it gives up early.
const STATUS_TIMEOUT_MS = 5000;

async function request(path, { timeoutMs = REQUEST_TIMEOUT_MS, ...options } = {}) {
  let res;
  try {
    res = await fetch(path, { ...options, signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    throw new Error('network');
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `http_${res.status}`);
  return body;
}

export const getStatus = () => request('/api/status', { timeoutMs: STATUS_TIMEOUT_MS });
export const getInfo = () => request('/api/info', { timeoutMs: STATUS_TIMEOUT_MS });
export const getSources = () => request('/api/sources');
export const getPhotos = (sourceId) => request(`/api/photos?source=${encodeURIComponent(sourceId)}`);
export const previewUrl = (photoId, size) => `/api/preview/${photoId}?size=${size}`;

// Submit marks in order. Resolves with one result per op: { opId, ok, error?, retryable? }.
export async function sendOps(ops) {
  const { results } = await request('/api/ops', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ops }),
  });
  return results;
}
