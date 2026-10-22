# Reelcraft

A personal video highlight finder and MP4 reel editor. Uses local FFmpeg processing with no cloud API, account, or Python packages. Requires Python 3.10+ and FFmpeg/ffprobe with libx264.

## Run

```sh
cd /workspace/Codex
python app.py
```

Open the app on port 8000 on your own machine. The server binds to loopback by default. `PORT` can select another port. Setting `APP_PASSWORD` enables browser password protection (username `reelcraft`). All editor, API, upload and media requests require it; the read-only health check remains public. Public binding requires a password of at least 16 characters. Use HTTPS when hosting; Render provides HTTPS.

Upload a video (2 GB / 4 hours maximum), choose a target length, and review up to five nonoverlapping moments ranked by average audio energy. Adjust the times, preview, choose center-cropped vertical (720×1280), square (720×720), or original framing, and download an H.264/AAC MP4. Exports are limited to 180 seconds.

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
