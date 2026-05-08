import express from 'express';
import cors from 'cors';
import { spawn } from 'node:child_process';
import { mkdir, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const downloadsDir = path.join(root, 'downloads');
const distDir = path.join(root, 'dist');
const PORT = process.env.PORT || 8787;
const ARCHIVE_PIN = process.env.ARCHIVE_PIN || '2359';
const YTDLP_BIN = process.env.YTDLP_BIN || 'yt-dlp';
const COOKIES_PATH = process.env.COOKIES_PATH || path.join(root, 'cookies.txt');
const YOUTUBE_COOKIES = process.env.YOUTUBE_COOKIES || '';
const TTL_MS = 15 * 60 * 1000;
let busy = false;

await mkdir(downloadsDir, { recursive: true });
if (YOUTUBE_COOKIES.trim()) {
  await writeFile(COOKIES_PATH, YOUTUBE_COOKIES.trim() + '\n', { mode: 0o600 });
}

const allowed = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
const app = express();
app.use(cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true);
    if (allowed.includes('*')) return cb(null, true);
    if (allowed.length === 0 && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return cb(null, true);
    if (allowed.includes(origin)) return cb(null, true);
    cb(null, false);
  }
}));
app.use(express.json({ limit: '1mb' }));

function jsonError(res, status, error) { return res.status(status).json({ success: false, error }); }
function checkPin(req) { return req.get('X-Archive-Pin') === ARCHIVE_PIN || req.query.pin === ARCHIVE_PIN; }
function youtubeOnly(value) {
  try { const u = new URL(value); return ['youtube.com','www.youtube.com','m.youtube.com','youtu.be','music.youtube.com'].includes(u.hostname); }
  catch { return false; }
}
function safeName(name) { return name.replace(/[^a-zA-Z0-9._ -]/g, '_').replace(/\s+/g, ' ').slice(0, 180); }
function bitrateFor(quality) {
  if (quality === '320') return '320k';
  if (quality === '192') return '192k';
  if (quality === '128') return '128k';
  return '192k';
}
async function ytDlpBaseArgs() {
  const args = ['--js-runtimes', 'node'];
  try {
    await stat(COOKIES_PATH);
    args.push('--cookies', COOKIES_PATH);
  } catch {}
  return args;
}
function run(bin, args, timeoutMs = 20 * 60 * 1000) {
  const env = { ...process.env, PATH: `${process.env.HOME || ''}/.local/bin:${process.env.PATH || ''}` };
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { env, cwd: root });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`${bin} timed out`)); }, timeoutMs);
    child.stdout.on('data', d => stdout += d.toString());
    child.stderr.on('data', d => stderr += d.toString());
    child.on('error', err => { clearTimeout(timer); reject(err); });
    child.on('close', code => { clearTimeout(timer); code === 0 ? resolve({ stdout, stderr }) : reject(new Error(stderr || `${bin} exited ${code}`)); });
  });
}
async function cleanup() {
  try {
    const now = Date.now();
    for (const f of await readdir(downloadsDir)) {
      const p = path.join(downloadsDir, f);
      const s = await stat(p);
      if (now - s.mtimeMs > TTL_MS) await unlink(p).catch(() => {});
    }
  } catch {}
}
setInterval(cleanup, 60_000).unref();

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'velvet-archive-api' }));
app.get('/api/diagnostics', async (req, res) => {
  if (!checkPin(req)) return jsonError(res, 401, 'Invalid PIN.');
  const out = { ok: true, service: 'velvet-archive-api', ytDlp: null, ffmpeg: null };
  try { out.ytDlp = (await run(YTDLP_BIN, ['--version'], 30_000)).stdout.trim(); } catch (e) { out.ytDlp = String(e.message || e); out.ok = false; }
  try { out.node = (await run('node', ['--version'], 30_000)).stdout.trim(); } catch (e) { out.node = String(e.message || e); out.ok = false; }
  try { out.cookies = (await ytDlpBaseArgs()).includes('--cookies'); } catch { out.cookies = false; }
  try { out.ffmpeg = (await run('ffmpeg', ['-version'], 30_000)).stdout.split('\n')[0]; } catch (e) { out.ffmpeg = String(e.message || e); out.ok = false; }
  res.status(out.ok ? 200 : 500).json(out);
});

app.post('/api/download', async (req, res) => {
  if (!checkPin(req)) return jsonError(res, 401, 'Invalid PIN.');
  if (busy) return jsonError(res, 429, 'Another download is already running. Try again shortly.');
  const { url, format = 'mp4', quality = 'best' } = req.body || {};
  if (!youtubeOnly(url)) return jsonError(res, 400, 'Only YouTube and youtu.be URLs are allowed.');
  if (!['mp4', 'mp3'].includes(format)) return jsonError(res, 400, 'Invalid format.');
  busy = true;
  const id = crypto.randomBytes(5).toString('hex');
  try {
    await run(YTDLP_BIN, ['--version'], 30_000).catch(e => { throw new Error('yt-dlp is not installed or not available on PATH. ' + e.message); });
    await run('node', ['--version'], 30_000).catch(e => { throw new Error('Node.js runtime is not available for yt-dlp JavaScript extraction. ' + e.message); });
    await run('ffmpeg', ['-version'], 30_000).catch(e => { throw new Error('ffmpeg is not installed or not available on PATH. ' + e.message); });
    const baseArgs = await ytDlpBaseArgs();
    const meta = await run(YTDLP_BIN, [...baseArgs, '--dump-json', '--no-playlist', url], 90_000);
    const info = JSON.parse(meta.stdout.split('\n').filter(Boolean).pop());
    if ((info.duration || 0) > 3 * 60 * 60) return jsonError(res, 400, 'Video is longer than the 3-hour limit.');
    const title = safeName(info.title || 'archive');
    let outputPath;
    let args;
    if (format === 'mp3') {
      outputPath = path.join(downloadsDir, `${title}-${info.id || id}.mp3`);
      args = [
        ...baseArgs,
        '--no-playlist',
        '-f', 'ba/b',
        '--extract-audio',
        '--audio-format', 'mp3',
        '--audio-quality', '0',
        '--postprocessor-args', `ffmpeg:-codec:a libmp3lame -b:a ${bitrateFor(quality)} -ar 44100 -ac 2 -id3v2_version 3`,
        '-o', outputPath,
        url
      ];
    } else {
      outputPath = path.join(downloadsDir, `${title}-${info.id || id}.mp4`);
      const map = { best: 'bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/b', '1080': 'bv*[height<=1080][ext=mp4]+ba[ext=m4a]/b[height<=1080][ext=mp4]/bv*[height<=1080]+ba/b[height<=1080]', '720': 'bv*[height<=720][ext=mp4]+ba[ext=m4a]/b[height<=720][ext=mp4]/bv*[height<=720]+ba/b[height<=720]', '480': 'bv*[height<=480][ext=mp4]+ba[ext=m4a]/b[height<=480][ext=mp4]/bv*[height<=480]+ba/b[height<=480]', '360': 'bv*[height<=360][ext=mp4]+ba[ext=m4a]/b[height<=360][ext=mp4]/bv*[height<=360]+ba/b[height<=360]' };
      args = [...baseArgs, '--no-playlist', '-f', map[quality] || map.best, '--merge-output-format', 'mp4', '--postprocessor-args', 'ffmpeg:-c:v libx264 -preset veryfast -c:a aac -b:a 192k -movflags +faststart', '-o', outputPath, url];
    }
    await run(YTDLP_BIN, args);
    let filename = path.basename(outputPath);
    try { await stat(outputPath); } catch {
      const files = (await readdir(downloadsDir)).filter(f => f.includes(info.id || id)).sort();
      if (!files.length) throw new Error('Download completed but no output file was found.');
      filename = files[files.length - 1];
    }
    setTimeout(() => unlink(path.join(downloadsDir, filename)).catch(() => {}), TTL_MS).unref();
    res.json({ success: true, title: info.title || 'Archive', filename, downloadUrl: `/api/file/${encodeURIComponent(filename)}?pin=${encodeURIComponent(ARCHIVE_PIN)}` });
  } catch (e) {
    const msg = String(e.message || e).slice(0, 1200);
    res.status(500).json({ success: false, error: msg });
  } finally { busy = false; cleanup(); }
});

app.get('/api/file/:filename', async (req, res) => {
  if (!checkPin(req)) return jsonError(res, 401, 'Invalid PIN.');
  const filename = path.basename(req.params.filename);
  const full = path.join(downloadsDir, filename);
  if (!full.startsWith(downloadsDir)) return jsonError(res, 400, 'Invalid filename.');
  res.download(full, filename, err => { if (!res.headersSent && err) jsonError(res, 404, 'File not found or expired.'); });
});

app.use(express.static(distDir));
app.use((req, res, next) => {
  if (req.method !== 'GET' || req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(distDir, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => console.log(`Velvet Archive API listening on ${PORT}`));
