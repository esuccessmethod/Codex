// Run with node tests/test_frontend.cjs. Model the browser's window.status setter
// so accidentally declaring a function with that name breaks this regression.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
function setup(fetch) {
  const elements = {};
  const context = {document:{getElementById(id) { return elements[id] ||= {value:'30',textContent:'',disabled:false}; }}, fetch, setTimeout};
  let browserStatus = '';
  Object.defineProperty(context, 'status', {get:()=>browserStatus, set:value=>{browserStatus=String(value);}, configurable:true});
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../static/app.js'),'utf8'),context);
  return {elements};
}
test('Find my moments explains when no video is selected',async()=>{
  const {elements:e}=setup(()=>{throw Error('Should not upload');});
  await e.analyze.onclick();
  assert.equal(e.status.textContent,'Choose a video first.');
  assert.equal(e.analyze.disabled,false);
});
test('selected video uploads and server errors remain visible with retry enabled',async()=>{
  const calls=[];
  const {elements:e}=setup(async(url,options)=>{calls.push({url,options});return {ok:false,json:async()=>({error:'Unable to decode this video.'})};});
  const file={name:'sample.mp4',size:100};
  e.file.onchange({target:{files:[file]}});
  await e.analyze.onclick();
  assert.equal(calls.length,1);
  assert.equal(calls[0].url,'/api/upload?length=30');
  assert.equal(calls[0].options.body,file);
  assert.equal(e.status.textContent,'Unable to decode this video.');
  assert.equal(e.analyze.disabled,false);
});
test('upload feedback appears immediately and oversized videos are rejected',async()=>{
  let finish;
  const {elements:e}=setup(()=>new Promise(resolve=>{finish=resolve;}));
  e.file.onchange({target:{files:[{name:'large.mp4',size:2*1024**3+1}]}});
  await e.analyze.onclick();
  assert.equal(e.status.textContent,'Please choose a video smaller than 2 GB.');
  e.file.onchange({target:{files:[{name:'clip.mp4',size:100}]}});
  const pending=e.analyze.onclick();
  assert.equal(e.status.textContent,'Uploading your video…');
  assert.equal(e.analyze.disabled,true);
  finish({ok:false,json:async()=>({error:'Upload failed'})});
  await pending;
  assert.equal(e.analyze.disabled,false);
});
