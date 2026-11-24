#!/usr/bin/env node
// Renders the logo's bitmap sizes from the SVGs in public/, with headless Chrome:
//   public/favicon.ico           16 and 32 px, for browsers without SVG favicons
//   public/apple-touch-icon.png  180 px on parchment, for phone home screens
//
// Run after changing the logo:  npm run favicons
// Uses the Chrome at CHROME_PATH, else the usual Windows install.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const chromePath = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const port = 9341;

const svg = (file) => readFileSync(join('public', file), 'utf8');

const renders = [
  // The favicon sits on its own parchment tile, so it shows on light and dark tab bars.
  { name: 'ico-16', size: 16, svg: svg('favicon.svg') },
  { name: 'ico-32', size: 32, svg: svg('favicon.svg') },
  // iOS shows no transparency: the full logo on parchment, with room around it.
  { name: 'apple-touch-icon', size: 180, svg: svg('logo.svg'), background: '#f1e4c8', inset: 0.12 },
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const profile = mkdtempSync(join(tmpdir(), 'samwise-favicons-'));
const chrome = spawn(chromePath, [
  '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', 'about:blank',
], { stdio: 'ignore' });

try {
  let targets;
  for (let i = 0; i < 50 && !targets; i++) {
    await sleep(200);
    targets = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json()).catch(() => null);
  }
  if (!targets) throw new Error(`Chrome didn't start (${chromePath}); set CHROME_PATH.`);
  const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve) => ws.addEventListener('open', resolve));
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const msgId = ++id;
    pending.set(msgId, (msg) => (msg.error ? reject(new Error(`${method}: ${msg.error.message}`)) : resolve(msg.result)));
    ws.send(JSON.stringify({ id: msgId, method, params }));
  });

  await send('Page.enable');
  await send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
  // A roomy viewport: headless Chrome won't really shrink to 16 px, which once left the
  // tiny icons showing a zoomed-in corner. The screenshot clips each icon out of it.
  await send('Emulation.setDeviceMetricsOverride', { width: 400, height: 400, deviceScaleFactor: 1, mobile: false });
  const png = {};
  for (const r of renders) {
    const pad = Math.round(r.size * (r.inset ?? 0));
    const inner = r.size - 2 * pad;
    const { frameTree } = await send('Page.getFrameTree');
    await send('Page.setDocumentContent', {
      frameId: frameTree.frame.id,
      html: `<!doctype html><html><body style="margin:0;background:transparent">
        <div style="width:${r.size}px;height:${r.size}px;padding:${pad}px;box-sizing:border-box;background:${r.background ?? 'transparent'}">
          ${r.svg.replace('<svg ', `<svg width="${inner}" height="${inner}" style="display:block" `)}
        </div></body></html>`,
    });
    await sleep(200);
    const { data } = await send('Page.captureScreenshot', {
      format: 'png',
      clip: { x: 0, y: 0, width: r.size, height: r.size, scale: 1 },
    });
    png[r.name] = Buffer.from(data, 'base64');
  }
  ws.close();

  writeFileSync('public/apple-touch-icon.png', png['apple-touch-icon']);
  writeFileSync('public/favicon.ico', ico([[16, png['ico-16']], [32, png['ico-32']]]));
  console.log('Wrote public/favicon.ico (16, 32 px) and public/apple-touch-icon.png (180 px).');
} finally {
  chrome.kill();
  await sleep(300);
  rmSync(profile, { recursive: true, force: true });
}

/** An .ico file holding PNG images (supported by every current browser). */
function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);
  const entries = [];
  let offset = 6 + 16 * images.length;
  for (const [size, data] of images) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size, 0); // width
    entry.writeUInt8(size, 1); // height
    entry.writeUInt8(0, 2); // no palette
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // colour planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    offset += data.length;
  }
  return Buffer.concat([header, ...entries, ...images.map(([, data]) => data)]);
}
