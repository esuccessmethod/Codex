const $ = id => document.getElementById(id);
let selectedFile, job, busy = false, selectedIndex = -1, previewing = false;
function setStatus(text) { $('status').textContent = text; }
function choose(file) { if(file) { selectedFile = file; $('filename').textContent = file.name; } }
$('file').onchange = e => choose(e.target.files[0]);
$('drop').ondragover = e => { e.preventDefault(); $('drop').classList.add('over'); };
$('drop').ondragleave = () => $('drop').classList.remove('over');
$('drop').ondrop = e => { e.preventDefault(); $('drop').classList.remove('over'); choose(e.dataTransfer.files[0]); };
async function response(res) { const data = await res.json(); if(!res.ok) throw Error(data.error || 'Request failed'); return data; }
function time(s) { return `${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`; }
function select(clip, index) {
  selectedIndex = index;
  previewing = false;
  $('start').value = clip.start.toFixed(3); $('end').value = clip.end.toFixed(3);
  $('clipTitle').value = clip.title || `Moment ${index+1}`;
  $('video').currentTime = clip.start;
  [...$('clips').children].forEach((el,i) => el.classList.toggle('active',i===index));
}
function renderClips() {
  $('clips').replaceChildren();
  $('count').textContent = `${job.clips.length} moments · ${time(job.duration)} source`;
  job.clips.forEach((clip,i) => {
    const button = document.createElement('button'); button.className = 'clip';
    const number = document.createElement('em'); number.textContent = String(i+1).padStart(2,'0');
    const detail = document.createElement('div');
    detail.textContent = clip.title || (job.audio ? 'High-energy moment' : 'Suggested passage');
    const range = document.createElement('small'); range.textContent = `${time(clip.start)} — ${time(clip.end)} · ${(clip.end-clip.start).toFixed(1)} seconds`;
    detail.append(range); button.append(number, detail);
    button.onclick = () => select(clip,i); $('clips').append(button);
  });
}
function newMoment() {
  selectedIndex = -1; previewing = false;
  $('start').value = Math.min($('video').currentTime || 0, job.duration).toFixed(3);
  $('end').value = Math.min(Number($('start').value)+30,job.duration).toFixed(3);
  $('clipTitle').value = '';
  [...$('clips').children].forEach(el=>el.classList.remove('active'));
}
function validRange(start, end) {
  return job && Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end > start && end <= job.duration && end-start <= 180;
}
function showJob() {
  $('studio').hidden = false; selectedIndex = -1; previewing = false;
  $('video').src = `/media/${job.id}/source`;
  $('downloads').replaceChildren(); $('wave').replaceChildren();
  renderClips();
  const max = Math.max(...job.waveform, 0.001);
  job.waveform.forEach(v => { const bar = document.createElement('i'); bar.style.height = `${Math.max(3,v/max*100)}%`; $('wave').append(bar); });
  if(job.clips.length) select(job.clips[0],0); else newMoment();
  setStatus(job.mode === 'manual' ? 'Video ready. Play or seek to a moment, set its start and end, then Save moment.' : 'Suggestions are ready. Review the boundaries or mark your own moments.');
}
$('workflow').onchange = () => { $('analyze').textContent = $('workflow').value === 'manual' ? 'Open video ↗' : 'Find my moments ↗'; };
$('markStart').onclick = () => { previewing = false; $('start').value = $('video').currentTime.toFixed(3); };
$('markEnd').onclick = () => { previewing = false; $('end').value = $('video').currentTime.toFixed(3); };
$('newMoment').onclick = () => { newMoment(); setStatus('Mark the start and end of your next moment.'); };
$('saveMoment').onclick = () => {
  const start = Number($('start').value), end = Number($('end').value);
  if(!validRange(start,end)) return setStatus('Choose a valid range up to 180 seconds within your video.');
  const clip = {start,end,title:$('clipTitle').value.trim() || `Moment ${job.clips.length+1}`};
  if(selectedIndex < 0) { job.clips.push(clip); selectedIndex = job.clips.length-1; }
  else job.clips[selectedIndex] = clip;
  renderClips(); select(clip,selectedIndex); setStatus('Moment saved in this tab. Export it now or mark another.');
};
$('deleteMoment').onclick = () => {
  if(selectedIndex < 0) return setStatus('Select a saved moment to delete.');
  job.clips.splice(selectedIndex,1); renderClips(); newMoment(); setStatus('Moment removed.');
};
$('analyze').onclick = async () => {
  if(busy) return;
  if(!selectedFile) return setStatus('Choose a video first.');
  if(selectedFile.size > 2*1024**3) return setStatus('Please choose a video smaller than 2 GB.');
  busy = true; $('analyze').disabled = true;
  try {
    setStatus('Uploading your video…');
    const manual = $('workflow').value === 'manual';
    const data = await response(await fetch(`/api/upload?length=${$('length').value}${manual ? '&mode=manual' : ''}`, {method:'POST',body:selectedFile}));
    setStatus(manual ? 'Opening your video…' : 'Finding the energy in your video… This can take a few minutes.');
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
$('video').ontimeupdate = () => { if(previewing && $('video').currentTime >= Number($('end').value)) { $('video').pause(); previewing = false; } };
$('preview').onclick = () => { if(!validRange(Number($('start').value),Number($('end').value))) return setStatus('Choose a valid range up to 180 seconds within your video.'); previewing = true; $('video').currentTime = Number($('start').value); $('video').play().catch(e => setStatus(e.message)); };
$('export').onclick = async () => {
  const start = Number($('start').value), end = Number($('end').value);
  if(!validRange(start,end)) return setStatus('Choose a valid range up to 180 seconds within your video.');
  $('export').disabled = true; $('analyze').disabled = true; setStatus('Rendering your MP4… Keep this page open.');
  try {
    const result = await response(await fetch(`/api/export/${job.id}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({start,end,framing:$('framing').value})}));
    const link = document.createElement('a'); link.href=result.url; link.download=`reel-${start}-${end}.mp4`; link.textContent=`↓ Download reel · ${time(start)}–${time(end)}`; $('downloads').prepend(link);
    setStatus('Your MP4 is ready. Download it, then upload it to Canva or import it into CapCut for captions and effects.');
  } catch(e) { setStatus(e.message); }
  finally { $('export').disabled=false; $('analyze').disabled=false; }
};
