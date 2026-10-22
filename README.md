# Reelcraft

A personal video highlight finder and MP4 reel editor. Uses local FFmpeg processing with no cloud API, account, or Python packages. Requires Python 3.10+ and FFmpeg/ffprobe with libx264.

## Run

```sh
cd /workspace/Codex
python app.py
```

Open the app on port 8000 on your own machine. The server binds to loopback by default. `PORT` can select another port. Setting `APP_PASSWORD` enables browser password protection (username `reelcraft`). All editor, API, upload and media requests require it; the read-only health check remains public. Public binding requires a password of at least 16 characters. Use HTTPS when hosting; Render provides HTTPS.

Upload a video (2 GB / 4 hours maximum) and mark your own moments using the default manual mode. Alternatively, enable audio-energy suggestions to review up to five nonoverlapping passages. Adjust the times, preview, choose center-cropped vertical (720×1280), square (720×720), or original framing, and download an H.264/AAC MP4. Exports are limited to 180 seconds.

### Manual editing (default)

Choose "Choose my own moments" and click **Open video**. This skips energy analysis. Watch or seek through the full source, pause and click **Set start here**, then find the ending and click **Set end here**. You can also type exact times in seconds. Give the moment a title and click **Save moment**. Choose **New moment** to make another; click a saved moment to adjust and save it, or Delete to remove it. Saved ranges exist only in the current tab and are lost on reload.

Use **Preview selection** to check the cut, then **Export MP4** for each moment you want to keep. **Original** framing preserves the full source composition for editing elsewhere. Download the resulting MP4 and import it into CapCut or upload it into Canva. Add captions, effects, reframing and final publishing there. These are standard video exports, not native Canva/CapCut projects or a direct account integration. The app does not currently include automatic captions, effects or speaker tracking.

Audio energy is a heuristic: it does not understand the story, transcribe speech, detect faces, or predict virality. Silent videos receive chronological suggestions. Review crops and context before posting. Social publishing is manual. Browser playback depends on the source codec; MP4/H.264 is recommended.

Files remain under ignored `data/` until manually deleted. Stop the server before removing that directory. Job metadata is in memory; after a restart, upload the source again. Processing is designed for one personal user, not concurrent public traffic.

## Verify

```sh
python -m unittest discover -s tests -v
```

Tests generate a real video, upload it, analyze it, export a vertical clip, and inspect the result with ffprobe. No network service or API key required.

## Render deployment

Create a Web Service connected to this repository. Select Docker, branch `main`, leave Root Directory and Docker Command blank, and use the root `Dockerfile`. Set the health check path to `/api/health` under Advanced. Add `APP_PASSWORD` in Render's Environment Variables with a private password of at least 16 characters; never put it in Git or chat. The username at the browser prompt is `reelcraft`.

The Docker image installs FFmpeg and runs as an unprivileged user on `0.0.0.0:$PORT`. Startup fails if the hosted password is missing or too short. Render's free plan can be used for small trial videos, but it has limited resources and ephemeral storage. No persistent disk is configured. Files and in-memory jobs can disappear at restart or redeploy; download your reels immediately. Free instances may sleep. Large videos or processing jobs may exceed hosting limits. This app is for one personal user and is not a multi-user video processing service.

On a paid service with a persistent disk, mount it at `/var/data` and set `DATA_DIR=/var/data/reelcraft`. Files then persist but job metadata still resets at restart. No automatic deletion is configured: monitor disk usage and remove old files when the server is stopped.

Optional frontend regression checks: `node --test tests/test_frontend.cjs` (Node.js is only needed for these tests).

Optional browser smoke test: start `PORT=8001 python app.py`, then run `node tests/test_browser.cjs` with Playwright and Chromium installed. It exercises manual marking, multiple saved moments, preview playback, original-frame export and download.
