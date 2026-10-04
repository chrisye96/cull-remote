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

// DNS-rebinding defence: a page on another origin can resolve its own hostname to
// 127.0.0.1, but the browser still sends that hostname in Host. Only accept the
// local address and Tailscale names (tailscale serve proxies HTTPS on :443).
const TAILNET_HOST = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.ts\.net(:443)?$/;
const localOrTailnet = (port) => {
  const local = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  return (host) => local.has(host) || TAILNET_HOST.test(host);
};

// A request target such as `//` makes the URL constructor throw; treat it as a bad request.
function parseUrl(req) {
  try {
    return new URL(req.url, 'http://localhost');
  } catch {
    return null;
  }
}

const NOSNIFF = { 'x-content-type-options': 'nosniff' };
const DONE_OPS_CAP = 5000;

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...NOSNIFF });
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

export function createApp({ bridge, previews, webDir, vendor = {}, pollMs = 25000, publicPort = 47800, allowedHost = localOrTailnet(publicPort), atHome = async () => null, version = '' }) {
  // ponytail: in-memory, forgotten on restart, and only the newest DONE_OPS_CAP ids are
  // kept. Ops are "set field to value", so a replay is harmless; persist only if that
  // ever stops being true.
  const doneOps = new Set();
  const root = path.resolve(webDir);

  function rememberDone(opId) {
    doneOps.add(opId);
    // A Set iterates in insertion order, so the first value is the oldest.
    if (doneOps.size > DONE_OPS_CAP) doneOps.delete(doneOps.values().next().value);
  }

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
          await bridge.send('setMeta', { photoId: op.photoId, field: op.field, value: op.value }, { urgent: true });
          rememberDone(opId);
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
    if (req.method === 'GET' && pathname === '/api/info') {
      const startedAt = Date.now();
      const home = await atHome(req);
      res.setHeader('server-timing', `home;dur=${Date.now() - startedAt}`);
      return sendJson(res, 200, { atHome: home, version });
    }
    if (req.method === 'GET' && pathname === '/api/sources') {
      // Lists go ahead of queued previews: a caching run must not hold up opening a folder.
      return sendJson(res, 200, await bridge.send('listSources', {}, { urgent: true }));
    }
    if (req.method === 'GET' && pathname === '/api/photos') {
      const sourceId = url.searchParams.get('source') ?? '';
      if (!/^[fc]:.+/.test(sourceId)) return sendJson(res, 400, { error: 'invalid_source' });
      // How long the list waited behind other commands and how long Lightroom took,
      // readable in the browser's network panel and through the Resource Timing API.
      const timing = {};
      const photos = await bridge.send('listPhotos', { sourceId }, { urgent: true, timing });
      res.setHeader('server-timing', `queue;dur=${timing.wait}, lr;dur=${timing.run}`);
      return sendJson(res, 200, photos);
    }
    const preview = pathname.match(/^\/api\/preview\/([^/]+)$/);
    if (req.method === 'GET' && preview) {
      const size = url.searchParams.get('size') ?? '';
      if (!PHOTO_ID.test(preview[1]) || !Object.hasOwn(SIZES, size)) return sendJson(res, 400, { error: 'invalid_preview' });
      const jpeg = await previews.get(preview[1], size);
      res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'private, max-age=3600', ...NOSNIFF });
      return res.end(jpeg);
    }
    if (req.method === 'POST' && pathname === '/api/ops') {
      // Refuses cross-site "simple" form posts (text/plain), which skip CORS preflight.
      if (!(req.headers['content-type'] ?? '').startsWith('application/json')) return sendJson(res, 415, { error: 'unsupported_media_type' });
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
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache', ...NOSNIFF });
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
      if (!allowedHost(String(req.headers.host ?? '').toLowerCase())) return sendJson(res, 421, { error: 'bad_host' });
      const url = parseUrl(req);
      if (!url) return sendJson(res, 400, { error: 'bad_request' });
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
      const url = parseUrl(req);
      if (!url) return sendJson(res, 400, { error: 'bad_request' });
      // A custom header forces a CORS preflight, so a web page cannot park a poll or
      // forge a result with <img>, <form> or a simple fetch.
      const isPluginCall = url.pathname === '/next' || url.pathname.startsWith('/result/');
      if (isPluginCall && req.headers['x-lrc-plugin'] !== '1') return sendJson(res, 403, { error: 'forbidden' });
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
