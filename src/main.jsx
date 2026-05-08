import React, { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Lock, LogOut, Music, Video, Download, Sparkles, RotateCcw } from 'lucide-react';
import './styles.css';

const PIN = '2359';
const API_BASE = (import.meta.env.VITE_BACKEND_URL || '').replace(/\/$/, '');

function isYoutubeUrl(value) {
  try {
    const u = new URL(value);
    return ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be', 'music.youtube.com'].includes(u.hostname);
  } catch {
    return false;
  }
}

function PinGate({ onUnlock }) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  function submit(e) {
    e.preventDefault();
    if (pin === PIN) {
      sessionStorage.setItem('velvet-pin', pin);
      onUnlock();
    } else {
      setError('Incorrect PIN.');
      setPin('');
    }
  }
  return <main className="gate-shell">
    <form className="gate-card" onSubmit={submit}>
      <div className="crest"><Lock size={22}/></div>
      <p className="eyebrow">Private Collection</p>
      <h1>Velvet Archive</h1>
      <label>Access PIN</label>
      <input autoFocus inputMode="numeric" type="password" value={pin} placeholder="••••" onChange={e => { setPin(e.target.value); setError(''); }} />
      {error && <p className="error">{error}</p>}
      <button disabled={pin.length === 0}>Unlock</button>
      <p className="fineprint">Authorized personnel only</p>
    </form>
  </main>;
}

const videoQualities = [
  ['best', 'Best available'], ['1080', '1080p'], ['720', '720p'], ['480', '480p'], ['360', '360p']
];
const audioQualities = [
  ['audio-best', 'Best audio'], ['320', '320 kbps'], ['192', '192 kbps'], ['128', '128 kbps']
];

function App() {
  const [unlocked, setUnlocked] = useState(() => sessionStorage.getItem('velvet-pin') === PIN);
  const [url, setUrl] = useState('');
  const [format, setFormat] = useState('mp4');
  const [quality, setQuality] = useState('best');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  const qualities = useMemo(() => format === 'mp4' ? videoQualities : audioQualities, [format]);
  function switchFormat(next) {
    setFormat(next);
    setQuality(next === 'mp4' ? 'best' : 'audio-best');
    setResult(null); setError('');
  }
  function lock() { sessionStorage.removeItem('velvet-pin'); setUnlocked(false); }
  function reset() { setUrl(''); setFormat('mp4'); setQuality('best'); setResult(null); setError(''); setStatus(''); }

  async function submit(e) {
    e.preventDefault();
    setError(''); setResult(null);
    if (!isYoutubeUrl(url)) { setError('Paste a valid YouTube or youtu.be URL.'); return; }
    setLoading(true); setStatus('Preparing archive request…');
    try {
      const res = await fetch(`${API_BASE}/api/download`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Archive-Pin': sessionStorage.getItem('velvet-pin') || PIN },
        body: JSON.stringify({ url, format, quality })
      });
      const text = await res.text();
      let data;
      try { data = JSON.parse(text); } catch { data = { error: text || 'Non-JSON server response.' }; }
      if (!res.ok || !data.success) {
        if (res.status === 404) throw new Error('Backend not connected. Deploy or run the downloader backend and set VITE_BACKEND_URL.');
        throw new Error(data.error || data.message || 'Download failed.');
      }
      setResult({ ...data, downloadUrl: data.downloadUrl?.startsWith('http') ? data.downloadUrl : `${API_BASE}${data.downloadUrl}` });
      setStatus('Archive prepared.');
    } catch (err) {
      setError(err.message || 'Backend service is not running.');
      setStatus('');
    } finally { setLoading(false); }
  }

  if (!unlocked) return <PinGate onUnlock={() => setUnlocked(true)} />;
  return <>
    <header className="topbar"><div><span className="brand">Velvet Archive</span><span className="subbrand">Private Collection</span></div><button className="ghost" onClick={lock}><LogOut size={16}/> Lock</button></header>
    <main className="app-shell">
      <section className="intro"><p className="eyebrow"><Sparkles size={15}/> Archive Request</p><h1>Curate a new addition</h1><p>Paste a source, choose your preferred format, and receive a private, temporary link to your file.</p></section>
      <form className="panel" onSubmit={submit}>
        <label>Source URL</label>
        <input className="url-input" value={url} onChange={e => setUrl(e.target.value)} placeholder="Paste YouTube URL…" disabled={loading}/>
        <label>Format</label>
        <div className="toggle-grid">
          <button type="button" className={format === 'mp4' ? 'selected' : ''} onClick={() => switchFormat('mp4')}><Video/> <span>MP4 Video<small>Full visual archive</small></span></button>
          <button type="button" className={format === 'mp3' ? 'selected' : ''} onClick={() => switchFormat('mp3')}><Music/> <span>MP3 Audio<small>Sound only</small></span></button>
        </div>
        <label>Quality</label>
        <div className="quality-grid">{qualities.map(([v, l]) => <button type="button" key={v} className={quality === v ? 'selected' : ''} onClick={() => setQuality(v)}>{l}</button>)}</div>
        {status && <div className="status">{loading && <span className="spinner"/>}{status}</div>}
        {error && <div className="error box">{error}</div>}
        {result && <div className="result"><p className="eyebrow">Ready</p><h2>{result.title || 'Prepared archive'}</h2><p>{format.toUpperCase()} · {qualities.find(q => q[0] === quality)?.[1]}</p><a className="download" href={result.downloadUrl}><Download size={18}/> Download file</a><button type="button" className="ghost dark" onClick={reset}><RotateCcw size={16}/> Start another</button></div>}
        <button className="prepare" disabled={loading || !url}>{loading ? 'Preparing…' : 'Prepare Download'}</button>
        <p className="fineprint">For personal, rights-cleared material only. Temporary files expire after 15 minutes.</p>
      </form>
    </main>
  </>;
}

createRoot(document.getElementById('root')).render(<App />);
