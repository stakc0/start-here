# Velvet Archive

Private PIN-gated YouTube downloader for personal, rights-cleared material.

## Local

Install yt-dlp and ffmpeg, then:

```bash
npm install
npm run build
npm run server
```

Open http://localhost:8787 and use PIN `2359`.

## Railway

Railway uses `nixpacks.toml` to install Node, ffmpeg, Python/pip, and yt-dlp.

Set variables:

```txt
ARCHIVE_PIN=2359
ALLOWED_ORIGINS=https://YOUR-RAILWAY-DOMAIN.up.railway.app,https://personal-youtube-dow-77br.bolt.host
```

Health check:

```txt
/api/health
```

If using a separate Bolt frontend, set:

```txt
VITE_BACKEND_URL=https://YOUR-RAILWAY-DOMAIN.up.railway.app
```

Files auto-delete after 15 minutes. The backend allows one download at a time and rejects non-YouTube URLs.
