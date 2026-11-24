import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';

const PORT = 3199;
const BASE = `http://localhost:${PORT}`;
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reelgen-http-e2e-'));
const dataDir = path.join(tmpDir, 'data');
fs.mkdirSync(dataDir, { recursive: true });

async function waitForServer(timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${BASE}/api/state`);
      if (res.ok) return;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('Timed out waiting for Next.js production server');
}

async function run() {
  const server = spawn('npx', ['next', 'start', '-p', String(PORT)], {
    cwd: process.cwd(),
    env: { ...process.env, REEL_GEN_DATA_DIR: dataDir },
    stdio: 'pipe',
  });

  try {
    await waitForServer();
    console.log('1. Production Next.js server started on port', PORT);

    for (const route of ['/', '/library', '/editor', '/drives', '/dashboard', '/settings']) {
      const res = await fetch(`${BASE}${route}`);
      assert.equal(res.status, 200, `Expected HTTP 200 for ${route}`);
      const html = await res.text();
      assert.ok(html.includes('Reel Gen'), `Expected Reel Gen shell on ${route}`);
    }
    console.log('2. All 6 UI routes returned HTTP 200 with Reel Gen shell');

    const signupRes = await fetch(`${BASE}/api/auth/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'signup', email: 'qa@reelgen.local', password: 'StrongPassword123!', name: 'QA Lead' }),
    });
    assert.equal(signupRes.status, 200);
    const cookie = signupRes.headers.get('set-cookie') || '';
    assert.ok(cookie.includes('reelgen_session='));

    const meRes = await fetch(`${BASE}/api/auth/session`, { headers: { cookie: cookie.split(';')[0] } });
    const meJson = await meRes.json();
    assert.equal(meJson.authenticated, true);
    assert.equal(meJson.user.email, 'qa@reelgen.local');
    console.log('3. Real scrypt Auth signup + signed cookie session verified');

    const blueVid = path.join(tmpDir, 'blue_subject.mp4');
    const redVid = path.join(tmpDir, 'red_other.mp4');
    const refBlue = path.join(tmpDir, 'ref_blue.png');
    const unknownFile = path.join(tmpDir, 'notes.xyz');

    execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=0x1e66f5:s=640x360:d=3', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', blueVid]);
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=0xd20f39:s=640x360:d=3', '-f', 'lavfi', '-i', 'sine=frequency=660:duration=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', redVid]);
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=0x1e66f5:s=320x320:d=1', '-frames:v', '1', refBlue]);
    fs.writeFileSync(unknownFile, 'arbitrary project note', 'utf8');

    const form = new FormData();
    form.append('files', new Blob([fs.readFileSync(blueVid)], { type: 'video/mp4' }), 'blue_subject.mp4');
    form.append('relativePaths', 'ClientA/2026-11-15_Goa/Camera A/blue_subject.mp4');
    form.append('files', new Blob([fs.readFileSync(redVid)], { type: 'video/mp4' }), 'red_other.mp4');
    form.append('relativePaths', 'ClientA/2026-11-15_Goa/Camera B/red_other.mp4');
    form.append('files', new Blob([fs.readFileSync(unknownFile)], { type: 'application/octet-stream' }), 'notes.xyz');
    form.append('relativePaths', 'notes.xyz');

    const upRes = await fetch(`${BASE}/api/media/upload`, { method: 'POST', body: form });
    assert.equal(upRes.status, 200);
    const upJson = await upRes.json();
    assert.equal(upJson.assets.length, 3);
    const blueAsset = upJson.assets.find((a) => a.fileName === 'blue_subject.mp4');
    const xyzAsset = upJson.assets.find((a) => a.fileName === 'notes.xyz');
    assert.equal(blueAsset.decodable, true);
    assert.equal(blueAsset.locationLabel, 'Goa');
    assert.equal(blueAsset.cameraLabel, 'Camera A');
    assert.equal(xyzAsset.decodable, false);
    console.log('4. Universal intake + FFprobe indexing + shoot metadata inference verified');

    const refForm = new FormData();
    refForm.append('file', new Blob([fs.readFileSync(refBlue)], { type: 'image/png' }), 'ref_blue.png');
    refForm.append('prompt', 'Create a 5-second vertical reel using only footage where this person appears.');
    refForm.append('consentConfirmed', 'true');
    const refRes = await fetch(`${BASE}/api/references/upload`, { method: 'POST', body: refForm });
    assert.equal(refRes.status, 200);
    const { reference } = await refRes.json();
    assert.equal(reference.usable, true);
    assert.equal(reference.role, 'person_include');
    assert.equal(reference.enforcement, 'hard');
    console.log('5. Reference photo upload + automatic strict role inference verified');

    const contraRes = await fetch(`${BASE}/api/projects/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        brief: 'Show only Person A, but exclude Person A.',
        assetIds: upJson.assets.map((a) => a.id),
        references: [reference],
      }),
    });
    const contraJson = await contraRes.json();
    assert.equal(contraJson.clarificationNeeded, true);
    assert.ok(contraJson.clarificationQuestion);
    console.log('6. Contradictory brief detection + clarification prompt verified');

    const genRes = await fetch(`${BASE}/api/projects/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        brief: 'Create a 5-second vertical reel using only footage where this person appears.',
        assetIds: upJson.assets.map((a) => a.id),
        references: [reference],
        resolution: '720p',
      }),
    });
    assert.equal(genRes.status, 200);
    const { project, artifact } = await genRes.json();
    assert.equal(project.currentEdl.clips.length, 1);
    assert.equal(project.currentEdl.clips[0].fileName, 'blue_subject.mp4');
    assert.equal(artifact.qaPassed, true);

    const mp4Res = await fetch(`${BASE}${artifact.downloadUrl}?download=1`);
    assert.equal(mp4Res.status, 200);
    const mp4Path = path.join(tmpDir, 'downloaded_reel.mp4');
    fs.writeFileSync(mp4Path, Buffer.from(await mp4Res.arrayBuffer()));
    const probeJson = JSON.parse(
      execFileSync('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', mp4Path]).toString('utf8')
    );
    const vStream = probeJson.streams.find((s) => s.codec_type === 'video');
    const aStream = probeJson.streams.find((s) => s.codec_type === 'audio');
    assert.equal(vStream.codec_name, 'h264');
    assert.equal(aStream.codec_name, 'aac');
    assert.equal(vStream.width, 720);
    assert.equal(vStream.height, 1280);
    console.log('7. End-to-end strict reference MP4 render + HTTP download + FFprobe QA (720x1280 H264/AAC) verified');

    const copilotRes = await fetch(`${BASE}/api/projects/${project.id}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'copilot', prompt: 'Make it 2 seconds' }),
    });
    assert.equal(copilotRes.status, 200);
    const copilotJson = await copilotRes.json();
    assert.equal(copilotJson.project.activeVersion, 2);
    assert.ok(copilotJson.artifact.durationSec <= 2.4);

    const editorRes = await fetch(`${BASE}/editor/${project.id}`);
    assert.equal(editorRes.status, 200);
    console.log('8. Copilot natural-language revision (v2) + /editor/[projectId] HTTP 200 verified');

    const purgeRes = await fetch(`${BASE}/api/state`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'purge_biometrics' }),
    });
    assert.equal(purgeRes.status, 200);
    const purgeJson = await purgeRes.json();
    assert.equal(purgeJson.ok, true);
    console.log('9. Ephemeral biometric descriptor purge verified');

    console.log('=== ALL 9 FULL-STACK HTTP E2E CHECKS PASSED ===');
  } finally {
    server.kill('SIGTERM');
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

run().catch((err) => {
  console.error('E2E FAILED:', err);
  process.exit(1);
});
