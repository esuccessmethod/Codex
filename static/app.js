const $ = id => document.getElementById(id);
let selectedFile, job, busy = false;
function setStatus(text) { $('status').textContent = text; }
function choose(file) { if(file) { selectedFile = file; $('filename').textContent = file.name; } }
$('file').onchange = e => choose(e.target.files[0]);
$('drop').ondragover = e => { e.preventDefault(); $('drop').classList.add('over'); };
$('drop').ondragleave = () => $('drop').classList.remove('over');
$('drop').ondrop = e => { e.preventDefault(); $('drop').classList.remove('over'); choose(e.dataTransfer.files[0]); };
async function response(res) { const data = await res.json(); if(!res.ok) throw Error(data.error || 'Request failed'); return data; }
function time(s) { return `${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`; }
function select(clip, index) {
  $('start').value = clip.start.toFixed(1); $('end').value = clip.end.toFixed(1);
  $('video').currentTime = clip.start;
  [...$('clips').children].forEach((el,i) => el.classList.toggle('active',i===index));
}
function showJob() {
  $('studio').hidden = false;
  $('video').src = `/media/${job.id}/source`;
  $('clips').replaceChildren(); $('downloads').replaceChildren(); $('wave').replaceChildren();
  $('count').textContent = `${job.clips.length} suggestions · ${time(job.duration)} source`;
  job.clips.forEach((clip,i) => {
    const button = document.createElement('button'); button.className = 'clip';
    const title = job.audio ? 'High-energy moment' : 'Suggested passage';
    button.innerHTML = `<em>0${i+1}</em><div>${title}<small>${time(clip.start)} — ${time(clip.end)} · ${(clip.end-clip.start).toFixed(0)} seconds</small></div><span class="arrow">↗</span>`;
    button.onclick = () => select(clip,i); $('clips').append(button);
  });
  const max = Math.max(...job.waveform, 0.001);
  job.waveform.forEach(v => { const bar = document.createElement('i'); bar.style.height = `${Math.max(3,v/max*100)}%`; $('wave').append(bar); });
  select(job.clips[0],0);
  setStatus(job.audio ? 'Your moments are ready. Pick a clip and make it yours.' : 'No audio track found. Review these suggested passages manually.');
}
$('analyze').onclick = async () => {
  if(busy) return;
  if(!selectedFile) return setStatus('Choose a video first.');
  if(selectedFile.size > 2*1024**3) return setStatus('Please choose a video smaller than 2 GB.');
  busy = true; $('analyze').disabled = true;
  try {
    setStatus('Uploading your video…');
    const data = await response(await fetch(`/api/upload?length=${$('length').value}`, {method:'POST',body:selectedFile}));
    setStatus('Finding the energy in your video… This can take a few minutes.');
    for(;;) {
      job = await response(await fetch(`/api/jobs/${data.id}`));
      if(job.status === 'error') throw Error(job.error);
      if(job.status === 'ready') break;
      await new Promise(resolve => setTimeout(resolve,1200));
    }
    showJob();
  } catch(e) { setStatus(e.message); }
  finally { busy=false; $('analyze').disabled=false; }
};
$('video').ontimeupdate = () => { if($('video').currentTime >= Number($('end').value)) $('video').pause(); };
$('preview').onclick = () => { $('video').currentTime = Number($('start').value); $('video').play().catch(e => setStatus(e.message)); };
$('export').onclick = async () => {
  const start = Number($('start').value), end = Number($('end').value);
  if(!job || start < 0 || end <= start || end > job.duration || end-start > 180) return setStatus('Choose a valid range up to 180 seconds within your video.');
  $('export').disabled = true; $('analyze').disabled = true; setStatus('Rendering your MP4… Keep this page open.');
  try {
    const result = await response(await fetch(`/api/export/${job.id}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({start,end,framing:$('framing').value})}));
    const link = document.createElement('a'); link.href=result.url; link.download=`reel-${start}-${end}.mp4`; link.textContent=`↓ Download reel · ${time(start)}–${time(end)}`; $('downloads').prepend(link);
    setStatus('Your reel is ready. Download it, review it, and share when you’re happy.');
  } catch(e) { setStatus(e.message); }
  finally { $('export').disabled=false; $('analyze').disabled=false; }
};
