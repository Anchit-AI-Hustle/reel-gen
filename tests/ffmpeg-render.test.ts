import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { probeMediaFile, analyzeVideoSegments, renderEdlToMp4 } from '../src/lib/render/ffmpeg-worker.ts';
import { validateReferenceImage } from '../src/lib/vision/reference-matcher.ts';
import { parseCreativeInstruction } from '../src/lib/nlp/constraint-parser.ts';
import { buildStoryTimeline } from '../src/lib/story/highlight-engine.ts';
import type { MediaAssetRecord, ReferenceAsset } from '../src/types/reel-gen.ts';

const execFileAsync = promisify(execFile);

test('Real-media E2E: FFmpeg synthetic clips + reference image matching + vertical H264/AAC MP4 render + FFprobe QA', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reelgen-e2e-'));
  try {
    const clipBluePath = path.join(tmpDir, 'person_blue_scene.mp4');
    const clipRedPath = path.join(tmpDir, 'other_red_scene.mp4');
    const refBlueImg = path.join(tmpDir, 'ref_blue.png');
    const outMp4Path = path.join(tmpDir, 'final_reel.mp4');

    // 1. Create two real synthetic MP4 videos (with H.264 video + sine wave AAC audio) and a reference PNG
    await execFileAsync('ffmpeg', [
      '-y', '-v', 'error',
      '-f', 'lavfi', '-i', 'color=c=0x1e66f5:s=640x360:d=3',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest',
      clipBluePath,
    ]);
    await execFileAsync('ffmpeg', [
      '-y', '-v', 'error',
      '-f', 'lavfi', '-i', 'color=c=0xd20f39:s=640x360:d=3',
      '-f', 'lavfi', '-i', 'sine=frequency=660:duration=3',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest',
      clipRedPath,
    ]);
    await execFileAsync('ffmpeg', [
      '-y', '-v', 'error',
      '-f', 'lavfi', '-i', 'color=c=0x1e66f5:s=320x320:d=1',
      '-frames:v', '1',
      refBlueImg,
    ]);

    // 2. Validate reference image & extract real descriptor
    const refVal = await validateReferenceImage({
      filePath: refBlueImg,
      fileName: 'ref_blue.png',
      role: 'person_include',
      consentConfirmed: true,
    });
    assert.equal(refVal.usable, true);
    assert.equal(refVal.width, 320);

    const refAsset: ReferenceAsset = {
      id: 'ref_blue',
      label: 'Blue Subject',
      fileName: 'ref_blue.png',
      mimeType: 'image/png',
      role: 'person_include',
      roleInferred: false,
      enforcement: 'hard',
      storagePath: refBlueImg,
      previewUrl: '/api/files/references/ref_blue.png',
      qualityScore: refVal.qualityScore,
      faceCount: 1,
      usable: true,
      qualityNotes: refVal.qualityNotes,
      descriptor: refVal.descriptor,
      consentConfirmed: true,
    };

    // 3. Probe both clips with real FFprobe
    const probeBlue = await probeMediaFile(clipBluePath);
    const probeRed = await probeMediaFile(clipRedPath);
    assert.ok(probeBlue && probeBlue.durationSec >= 2.8);
    assert.ok(probeRed && probeRed.durationSec >= 2.8);

    const assets: MediaAssetRecord[] = [
      {
        id: 'asset_blue',
        workspaceId: 'ws_test',
        projectId: null,
        shootId: 's1',
        fileName: 'person_blue_scene.mp4',
        relativePath: 'person_blue_scene.mp4',
        mimeType: 'video/mp4',
        kind: 'video',
        decodable: true,
        sizeBytes: fs.statSync(clipBluePath).size,
        sha256: 'blue',
        storagePath: clipBluePath,
        previewUrl: '/api/files/uploads/person_blue_scene.mp4',
        thumbnailUrl: null,
        sourceProvider: 'local_upload',
        captureTimestamp: null,
        cameraLabel: 'Camera A',
        locationLabel: null,
        shootName: 'Test Shoot',
        availabilityStatus: 'ready',
        probe: probeBlue,
        segments: [],
        createdAt: new Date().toISOString(),
      },
      {
        id: 'asset_red',
        workspaceId: 'ws_test',
        projectId: null,
        shootId: 's1',
        fileName: 'other_red_scene.mp4',
        relativePath: 'other_red_scene.mp4',
        mimeType: 'video/mp4',
        kind: 'video',
        decodable: true,
        sizeBytes: fs.statSync(clipRedPath).size,
        sha256: 'red',
        storagePath: clipRedPath,
        previewUrl: '/api/files/uploads/other_red_scene.mp4',
        thumbnailUrl: null,
        sourceProvider: 'local_upload',
        captureTimestamp: null,
        cameraLabel: 'Camera B',
        locationLabel: null,
        shootName: 'Test Shoot',
        availabilityStatus: 'ready',
        probe: probeRed,
        segments: [],
        createdAt: new Date().toISOString(),
      },
    ];

    // 4. Run real visual descriptor matching against both videos
    for (const a of assets) {
      a.segments = await analyzeVideoSegments({ asset: a, references: [refAsset] });
    }
    assert.equal(assets[0].segments[0].matchedReferenceIds.ref_blue.band, 'high');
    assert.notEqual(assets[1].segments[0].matchedReferenceIds.ref_blue.band, 'high');

    // 5. Parse strict inclusion brief & build timeline
    const parsed = parseCreativeInstruction({
      prompt: 'Create a 5-second vertical reel using only footage where this person appears.',
      references: [refAsset],
    });
    const story = buildStoryTimeline({
      assets,
      parsed,
      references: [refAsset],
      resolution: '720p',
    });

    // Strict inclusion must keep ONLY the blue clip and exclude the red clip
    assert.equal(story.edl.clips.length, 1);
    assert.equal(story.edl.clips[0].assetId, 'asset_blue');

    // 6. Render genuine vertical 9:16 H.264/AAC MP4 & verify with FFprobe QA
    const artifact = await renderEdlToMp4({
      edl: story.edl,
      assetsById: new Map(assets.map((a) => [a.id, a])),
      outputPath: outMp4Path,
      projectId: 'proj_e2e',
      jobId: 'job_e2e',
      downloadUrl: '/api/files/renders/final_reel.mp4',
      complianceReport: story.complianceReport,
    });

    assert.equal(artifact.qaPassed, true);
    assert.equal(artifact.videoCodec, 'h264');
    assert.equal(artifact.audioCodec, 'aac');
    assert.equal(artifact.width, 720);
    assert.equal(artifact.height, 1280);
    assert.ok(artifact.durationSec >= 2.5);
    assert.ok(fs.existsSync(outMp4Path));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
