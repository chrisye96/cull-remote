import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { BridgeError } from './bridge.js';
import { PHOTO_ID, validateOp } from './validate.js';
import { SIZES } from './previews.js';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
};
const STATUS = { lr_offline: 503, lr_busy: 503, lr_timeout: 504, photo_not_found: 404, source_not_found: 404 };
const RETRYABLE = new Set(['lr_offline', 'lr_busy', 'lr_timeout']);

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readBody(req, limit) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > limit) throw new BridgeError('body_too_large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export function createApp({ bridge, previews, webDir, vendor = {}, pollMs = 25000 }) {
  // ponytail: in-memory, forgotten on restart. Ops are "set field to value", so a
  // replay after a restart is harmless; persist only if that ever stops being true.
  const doneOps = new Set();
  const root = path.resolve(webDir);

  async function applyOps(ops) {
    const results = [];
    let halted = null;
    for (const op of ops) {
      const opId = op?.opId ?? null;
      const invalid = validateOp(op);
      if (invalid) {
        results.push({ opId, ok: false, error: invalid, retryable: false });
      } else if (doneOps.has(opId)) {
        results.push({ opId, ok: true });
      } else if (halted) {
        results.push({ opId, ok: false, error: halted, retryable: true });
      } else {
        try {
          await bridge.send('setMeta', { photoId: op.photoId, field: op.field, value: op.value });
          doneOps.add(opId);
          results.push({ opId, ok: true });
        } catch (e) {
          if (!(e instanceof BridgeError)) throw e;
          const retryable = RETRYABLE.has(e.code);
          // Later ops must not overtake a retryable failure, or ordering breaks.
          if (retryable) halted = e.code;
          results.push({ opId, ok: false, error: e.code, retryable });
        }
      }
    }
    return results;
  }

  async function api(req, res, url) {
    const { pathname } = url;
    if (req.method === 'GET' && pathname === '/api/status') {
      return sendJson(res, 200, { lrOnline: bridge.isOnline() });
    }
    if (req.method === 'GET' && pathname === '/api/sources') {
      return sendJson(res, 200, await bridge.send('listSources'));
    }
    if (req.method === 'GET' && pathname === '/api/photos') {
      const sourceId = url.searchParams.get('source') ?? '';
      if (!/^[fc]:.+/.test(sourceId)) return sendJson(res, 400, { error: 'invalid_source' });
      return sendJson(res, 200, await bridge.send('listPhotos', { sourceId }));
    }
    const preview = pathname.match(/^\/api\/preview\/([^/]+)$/);
    if (req.method === 'GET' && preview) {
      const size = url.searchParams.get('size') ?? '';
      if (!PHOTO_ID.test(preview[1]) || !Object.hasOwn(SIZES, size)) return sendJson(res, 400, { error: 'invalid_preview' });
      const jpeg = await previews.get(preview[1], size);
      res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'private, max-age=3600' });
      return res.end(jpeg);
    }
    if (req.method === 'POST' && pathname === '/api/ops') {
      let ops;
      try {
        ops = JSON.parse((await readBody(req, 1024 * 1024)).toString('utf8')).ops;
      } catch {
        return sendJson(res, 400, { error: 'invalid_body' });
      }
      if (!Array.isArray(ops)) return sendJson(res, 400, { error: 'invalid_body' });
      return sendJson(res, 200, { results: await applyOps(ops) });
    }
    return sendJson(res, 404, { error: 'not_found' });
  }

  async function sendFile(res, file) {
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
      res.end(body);
    } catch {
      sendJson(res, 404, { error: 'not_found' });
    }
  }

  async function serveStatic(res, pathname) {
    if (Object.hasOwn(vendor, pathname)) return sendFile(res, vendor[pathname]);
    let rel;
    try {
      rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname.slice(1));
    } catch {
      return sendJson(res, 400, { error: 'bad_path' });
    }
    const file = path.resolve(root, rel);
    if (!file.startsWith(root + path.sep)) return sendJson(res, 403, { error: 'forbidden' });
    return sendFile(res, file);
  }

  async function publicHandler(req, res) {
    try {
      let url;
      try {
        url = new URL(req.url, 'http://localhost');
      } catch {
        return sendJson(res, 400, { error: 'bad_request' });
      }
      if (url.pathname.startsWith('/api/')) return await api(req, res, url);
      return await serveStatic(res, url.pathname);
    } catch (e) {
      if (e instanceof BridgeError) return sendJson(res, Object.hasOwn(STATUS, e.code) ? STATUS[e.code] : 502, { error: e.code });
      console.error(e);
      return sendJson(res, 500, { error: 'internal' });
    }
  }

  async function pluginHandler(req, res) {
    try {
      let url;
      try {
        url = new URL(req.url, 'http://localhost');
      } catch {
        return sendJson(res, 400, { error: 'bad_request' });
      }
      if (req.method === 'GET' && url.pathname === '/next') {
        const ac = new AbortController();
        res.on('close', () => {
          if (!res.writableEnded) ac.abort();
        });
        return sendJson(res, 200, (await bridge.next(pollMs, ac.signal)) ?? {});
      }
      const result = url.pathname.match(/^\/result\/([\w-]+)$/);
      if (req.method === 'POST' && result) {
        const body = await readBody(req, 32 * 1024 * 1024);
        if ((req.headers['content-type'] ?? '').startsWith('image/')) {
          bridge.complete(result[1], null, body);
        } else {
          const reply = JSON.parse(body.toString('utf8'));
          bridge.complete(result[1], reply.ok ? null : String(reply.error ?? 'plugin_error'), reply.data);
        }
        return sendJson(res, 200, {});
      }
      return sendJson(res, 404, { error: 'not_found' });
    } catch (e) {
      console.error(e);
      return sendJson(res, 500, { error: 'internal' });
    }
  }

  return { publicHandler, pluginHandler };
}
