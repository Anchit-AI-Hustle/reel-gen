import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCreativeInstruction } from '../src/lib/nlp/constraint-parser.ts';
import type { ReferenceAsset } from '../src/types/reel-gen.ts';

function mockRef(overrides: Partial<ReferenceAsset>): ReferenceAsset {
  return {
    id: overrides.id || 'ref_1',
    label: overrides.label || 'Person A',
    fileName: overrides.fileName || 'person_a.jpg',
    mimeType: 'image/jpeg',
    role: overrides.role || 'person_include',
    roleInferred: false,
    enforcement: overrides.enforcement || 'hard',
    storagePath: '/tmp/a.jpg',
    previewUrl: '/api/files/references/a.jpg',
    qualityScore: 0.9,
    faceCount: overrides.faceCount ?? 1,
    usable: true,
    qualityNotes: 'Clear',
    consentConfirmed: true,
  };
}

test('parses strict person inclusion with 30s default vertical format', () => {
  const res = parseCreativeInstruction({
    prompt: 'Create a 30-second reel using only footage where this person appears.',
    references: [mockRef({ id: 'ref_a', label: 'Person A' })],
  });
  assert.equal(res.inferredDurationSec, 30);
  assert.equal(res.inferredAspectRatio, '9:16');
  assert.equal(res.clarificationNeeded, false);
  const inc = res.constraints.find((c) => c.type === 'subject_inclusion');
  assert.ok(inc);
  assert.equal(inc.operator, 'ONLY');
  assert.equal(inc.enforcement, 'hard');
});

test('parses strict exclusion rule', () => {
  const res = parseCreativeInstruction({
    prompt: 'Exclude this person from every shot.',
    references: [mockRef({ id: 'ref_x', label: 'Person X', role: 'person_exclude' })],
  });
  const exc = res.constraints.find((c) => c.type === 'subject_exclusion');
  assert.ok(exc);
  assert.equal(exc.operator, 'NOT');
  assert.equal(exc.enforcement, 'hard');
});

test('parses multi-person AND, OR, and BEFORE sequencing rules', () => {
  const refs = [mockRef({ id: 'ref_a', label: 'Person A' }), mockRef({ id: 'ref_b', label: 'Person B' })];

  const both = parseCreativeInstruction({
    prompt: 'Show only clips where both reference people appear together.',
    references: refs,
  });
  assert.equal(both.constraints.find((c) => c.type === 'subject_inclusion')?.operator, 'AND');

  const either = parseCreativeInstruction({
    prompt: 'Create a reel featuring either Person A or Person B.',
    references: refs,
  });
  assert.equal(either.constraints.find((c) => c.type === 'subject_inclusion')?.operator, 'OR');

  const ordered = parseCreativeInstruction({
    prompt: 'Show Person A first and Person B afterward.',
    references: refs,
  });
  assert.equal(ordered.constraints.find((c) => c.type === 'subject_ordering')?.operator, 'BEFORE');
});

test('detects contradictory instructions and asks concise clarification', () => {
  const c1 = parseCreativeInstruction({
    prompt: 'Show only Person A, but exclude Person A.',
    references: [mockRef({ id: 'ref_a', label: 'Person A' })],
  });
  assert.equal(c1.clarificationNeeded, true);
  assert.ok(c1.contradictions.length >= 1);
  assert.ok(c1.clarificationQuestion);

  const c2 = parseCreativeInstruction({
    prompt: 'Use exactly 10 seconds of footage, but include 30 seconds of mandatory dialogue.',
  });
  assert.equal(c2.clarificationNeeded, true);
  assert.match(c2.clarificationQuestion || '', /30 seconds/);
});

test('detects multi-face ambiguous reference photo', () => {
  const res = parseCreativeInstruction({
    prompt: 'Only show the person in this photo.',
    references: [mockRef({ id: 'ref_group', fileName: 'group_photo.jpg', faceCount: 3 })],
  });
  assert.equal(res.clarificationNeeded, true);
  assert.match(res.clarificationQuestion || '', /Multiple people/);
});

test('parses combined editorial constraints: drone, Goa, no blurry, chronological, silent + captions, logo, multi-platform', () => {
  const combo = parseCreativeInstruction({
    prompt:
      'Use only drone footage recorded in Goa, do not include blurry footage, include scenes in chronological order, avoid repetitive footage, create a silent reel with captions, and end with the attached logo.',
    references: [mockRef({ id: 'ref_logo', label: 'Brand Logo', role: 'brand_logo' })],
  });
  assert.ok(combo.constraints.some((c) => c.type === 'camera_filter' && c.target === 'drone' && c.enforcement === 'hard'));
  assert.ok(combo.constraints.some((c) => c.type === 'location_preference' && c.target === 'Goa'));
  assert.ok(combo.constraints.some((c) => c.type === 'quality_filter' && c.target === 'exclude_blurry'));
  assert.ok(combo.constraints.some((c) => c.type === 'clip_ordering' && c.target === 'chronological'));
  assert.ok(combo.constraints.some((c) => c.type === 'duplicate_filter'));
  assert.ok(combo.constraints.some((c) => c.type === 'audio_treatment' && c.target === 'silent'));
  assert.ok(combo.constraints.some((c) => c.type === 'captions'));
  assert.ok(combo.constraints.some((c) => c.type === 'branding'));

  const multi = parseCreativeInstruction({
    prompt: 'Produce a 15-second Instagram reel and a 60-second YouTube version.',
  });
  assert.equal(multi.requestedVersions.length, 2);
  assert.equal(multi.requestedVersions[0].durationSec, 15);
  assert.equal(multi.requestedVersions[0].aspectRatio, '9:16');
  assert.equal(multi.requestedVersions[1].durationSec, 60);
  assert.equal(multi.requestedVersions[1].aspectRatio, '16:9');
});
