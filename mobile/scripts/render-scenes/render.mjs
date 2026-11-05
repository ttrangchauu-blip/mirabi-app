// node render.mjs <page.html> <out.png> [w] [h] [samples]: serves this folder, drives headless Chrome, saves the canvas.
import { execSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
const [page, out, w = 780, h = 600, s = 48, extra = ''] = process.argv.slice(2);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream' };
const server = http.createServer((req, res) => {
  const file = path.join(process.cwd(), decodeURIComponent(req.url.split('?')[0]));
  if (!file.startsWith(process.cwd()) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}).listen(9444);
// Kept between runs: the compiled shaders are cached there, which saves two minutes each time.
const profile = path.join(process.cwd(), 'chrome-profile');
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--remote-debugging-port=9445', '--remote-allow-origins=*', `--user-data-dir=${profile}`,
  `--use-angle=${process.env.ANGLE || 'd3d11'}`, '--enable-gpu', '--enable-unsafe-webgpu', '--enable-features=WebGPU', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--disable-gpu-watchdog', `--window-size=${w},${h}`, 'about:blank'], { stdio: 'ignore' });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let target;
for (let i = 0; i < 40 && !target; i++) { try { target = await (await fetch('http://127.0.0.1:9445/json/new?about:blank', { method: 'PUT' })).json(); } catch { await pause(500); } }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => { ws.onopen = r; });
let id = 0; const pend = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown' && !/raster done/.test(JSON.stringify(m.params))) console.log('ERR', (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).slice(0, 500));
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type !== 'log') console.log('CONSOLE', m.params.type, m.params.args.map((a) => a.value || a.description || '').join(' ').slice(0, 900));
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') console.log('LOG', m.params.entry.text.slice(0, 300), m.params.entry.url ?? ''); };
const send = (method, params = {}) => new Promise((r) => { const n = ++id; pend.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true })).result?.result?.value;
await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: +w, height: +h, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `http://localhost:9444/${page}?w=${w}&h=${h}&s=${s}${extra}` });
const started = Date.now(); let last = '';
for (;;) {
  await pause(4000);
  const st = await ev('JSON.stringify({s:window.__state,n:window.__samples,gpu:window.__gpu,ms:window.__ms})');
  if (st !== last) { console.log(st); last = st; }
  if (st && JSON.parse(st).s === 'done') break;
  if (Date.now() - started > +(process.env.LIMIT || 540000)) { console.log('time limit, saving what there is'); break; }
}
await pause(600);
console.log('rect', await ev('window.__rect'));
const jpeg = out.endsWith('.jpg');
// A very big path-traced page can hang here forever: give up, and the run tries again.
const shot = await Promise.race([send('Page.captureScreenshot', jpeg ? { format: 'jpeg', quality: 86 } : { format: 'png' }), pause(120000).then(() => { console.log('screenshot hung'); return {}; })]);
if (shot.result?.data) { fs.writeFileSync(out, Buffer.from(shot.result.data, 'base64')); console.log('saved', out); }
// `kill` leaves Chrome's children on Windows, and they keep the profile locked for the next run.
try { execSync(`taskkill /PID ${chrome.pid} /T /F`, { stdio: 'ignore' }); } catch { chrome.kill(); }
server.close(); process.exit(0);
