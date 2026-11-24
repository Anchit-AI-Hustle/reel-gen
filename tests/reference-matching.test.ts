import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateSegmentReferenceRules } from '../src/lib/vision/reference-matcher.ts';
import { parseCreativeInstruction } from '../src/lib/nlp/constraint-parser.ts';
import { applyCopilotRevision, buildStoryTimeline } from '../src/lib/story/highlight-engine.ts';
import type { MediaAssetRecord, ReferenceAsset } from '../src/types/reel-gen.ts';

function makeAsset(id: string, fileName: string, refMatches: Record<string, { confidence: number; band: 'high' | 'medium' | 'uncertain' | 'none' }>): MediaAssetRecord {
  return {
    id,
    workspaceId: 'ws_1',
    projectId: null,
    shootId: 'shoot_1',
    fileName,
    relativePath: fileName,
    mimeType: 'video/mp4',
    kind: 'video',
    decodable: true,
    sizeBytes: 1024 * 1024,
    sha256: `hash_${id}`,
    storagePath: `/tmp/${fileName}`,
    previewUrl: `/api/files/uploads/${fileName}`,
    thumbnailUrl: null,
    sourceProvider: 'local_upload',
    captureTimestamp: '2026-11-15T12:00:00Z',
    cameraLabel: 'Camera A',
    locationLabel: 'Goa',
    shootName: 'Goa Shoot',
    availabilityStatus: 'ready',
    probe: { durationSec: 6, width: 1920, height: 1080, fps: 30, videoCodec: 'h264', audioCodec: 'aac', hasAudio: true, orientation: 0, bitrate: 2000000 },
    segments: [
      {
        id: `${id}_s1`,
        assetId: id,
        startSec: 0,
        endSec: 4,
        shotType: 'medium',
        motionEnergy: 0.8,
        visualQuality: 0.9,
        emotionalImpact: 0.85,
        audioQuality: 0.8,
        isBlurry: false,
        isDuplicate: false,
        transcriptText: '',
        tags: ['medium'],
        matchedReferenceIds: refMatches,
      },
    ],
    createdAt: new Date().toISOString(),
  };
}

const refA: ReferenceAsset = {
  id: 'ref_a',
  label: 'Person A',
  fileName: 'person_a.jpg',
  mimeType: 'image/jpeg',
  role: 'person_include',
  roleInferred: false,
  enforcement: 'hard',
  storagePath: '/tmp/a.jpg',
  previewUrl: '/api/files/references/a.jpg',
  qualityScore: 0.92,
  faceCount: 1,
  usable: true,
  qualityNotes: 'Clear',
  consentConfirmed: true,
};

const refExclude: ReferenceAsset = {
  ...refA,
  id: 'ref_ex',
  label: 'Person Excluded',
  role: 'person_exclude',
};

test('strict exclusion flags uncertain matches for review instead of silently allowing', () => {
  const res = evaluateSegmentReferenceRules({
    segmentMatches: { ref_ex: { confidence: 0.64, band: 'uncertain' } },
    references: [refExclude],
    includeOperator: 'PREFER',
    strictInclusion: false,
  });
  assert.equal(res.allowed, false);
  assert.equal(res.needsReview, true);
});

test('strict inclusion excludes non-matching clips and shortens reel rather than silently padding', () => {
  const assets = [
    makeAsset('a1', 'clip_with_person.mp4', { ref_a: { confidence: 0.91, band: 'high' } }),
    makeAsset('a2', 'clip_without_person.mp4', { ref_a: { confidence: 0.22, band: 'none' } }),
  ];
  const parsed = parseCreativeInstruction({
    prompt: 'Create a 30-second reel using only footage where this person appears.',
    references: [refA],
  });
  const result = buildStoryTimeline({ assets, parsed, references: [refA] });

  assert.equal(result.edl.clips.length, 1);
  assert.equal(result.edl.clips[0].assetId, 'a1');
  assert.equal(result.insufficientFootage, true);
  assert.ok(result.edl.actualDurationSec < 30);
  assert.ok(result.complianceReport.insufficientFootageNotice);
});

test('Copilot revision mutates EDL cleanly for duration and clip replacement', () => {
  const assets = [
    makeAsset('a1', 'clip1.mp4', { ref_a: { confidence: 0.92, band: 'high' } }),
    makeAsset('a2', 'clip2.mp4', { ref_a: { confidence: 0.89, band: 'high' } }),
    makeAsset('a3', 'clip3.mp4', { ref_a: { confidence: 0.9, band: 'high' } }),
  ];
  const parsed = parseCreativeInstruction({ prompt: 'Create a 10-second highlights reel.' });
  const initial = buildStoryTimeline({ assets, parsed, references: [] });

  const rev = applyCopilotRevision({
    edl: initial.edl,
    prompt: 'Replace the second clip and make it 5 seconds',
    assets,
    references: [],
  });
  assert.equal(rev.updatedEdl.version, initial.edl.version + 1);
  assert.ok(rev.updatedEdl.actualDurationSec <= 5.2);
  assert.ok(rev.operations.length >= 1);
});
