"""Personal, local-only reel editor. Requires Python 3.10+ and FFmpeg."""
import array
import base64
import hmac
import json
import math
import os
from pathlib import Path
import re
import shutil
import subprocess
import threading
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = Path(__file__).resolve().parent
DATA = Path(os.getenv('DATA_DIR', str(ROOT / 'data')))
DATA.mkdir(parents=True, exist_ok=True)
JOBS = {}
MAX_UPLOAD = 2 * 1024**3


def run(args):
    return subprocess.run(args, check=True, capture_output=True)


def probe(path):
    info = json.loads(run(['ffprobe', '-v', 'error', '-show_format', '-show_streams', '-of', 'json', str(path)]).stdout)
    if not any(s['codec_type'] == 'video' for s in info['streams']):
        raise ValueError('Please upload a file with a video track.')
    duration = float(info['format']['duration'])
    if not math.isfinite(duration) or duration <= 0 or duration > 4 * 3600:
        raise ValueError('Videos must be between 0 seconds and 4 hours.')
    return duration, any(s['codec_type'] == 'audio' for s in info['streams'])


def select_clips(energies, duration, length):
    length = min(length, duration)
    candidates = []
    for start in range(0, max(1, math.ceil(duration - length) + 1), max(1, int(length / 4))):
        end = min(duration, start + length)
        values = energies[start:math.ceil(end)]
        score = sum(values) / max(1, len(values))
        candidates.append((score, float(start), end))
    chosen = []
    for score, start, end in sorted(candidates, key=lambda c: (-c[0], c[1])):
        if all(end <= c['start'] or start >= c['end'] for c in chosen):
            chosen.append(dict(start=start, end=end, energy=round(score, 4)))
        if len(chosen) == 5:
            break
    return chosen


def analyze(key, length):
    job = JOBS[key]
    try:
        path = DATA / key / 'source'
        duration, audio = probe(path)
        energies = []
        if audio:
            pcm = DATA / key / 'audio.pcm'
            run(['ffmpeg', '-v', 'error', '-y', '-i', str(path), '-vn', '-ac', '1', '-ar', '8000', '-f', 's16le', str(pcm)])
            with pcm.open('rb') as f:
                while chunk := f.read(16000):
                    samples = array.array('h', chunk)
                    if __import__('sys').byteorder != 'little':
                        samples.byteswap()
                    energies.append(math.sqrt(sum(x*x for x in samples) / max(1, len(samples))) / 32768)
            pcm.unlink()
        clips = select_clips(energies, duration, length)
        job.update(status='ready', duration=duration, audio=audio, clips=clips,
                   waveform=energies[::max(1, len(energies)//120)])
    except (ValueError, KeyError, subprocess.CalledProcessError) as exc:
        job.update(status='error', error=str(exc) if isinstance(exc, ValueError) else 'Unable to decode this video. Try an MP4 with H.264 video.')


def export_clip(key, options):
    source = DATA / key / 'source'
    duration, _ = probe(source)
    start, end = float(options['start']), float(options['end'])
    if not all(math.isfinite(x) for x in [start, end]) or not (0 <= start < end <= duration) or end - start > 180:
        raise ValueError('Choose a valid clip between 0 and 180 seconds.')
    framing = options.get('framing', 'vertical')
    filters = {'vertical': 'scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,setsar=1',
               'square': 'scale=720:720:force_original_aspect_ratio=increase,crop=720:720,setsar=1',
               'original': 'scale=trunc(iw/2)*2:trunc(ih/2)*2,setsar=1'}
    if framing not in filters:
        raise ValueError('Unknown framing.')
    name = uuid.uuid4().hex + '.mp4'
    run(['ffmpeg', '-v', 'error', '-y', '-ss', str(start), '-i', str(source), '-t', str(end-start),
         '-map', '0:v:0', '-map', '0:a:0?', '-vf', filters[framing], '-c:v', 'libx264', '-threads', '2',
         '-preset', 'fast', '-crf', '22', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k',
         '-movflags', '+faststart', str(DATA / key / name)])
    return f'/media/{key}/{name}'


class Handler(BaseHTTPRequestHandler):
    def authorized(self):
        password = os.getenv('APP_PASSWORD', '')
        if not password:
            return True
        expected = base64.b64encode(('reelcraft:' + password).encode()).decode()
        if hmac.compare_digest(self.headers.get('Authorization', '').encode(), ('Basic ' + expected).encode()):
            return True
        self.send_response(401)
        self.send_header('WWW-Authenticate', 'Basic realm="Reelcraft", charset="UTF-8"')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', '0')
        self.end_headers()
        return False

    def reply(self, status, data):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = self.path.split('?')[0]
        if path != '/api/health' and not self.authorized():
            return
        if path.startswith('/api/jobs/'):
            job = JOBS.get(path.rsplit('/', 1)[-1])
            return self.reply(200 if job else 404, job or {'error': 'Video not found.'})
        if path == '/api/health':
            return self.reply(200, {'status': 'ok', 'ffmpeg': bool(shutil.which('ffmpeg') and shutil.which('ffprobe'))})
        match = re.fullmatch(r'/media/([a-f0-9]{32})/(source|[a-f0-9]{32}\.mp4)', path)
        file = DATA / match[1] / match[2] if match else ROOT / 'static' / {'/': 'index.html', '/app.js': 'app.js', '/style.css': 'style.css', '/connect.js': 'connect.js'}.get(path, 'missing')
        if not file.is_file():
            return self.reply(404, {'error': 'Not found.'})
        size = file.stat().st_size
        start, end = 0, size-1
        range_header = self.headers.get('Range')
        if range_header:
            r = re.fullmatch(r'bytes=(\d+)-(\d*)', range_header)
            if not r or int(r[1]) >= size:
                self.send_response(416)
                self.send_header('Content-Range', f'bytes */{size}')
                self.end_headers()
                return
            start, end = int(r[1]), min(int(r[2]) if r[2] else end, end)
        self.send_response(206 if range_header else 200)
        self.send_header('Content-Type', 'video/mp4' if match else {'.html':'text/html', '.js':'text/javascript', '.css':'text/css'}.get(file.suffix, 'application/octet-stream'))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Accept-Ranges', 'bytes')
        self.send_header('Content-Length', str(end-start+1))
        if range_header:
            self.send_header('Content-Range', f'bytes {start}-{end}/{size}')
        self.end_headers()
        try:
            with file.open('rb') as f:
                f.seek(start)
                remaining = end-start+1
                while remaining:
                    chunk = f.read(min(1024*1024, remaining))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    remaining -= len(chunk)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def do_POST(self):
        if not self.authorized():
            return
        # Same-origin browser requests only; no cross-origin upload/export access.
        origin = self.headers.get('Origin')
        if origin and origin.split('://', 1)[-1] != self.headers.get('Host'):
            return self.reply(403, {'error': 'Cross-origin requests are not allowed.'})
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if self.path.startswith('/api/upload?'):
                if not 0 < size <= MAX_UPLOAD:
                    return self.reply(413, {'error': 'Choose a video smaller than 2 GB.'})
                from urllib.parse import parse_qs, urlsplit
                length = int(parse_qs(urlsplit(self.path).query).get('length', ['30'])[0])
                if length not in [15, 30, 60]:
                    raise ValueError('Choose 15, 30, or 60 seconds.')
                key = uuid.uuid4().hex
                folder = DATA / key
                folder.mkdir()
                with (folder / 'source').open('wb') as f:
                    remaining = size
                    while remaining:
                        chunk = self.rfile.read(min(1024*1024, remaining))
                        if not chunk:
                            raise ValueError('Upload interrupted.')
                        f.write(chunk)
                        remaining -= len(chunk)
                JOBS[key] = {'status': 'analyzing', 'id': key}
                threading.Thread(target=analyze, args=(key, length), daemon=True).start()
                return self.reply(202, {'id': key})
            match = re.fullmatch(r'/api/export/([a-f0-9]{32})', self.path)
            if match and JOBS.get(match[1], {}).get('status') == 'ready':
                if not 0 < size <= 4096:
                    raise ValueError('Invalid export request.')
                options = json.loads(self.rfile.read(size))
                return self.reply(200, {'url': export_clip(match[1], options)})
            return self.reply(404, {'error': 'Video not found.'})
        except (ValueError, KeyError, TypeError):
            self.reply(400, {'error': 'Invalid request. Check the video and clip times.'})
        except subprocess.CalledProcessError:
            self.reply(422, {'error': 'Video export failed. Try another video or framing.'})


if __name__ == '__main__':
    if not shutil.which('ffmpeg') or not shutil.which('ffprobe'):
        raise SystemExit('Install FFmpeg and ffprobe first.')
    host = os.getenv('HOST', '127.0.0.1')
    port = int(os.getenv('PORT', '8000'))
    if (host != '127.0.0.1' or os.getenv('RENDER')) and len(os.getenv('APP_PASSWORD', '')) < 16:
        raise SystemExit('Set APP_PASSWORD to a private password of at least 16 characters before hosting.')
    print(f'Reelcraft running on {host}:{port}', flush=True)
    ThreadingHTTPServer((host, port), Handler).serve_forever()
