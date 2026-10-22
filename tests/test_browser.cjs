// Optional real-browser smoke test. Requires Playwright and Chromium.
// Start app.py first. Override REELCRAFT_TEST_URL / CHROMIUM_PATH if needed.
const {chromium} = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
(async()=>{
  const temp = fs.mkdtempSync(path.join(os.tmpdir(),'reelcraft-browser-'));
  let browser;
  try {
    const fixture = path.join(temp,'source.mp4');
    execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','testsrc2=size=320x180:rate=15','-f','lavfi','-i','sine=frequency=440:sample_rate=8000','-t','4','-c:v','libx264','-threads','2','-c:a','aac',fixture]);
    browser = await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium',args:['--no-sandbox']});
    const page = await browser.newPage();
    const errors=[]; page.on('pageerror',e=>errors.push(e.message));
    await page.goto(process.env.REELCRAFT_TEST_URL || 'http://127.0.0.1:8001');
    await page.waitForFunction(()=>!document.getElementById('analyze').disabled);
    assert.equal(await page.locator('#workflow').inputValue(),'manual');
    await page.setInputFiles('#file',fixture);
    await page.click('#analyze');
    await page.waitForFunction(()=>document.getElementById('status').textContent.startsWith('Video ready.'));
    await page.waitForFunction(()=>document.getElementById('video').readyState>=1);
    await page.evaluate(()=>{document.getElementById('video').currentTime=.5;});
    await page.click('#markStart');
    await page.evaluate(()=>{document.getElementById('video').currentTime=2.5;});
    await page.click('#markEnd');
    await page.fill('#clipTitle','Complete answer <test>');
    await page.click('#saveMoment');
    assert.equal(await page.locator('.clip').count(),1);
    assert.ok((await page.locator('.clip').textContent()).includes('Complete answer <test>'));
    await page.click('#newMoment');
    await page.fill('#start','0');await page.fill('#end','1');
    await page.click('#saveMoment');
    assert.equal(await page.locator('.clip').count(),2);
    await page.locator('.clip').first().click();
    assert.equal(Number(await page.locator('#start').inputValue()),.5);
    assert.equal(Number(await page.locator('#end').inputValue()),2.5);
    await page.click('#preview');
    await page.waitForFunction(()=>document.getElementById('video').paused && document.getElementById('video').currentTime>=2.5);
    await page.click('#newMoment');
    await page.fill('#end','1');
    // Ordinary playback must continue past the marked selection end.
    await page.evaluate(async()=>{const v=document.getElementById('video');v.currentTime=1.5;v.muted=true;await v.play();});
    await page.waitForFunction(()=>document.getElementById('video').currentTime>2);
    assert.equal(await page.locator('#video').evaluate(v=>v.paused),false);
    await page.locator('.clip').first().click();
    await page.locator('#video').evaluate(v=>v.pause());
    assert.equal(await page.locator('#framing').inputValue(),'original');
    await page.click('#export');
    await page.waitForSelector('#downloads a',{timeout:60000});
    const downloadPromise=page.waitForEvent('download');
    await page.locator('#downloads a').first().click();
    const download=await downloadPromise;
    const output=path.join(temp,'clip.mp4');await download.saveAs(output);
    const info=JSON.parse(execFileSync('ffprobe',['-v','error','-show_streams','-show_format','-of','json',output]));
    const video=info.streams.find(s=>s.codec_type==='video');
    assert.deepEqual([video.width,video.height],[320,180]);
    assert.ok(Math.abs(Number(info.format.duration)-2)<.2);
    await page.click('#deleteMoment');
    assert.equal(await page.locator('.clip').count(),1);
    assert.deepEqual(errors,[]);
    console.log('PASS: manual upload, marking, multiple moments, selection preview, full playback, original MP4 download, delete; no browser errors.');
  } finally {
    if(browser) await browser.close();
    fs.rmSync(temp,{recursive:true,force:true});
  }
})().catch(e=>{console.error(e);process.exitCode=1;});
