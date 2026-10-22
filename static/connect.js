(async () => {
  const button = document.getElementById('analyze');
  const message = document.getElementById('status');
  try {
    if (!['http:', 'https:'].includes(location.protocol)) {
      throw Error('This is a file preview. Start Reelcraft with python app.py and open the app through its server to process videos.');
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    let res;
    try { res = await fetch('/api/health', {cache:'no-store', signal:controller.signal}); }
    finally { clearTimeout(timer); }
    if (!res.ok) throw Error('The video server is unavailable. Start Reelcraft with python app.py and open the running app.');
    const health = await res.json();
    if (health.status !== 'ok' || !health.ffmpeg) throw Error('The video server is missing FFmpeg. Install FFmpeg and restart Reelcraft.');
    if (typeof setStatus !== 'function') throw Error('The editor script did not load. Reload the running app.');
    message.textContent = 'Connected. Choose a video, then click Open video.';
    button.textContent = document.getElementById('workflow').value === 'manual' ? 'Open video ↗' : 'Find my moments ↗';
    button.disabled = false;
  } catch (error) {
    button.textContent = 'Editor unavailable';
    message.textContent = error.name === 'AbortError' ? 'The video server did not respond. Restart Reelcraft and reload this page.' : error.message;
  }
})();
