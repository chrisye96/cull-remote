import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import qrcode from 'qrcode-terminal';
import pkg from '../package.json' with { type: 'json' };
import { createBridge } from './bridge.js';
import { createPreviewStore } from './previews.js';
import { createApp } from './app.js';
import { atHome, clientIp } from './home.js';

// LRC_DEV=1 runs a second instance for testing beside the one in daily use.
const dev = process.env.LRC_DEV === '1';
const PUBLIC_PORT = dev ? 47810 : 47800;
const PLUGIN_PORT = dev ? 47811 : 47801;
const STATUS_MAX_AGE_MS = 10000;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function readTailscaleStatus() {
  try {
    const { stdout } = await promisify(execFile)('tailscale', ['status', '--json'], { timeout: 3000, maxBuffer: 8 * 1024 * 1024 });
    return JSON.parse(stdout);
  } catch {
    return null; // Not installed, not running, or too slow.
  }
}

// The answer is reused for a few seconds, so a burst of requests starts one process.
let statusCache = { at: -Infinity, value: Promise.resolve(null) };
function tailscaleStatus() {
  if (Date.now() - statusCache.at > STATUS_MAX_AGE_MS) statusCache = { at: Date.now(), value: readTailscaleStatus() };
  return statusCache.value;
}

const bridge = createBridge();
const app = createApp({
  bridge,
  previews: createPreviewStore(path.join(root, '.cache', dev ? 'dev-previews' : 'previews'), bridge),
  webDir: path.join(root, 'web'),
  vendor: { '/vendor/lucide.svg': path.join(root, 'node_modules', 'lucide-static', 'sprite.svg') },
  publicPort: PUBLIC_PORT,
  atHome: async (req) => atHome(await tailscaleStatus(), clientIp(req), os.networkInterfaces()),
  version: pkg.version,
});

// Both listeners stay on loopback; only PUBLIC_PORT is exposed, through `tailscale serve`.
http.createServer(app.publicHandler).listen(PUBLIC_PORT, '127.0.0.1');
http.createServer(app.pluginHandler).listen(PLUGIN_PORT, '127.0.0.1');

const name = (await tailscaleStatus())?.Self?.DNSName?.replace(/\.$/, '');
console.log(`Local:   http://127.0.0.1:${PUBLIC_PORT}/`);
if (dev) {
  console.log('Development instance: start the stand-in plugin with `node spike/stand-in-plugin.mjs`.');
} else if (name) {
  console.log(`Tailnet: https://${name}/`);
  qrcode.generate(`https://${name}/`, { small: true });
} else {
  console.log('Tailscale is not running or not logged in; devices cannot connect yet.');
}
