import http from 'node:http';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import qrcode from 'qrcode-terminal';
import { createBridge } from './bridge.js';
import { createPreviewStore } from './previews.js';
import { createApp } from './app.js';

const PUBLIC_PORT = 47800;
const PLUGIN_PORT = 47801;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const bridge = createBridge();
const app = createApp({
  bridge,
  previews: createPreviewStore(path.join(root, '.cache', 'previews'), bridge),
  webDir: path.join(root, 'web'),
  vendor: { '/vendor/lucide.svg': path.join(root, 'node_modules', 'lucide-static', 'sprite.svg') },
});

// Both listeners stay on loopback; only PUBLIC_PORT is exposed, through `tailscale serve`.
http.createServer(app.publicHandler).listen(PUBLIC_PORT, '127.0.0.1');
http.createServer(app.pluginHandler).listen(PLUGIN_PORT, '127.0.0.1');

async function tailnetUrl() {
  try {
    const { stdout } = await promisify(execFile)('tailscale', ['status', '--json']);
    const name = JSON.parse(stdout).Self?.DNSName?.replace(/\.$/, '');
    return name ? `https://${name}/` : null;
  } catch {
    return null;
  }
}

const url = await tailnetUrl();
console.log(`Local:   http://127.0.0.1:${PUBLIC_PORT}/`);
if (url) {
  console.log(`Tailnet: ${url}`);
  qrcode.generate(url, { small: true });
} else {
  console.log('Tailscale is not running or not logged in; devices cannot connect yet.');
}
