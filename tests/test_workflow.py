import importlib.util
import base64
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import sys
import threading
import time
import unittest
from unittest.mock import patch
import urllib.error
import urllib.request

spec = importlib.util.spec_from_file_location('app', Path(__file__).resolve().parents[1] / 'app.py')
app = importlib.util.module_from_spec(spec)
spec.loader.exec_module(app)


class Workflow(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        app.DATA = Path(cls.temp.name)
        cls.server = app.ThreadingHTTPServer(('127.0.0.1', 0), app.Handler)
        cls.base = f'http://127.0.0.1:{cls.server.server_port}'
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.video = app.DATA / 'fixture.mp4'
        subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=15', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=8000', '-t', '3', '-c:v', 'libx264', '-threads', '2', '-c:a', 'aac', str(cls.video)], check=True)

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.temp.cleanup()

    def request(self, path, data=None):
        return urllib.request.urlopen(self.base + path, data=data, timeout=60)

    def test_upload_analyze_export(self):
        with self.request('/api/upload?length=15', self.video.read_bytes()) as res:
            key = json.load(res)['id']
        for _ in range(100):
            with self.request('/api/jobs/'+key) as res:
                job = json.load(res)
            if job['status'] != 'analyzing':
                break
            time.sleep(.1)
        self.assertEqual(job['status'], 'ready')
        self.assertTrue(job['audio'])
        self.assertEqual(len(job['clips']), 1)
        self.assertTrue(job['waveform'])
        with self.request('/api/export/'+key, json.dumps({'start':.5, 'end':2.5, 'framing':'vertical'}).encode()) as res:
            url = json.load(res)['url']
        with self.request(url) as res:
            output = app.DATA / 'output.mp4'
            output.write_bytes(res.read())
        info = json.loads(app.run(['ffprobe','-v','error','-show_streams','-show_format','-of','json',str(output)]).stdout)
        video = next(s for s in info['streams'] if s['codec_type'] == 'video')
        self.assertEqual((video['width'],video['height']), (720,1280))
        self.assertAlmostEqual(float(info['format']['duration']),2,delta=.2)
        req = urllib.request.Request(self.base+url, headers={'Range':'bytes=0-99'})
        with urllib.request.urlopen(req) as res:
            self.assertEqual(res.status,206)
            self.assertEqual(len(res.read()),100)
        with self.assertRaises(urllib.error.HTTPError) as error:
            self.request('/api/export/'+key,b'{"start":2,"end":1}')
        self.assertEqual(error.exception.code,400)

    def test_nonoverlapping_ranked_moments(self):
        clips = app.select_clips([0]*30+[1]*15+[0]*30,75,15)
        self.assertEqual(clips[0]['start'],30)
        for i, a in enumerate(clips):
            for b in clips[i+1:]:
                self.assertTrue(a['end'] <= b['start'] or b['end'] <= a['start'])

    def test_silent_and_short_video_selection(self):
        self.assertEqual(app.select_clips([],4,30),[{'start':0.0,'end':4,'energy':0.0}])
        self.assertEqual(app.select_clips([],90,30)[0]['start'],0)

    def test_cross_origin_rejected(self):
        request = urllib.request.Request(self.base+'/api/upload?length=15',data=b'fake',headers={'Origin':'https://example.com'})
        with self.assertRaises(urllib.error.HTTPError) as error:
            urllib.request.urlopen(request)
        self.assertEqual(error.exception.code,403)

    def test_hosted_password_protects_editor_api_and_files(self):
        with patch.dict(app.os.environ, {'APP_PASSWORD':'test-password-for-regression-only'}):
            for path in ['/', '/app.js', '/api/jobs/example', '/media/'+'a'*32+'/source']:
                with self.assertRaises(urllib.error.HTTPError) as error:
                    self.request(path)
                self.assertEqual(error.exception.code,401)
            with self.assertRaises(urllib.error.HTTPError) as error:
                self.request('/api/upload?length=15',b'fake')
            self.assertEqual(error.exception.code,401)
            with self.request('/api/health') as res:
                self.assertEqual(res.status,200)
            for password, expected in [('wrong',401),('test-password-for-regression-only',200)]:
                token=base64.b64encode(('reelcraft:'+password).encode()).decode()
                req=urllib.request.Request(self.base+'/',headers={'Authorization':'Basic '+token})
                try:
                    with urllib.request.urlopen(req) as res:
                        self.assertEqual(res.status,expected)
                except urllib.error.HTTPError as error:
                    self.assertEqual(error.code,expected)

    def test_public_startup_requires_password(self):
        env = app.os.environ.copy()
        env.update(HOST='0.0.0.0',APP_PASSWORD='')
        result=subprocess.run([sys.executable,str(app.ROOT/'app.py')],env=env,capture_output=True,text=True)
        self.assertNotEqual(result.returncode,0)
        self.assertIn('Set APP_PASSWORD',result.stderr)


if __name__ == '__main__':
    unittest.main()
