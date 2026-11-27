import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import {
  hashPassword,
  verifyPassword,
  encryptSensitivePayload,
  decryptSensitivePayload,
  createSignedSessionToken,
  verifySignedSessionToken,
  assertWorkspaceOwnership,
} from '../src/lib/auth.ts';
import {
  classifyUploadedFile,
  inferShootMetadata,
  validateArchiveEntrySafety,
} from '../src/lib/media/intake.ts';
import { parseCreativeInstruction } from '../src/lib/nlp/constraint-parser.ts';
import { validateReferenceImage } from '../src/lib/vision/reference-matcher.ts';
import { analyzeVideoSegments, probeMediaFile, renderEdlToMp4 } from '../src/lib/render/ffmpeg-worker.ts';
import { applyCopilotRevision, buildStoryTimeline } from '../src/lib/story/highlight-engine.ts';
import { createWorkspaceClaimSignature } from '../src/cloudflare/auth.ts';
import { handleWorkerRequest } from '../src/cloudflare/index.ts';
import type { D1DatabaseLike } from '../src/cloudflare/d1-repository.ts';
import type { R2BucketLike } from '../src/cloudflare/storage.ts';
import type { MediaAssetRecord, ReferenceAsset } from '../src/types/reel-gen.ts';

test('Integration: Auth + Intake + Shoot Inference + Fail-closed Identity + Real MP4 + FFprobe + Copilot + Mock Worker R2', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reelgen-fullstack-e2e-'));
  try {
    // 1. Auth: scrypt hashing, AES-256-GCM encryption, signed session token, workspace isolation
    const pwHash = hashPassword('ReelGen-QA-2026!');
    assert.equal(verifyPassword('ReelGen-QA-2026!', pwHash), true);
    assert.equal(verifyPassword('wrong-pass', pwHash), false);
    const enc = encryptSensitivePayload('ephemeral_biometric_vector');
    assert.equal(decryptSensitivePayload(enc), 'ephemeral_biometric_vector');
    const tok = createSignedSessionToken({ userId: 'u_qa', workspaceId: 'ws_qa', email: 'qa@reelgen.local' });
    const verified = verifySignedSessionToken(tok);
    assert.ok(verified && verified.workspaceId === 'ws_qa');
    assert.throws(() => assertWorkspaceOwnership('ws_a', 'ws_b'), /Forbidden/);

    // 2. Universal intake, archive guard, and shoot metadata inference
    assert.equal(classifyUploadedFile('clip.mov', 'video/quicktime').kind, 'video');
    assert.equal(classifyUploadedFile('unknown.xyz').decodable, false);
    assert.equal(validateArchiveEntrySafety('CameraA/clip.mp4', 5_000_000, 4_000_000).safe, true);
    assert.equal(validateArchiveEntrySafety('clip.mp4', 20_000_000, 1000).safe, false);
    const shoot = inferShootMetadata('BrandCo/2026-11-15_Goa/Camera A/Clip001.mov');
    assert.equal(shoot.clientName, 'BrandCo');
    assert.equal(shoot.shootDate, '2026-11-15');
    assert.equal(shoot.location, 'Goa');
    assert.equal(shoot.cameraLabel, 'Camera A');

    // 3. Real FFmpeg synthetic footage + reference PNG + strict inclusion + FFprobe QA + Copilot v2
    const blueVid = path.join(tmpDir, 'blue_subject.mp4');
    const redVid = path.join(tmpDir, 'red_other.mp4');
    const refBlue = path.join(tmpDir, 'ref_blue.png');
    const outV1 = path.join(tmpDir, 'reel_v1.mp4');
    const outV2 = path.join(tmpDir, 'reel_v2.mp4');

    execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=0x1e66f5:s=640x360:d=3', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', blueVid]);
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=0xd20f39:s=640x360:d=3', '-f', 'lavfi', '-i', 'sine=frequency=660:duration=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', redVid]);
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=0x1e66f5:s=320x320:d=1', '-frames:v', '1', refBlue]);

    const refVal = await validateReferenceImage({
      filePath: refBlue,
      fileName: 'ref_blue.png',
      role: 'person_include',
      consentConfirmed: true,
    });
    assert.equal(refVal.usable, true);

    const refAsset: ReferenceAsset = {
      id: 'ref_blue',
      label: 'Blue Subject',
      fileName: 'ref_blue.png',
      mimeType: 'image/png',
      role: 'person_include',
      roleInferred: false,
      enforcement: 'hard',
      storagePath: refBlue,
      previewUrl: '/api/files/references/ref_blue.png',
      qualityScore: refVal.qualityScore,
      faceCount: refVal.faceCount,
      usable: true,
      qualityNotes: refVal.qualityNotes,
      descriptor: refVal.descriptor,
      consentConfirmed: true,
    };

    const probeBlue = await probeMediaFile(blueVid);
    const probeRed = await probeMediaFile(redVid);
    assert.ok(probeBlue && probeRed);

    const assets: MediaAssetRecord[] = [
      {
        id: 'a_blue', workspaceId: 'ws_qa', projectId: null, shootId: 'goa', fileName: 'blue_subject.mp4',
        relativePath: 'BrandCo/2026-11-15_Goa/Camera A/blue_subject.mp4', mimeType: 'video/mp4', kind: 'video',
        decodable: true, sizeBytes: fs.statSync(blueVid).size, sha256: 'h1', storagePath: blueVid,
        previewUrl: '/api/files/uploads/blue_subject.mp4', thumbnailUrl: null, sourceProvider: 'local_upload',
        captureTimestamp: '2026-11-15T12:00:00Z', cameraLabel: 'Camera A', locationLabel: 'Goa', shootName: 'BrandCo · 2026-11-15 · Goa',
        availabilityStatus: 'ready', probe: probeBlue, segments: [], createdAt: new Date().toISOString(),
      },
      {
        id: 'a_red', workspaceId: 'ws_qa', projectId: null, shootId: 'goa', fileName: 'red_other.mp4',
        relativePath: 'BrandCo/2026-11-15_Goa/Camera B/red_other.mp4', mimeType: 'video/mp4', kind: 'video',
        decodable: true, sizeBytes: fs.statSync(redVid).size, sha256: 'h2', storagePath: redVid,
        previewUrl: '/api/files/uploads/red_other.mp4', thumbnailUrl: null, sourceProvider: 'local_upload',
        captureTimestamp: '2026-11-15T12:05:00Z', cameraLabel: 'Camera B', locationLabel: 'Goa', shootName: 'BrandCo · 2026-11-15 · Goa',
        availabilityStatus: 'ready', probe: probeRed, segments: [], createdAt: new Date().toISOString(),
      },
    ];

    for (const a of assets) {
      a.segments = await analyzeVideoSegments({ asset: a, references: [refAsset] });
    }

    assert.equal(refVal.faceCount, null);
    for (const asset of assets) {
      assert.ok(asset.segments.length > 0);
      for (const segment of asset.segments) {
        assert.equal(segment.matchedReferenceIds.ref_blue.band, 'uncertain');
        assert.equal(segment.matchedReferenceIds.ref_blue.confidence, 0);
      }
    }
    const strictParsed = parseCreativeInstruction({
      prompt: 'Create a 5-second vertical reel using only footage where this person appears.',
      references: [refAsset],
    });
    const strictStory = buildStoryTimeline({ assets, parsed: strictParsed, references: [refAsset], resolution: '720p' });
    assert.equal(strictStory.edl.clips.length, 0);
    assert.equal(strictStory.complianceReport.overallCompliant, false);
    assert.ok(strictStory.complianceReport.couldNotBeSatisfied.some(item => item.constraintId === strictParsed.constraints.find(c => c.type === 'subject_inclusion')?.id));

    // Independently exercise rendering, revision and storage without a false identity claim.
    const parsed = parseCreativeInstruction({ prompt: 'Create a 5-second vertical reel.', references: [] });
    const story = buildStoryTimeline({ assets, parsed, references: [], resolution: '720p' });
    assert.ok(story.edl.clips.length > 0);
    assert.ok(story.edl.clips.every(clip => clip.matchedReferenceIds.length === 0));

    const artV1 = await renderEdlToMp4({
      edl: story.edl,
      assetsById: new Map(assets.map((a) => [a.id, a])),
      outputPath: outV1,
      projectId: 'p_e2e',
      jobId: 'j_1',
      downloadUrl: '/api/files/renders/reel_v1.mp4',
      complianceReport: story.complianceReport,
    });
    assert.equal(artV1.qaPassed, true);
    assert.equal(artV1.videoCodec, 'h264');
    assert.equal(artV1.audioCodec, 'aac');
    assert.equal(artV1.width, 720);
    assert.equal(artV1.height, 1280);

    // 4. Copilot revision v2 -> re-render MP4 -> verify shorter duration
    const rev = applyCopilotRevision({
      edl: story.edl,
      prompt: 'Make it 2 seconds',
      assets,
      references: [],
    });
    assert.equal(rev.updatedEdl.version, 2);
    const artV2 = await renderEdlToMp4({
      edl: rev.updatedEdl,
      assetsById: new Map(assets.map((a) => [a.id, a])),
      outputPath: outV2,
      projectId: 'p_e2e',
      jobId: 'j_2',
      downloadUrl: '/api/files/renders/reel_v2.mp4',
      complianceReport: story.complianceReport,
    });
    assert.equal(artV2.qaPassed, true);
    assert.ok(artV2.durationSec <= 2.4);

    // 5. Store rendered MP4 into Cloudflare Worker R2 endpoint with HMAC-signed workspace claim
    const r2Map = new Map<string, Uint8Array>();
    const mockDb: D1DatabaseLike = {
      prepare: () => {
        const stmt = {
          bind: () => stmt,
          all: async () => ({ results: [] }),
          first: async () => null,
          run: async () => ({ success: true, meta: { changes: 1 } }),
        };
        return stmt;
      },
    };
    const mockR2: R2BucketLike = {
      put: async (k, v) => { r2Map.set(k, v instanceof Uint8Array ? v : new Uint8Array(v as ArrayBuffer)); },
      get: async (k) => {
        const hit = r2Map.get(k);
        return hit ? { body: hit, size: hit.byteLength, httpMetadata: { contentType: 'video/mp4' } } : null;
      },
      delete: async (k) => { r2Map.delete(k); },
    };

    const env = { DB: mockDb, MEDIA_BUCKET: mockR2, CLOUDFLARE_DB_API_TOKEN: 'worker_secret_value_999', AUTH_SECRET: 'auth_secret_999' };
    const ts = Date.now();
    const sig = await createWorkspaceClaimSignature({ secret: env.AUTH_SECRET, workspaceId: 'ws_qa', actorId: 'u_qa', timestampMs: ts });
    const mp4Bytes = fs.readFileSync(outV2);

    const putRes = await handleWorkerRequest(
      new Request('https://worker.test/v1/storage/renders/reel_v2.mp4', {
        method: 'PUT',
        headers: {
          authorization: `Bearer ${env.CLOUDFLARE_DB_API_TOKEN}`,
          'content-type': 'video/mp4',
          'x-reelgen-workspace': 'ws_qa',
          'x-reelgen-actor': 'u_qa',
          'x-reelgen-ts': String(ts),
          'x-reelgen-sig': sig,
        },
        body: mp4Bytes,
      }),
      env
    );
    assert.equal(putRes.status, 201);

    const getRes = await handleWorkerRequest(
      new Request('https://worker.test/v1/storage/renders/reel_v2.mp4', {
        method: 'GET',
        headers: {
          authorization: `Bearer ${env.CLOUDFLARE_DB_API_TOKEN}`,
          'x-reelgen-workspace': 'ws_qa',
          'x-reelgen-actor': 'u_qa',
          'x-reelgen-ts': String(ts),
          'x-reelgen-sig': sig,
        },
      }),
      env
    );
    assert.equal(getRes.status, 200);
    const returnedBytes = Buffer.from(await getRes.arrayBuffer());
    assert.equal(returnedBytes.byteLength, mp4Bytes.byteLength);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
