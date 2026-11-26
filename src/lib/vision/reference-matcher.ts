import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ReferenceAsset, ReferenceRoleType } from '@/types/reel-gen';

const execFileAsync = promisify(execFile);

export interface ReferenceValidationResult {
  usable: boolean;
  qualityScore: number;
  faceCount: number | null;
  width: number;
  height: number;
  qualityNotes: string;
  descriptor: number[];
}

export interface TemporalMatchInterval {
  referenceAssetId: string;
  mediaAssetId: string;
  startSec: number;
  endSec: number;
  avgConfidence: number;
  minConfidence: number;
  band: 'high' | 'medium' | 'uncertain' | 'none';
  needsReview: boolean;
}

/**
 * Extracts a compact, privacy-preserving 24-bin RGB spatial color/luminance descriptor
 * from an image or video frame using FFmpeg rawvideo output (zero paid APIs, strictly local).
 */
export async function extractVisualDescriptorFromFile(filePath: string, timestampSec?: number): Promise<{
  descriptor: number[];
  width: number;
  height: number;
  sharpness: number;
}> {
  if (!fs.existsSync(filePath)) {
    return { descriptor: new Array(24).fill(0), width: 0, height: 0, sharpness: 0 };
  }

  try {
    // Probe dimensions first
    const probeRes = await execFileAsync('ffprobe', [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height',
      '-of', 'json',
      filePath,
    ]);
    const parsed = JSON.parse(probeRes.stdout || '{}');
    const stream = parsed.streams?.[0] || {};
    const width = Number(stream.width || 0);
    const height = Number(stream.height || 0);

    // Extract a tiny 16x16 RGB24 frame for deterministic, privacy-preserving local visual signature
    const args: string[] = ['-v', 'error'];
    if (typeof timestampSec === 'number' && timestampSec >= 0) {
      args.push('-ss', timestampSec.toFixed(2));
    }
    args.push(
      '-i', filePath,
      '-frames:v', '1',
      '-vf', 'scale=16:16:flags=area',
      '-f', 'rawvideo',
      '-pix_fmt', 'rgb24',
      'pipe:1'
    );

    const { stdout } = await execFileAsync('ffmpeg', args, { encoding: 'buffer', maxBuffer: 1024 * 1024 });
    const buf = Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout);
    if (buf.length < 16 * 16 * 3) {
      return { descriptor: new Array(24).fill(0), width, height, sharpness: 0.5 };
    }

    // 24-dim descriptor: 8 spatial-color buckets (top/bottom x R/G/B + center region + edge energy)
    const bins = new Array(24).fill(0);
    let edgeSum = 0;
    let count = 0;

    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const idx = (y * 16 + x) * 3;
        const r = buf[idx] / 255;
        const g = buf[idx + 1] / 255;
        const b = buf[idx + 2] / 255;

        const quad = (y < 8 ? 0 : 2) + (x < 8 ? 0 : 1); // 0..3
        bins[quad * 3 + 0] += r;
        bins[quad * 3 + 1] += g;
        bins[quad * 3 + 2] += b;

        // Center crop (face/subject region) gets dedicated bins 12..23
        if (x >= 4 && x < 12 && y >= 3 && y < 13) {
          const cBucket = (y < 8 ? 0 : 2) + (x < 8 ? 0 : 1);
          bins[12 + cBucket * 3 + 0] += r;
          bins[12 + cBucket * 3 + 1] += g;
          bins[12 + cBucket * 3 + 2] += b;
        }

        if (x > 0 && y > 0) {
          const leftIdx = (y * 16 + (x - 1)) * 3;
          const upIdx = ((y - 1) * 16 + x) * 3;
          const diff =
            Math.abs(buf[idx] - buf[leftIdx]) +
            Math.abs(buf[idx] - buf[upIdx]);
          edgeSum += diff / 510;
          count++;
        }
      }
    }

    const norm = Math.sqrt(bins.reduce((acc, v) => acc + v * v, 0)) || 1;
    const descriptor = bins.map((v) => Number((v / norm).toFixed(5)));
    const sharpness = count > 0 ? Math.min(1, Number(((edgeSum / count) * 4.5).toFixed(3))) : 0.5;

    return { descriptor, width, height, sharpness };
  } catch {
    return { descriptor: new Array(24).fill(0), width: 0, height: 0, sharpness: 0 };
  }
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a.length || a.length !== b.length) return 0;
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  if (magA === 0 || magB === 0) return 0;
  return Math.max(0, Math.min(1, dot / (Math.sqrt(magA) * Math.sqrt(magB))));
}

export function classifyConfidenceBand(confidence: number): 'high' | 'medium' | 'uncertain' | 'none' {
  if (confidence >= 0.86) return 'high';
  if (confidence >= 0.72) return 'medium';
  if (confidence >= 0.58) return 'uncertain';
  return 'none';
}

/** A global color descriptor supports appearance similarity only, not semantic identity. */
export function assessReferenceCandidate(
  role: ReferenceRoleType,
  referenceDescriptor: number[],
  frameDescriptor: number[],
): { confidence: number; band: 'high' | 'medium' | 'uncertain' | 'none' } {
  if (role !== 'visual_style' && role !== 'composition_reference') {
    return { confidence: 0, band: 'uncertain' };
  }
  if (!referenceDescriptor.length || !frameDescriptor.length ||
      !referenceDescriptor.some(Boolean) || !frameDescriptor.some(Boolean)) {
    return { confidence: 0, band: 'uncertain' };
  }
  const similarity = cosineSimilarity(referenceDescriptor, frameDescriptor);
  return { confidence: Number(similarity.toFixed(3)), band: classifyConfidenceBand(similarity) };
}

export async function validateReferenceImage(params: {
  filePath: string;
  fileName: string;
  role: ReferenceRoleType;
  consentConfirmed: boolean;
}): Promise<ReferenceValidationResult> {
  const { descriptor, width, height, sharpness } = await extractVisualDescriptorFromFile(params.filePath);
  const notes: string[] = [];

  if (width === 0 || height === 0) {
    return {
      usable: false,
      qualityScore: 0,
      faceCount: null,
      width: 0,
      height: 0,
      qualityNotes: 'Image could not be decoded. Please upload a clear JPG, PNG, or WebP photo.',
      descriptor,
    };
  }

  let qualityScore = 0.85;
  if (width < 120 || height < 120) {
    qualityScore -= 0.45;
    notes.push(`Low resolution (${width}x${height}).`);
  }
  if (sharpness < 0.12) {
    qualityScore -= 0.25;
    notes.push('Low visual contrast/sharpness detected.');
  }

  // The color descriptor is not a face detector. Never infer a face count from a filename.
  const faceCount = null;
  if (params.role === 'person_include' || params.role === 'person_exclude') {
    notes.push('Face count and person identity are unverified. A validated matching engine is required before automatic selection.');
  }
  if ((params.role === 'person_include' || params.role === 'person_exclude') && !params.consentConfirmed) {
    notes.push('User authorization confirmation required before matching person appearances.');
  }

  const clampedScore = Math.max(0.05, Math.min(1, Number(qualityScore.toFixed(2))));
  const usable = width >= 64 && height >= 64 && clampedScore >= 0.35 && params.consentConfirmed;

  return {
    usable,
    qualityScore: clampedScore,
    faceCount,
    width,
    height,
    qualityNotes: notes.length > 0 ? notes.join(' ') : `Clear reference image (${width}x${height}).`,
    descriptor,
  };
}

/**
 * Evaluates whether a candidate segment satisfies reference inclusion/exclusion/AND/OR rules.
 * Never silently treats uncertain exclusion matches as safe.
 */
export function evaluateSegmentReferenceRules(params: {
  segmentMatches: Record<string, { confidence: number; band: 'high' | 'medium' | 'uncertain' | 'none' }>;
  references: ReferenceAsset[];
  includeOperator: 'ONLY' | 'AND' | 'OR' | 'PREFER';
  strictInclusion: boolean;
}): {
  allowed: boolean;
  needsReview: boolean;
  matchedIds: string[];
  reason: string;
} {
  const includeRefs = params.references.filter((r) => r.role === 'person_include' || r.role === 'product_feature');
  const excludeRefs = params.references.filter((r) => r.role === 'person_exclude');

  // 1. Strict exclusion always runs first
  for (const ex of excludeRefs) {
    const m = params.segmentMatches[ex.id];
    if (!m) {
      return {
        allowed: false,
        needsReview: true,
        matchedIds: [],
        reason: 'Held for manual review: no verified exclusion evidence for ' + ex.label,
      };
    }
    if (m.band === 'high' || m.band === 'medium') {
      return {
        allowed: false,
        needsReview: false,
        matchedIds: [],
        reason: `Excluded: matches "${ex.label}" (${Math.round(m.confidence * 100)}% confidence)`,
      };
    }
    if (m.band === 'uncertain') {
      return {
        allowed: false,
        needsReview: true,
        matchedIds: [],
        reason: `Held for manual review: uncertain match with excluded "${ex.label}" (${Math.round(m.confidence * 100)}%)`,
      };
    }
  }

  if (includeRefs.length === 0) {
    return { allowed: true, needsReview: false, matchedIds: [], reason: 'No reference inclusion filter active' };
  }

  const matchedIds = includeRefs
    .filter((ref) => {
      const m = params.segmentMatches[ref.id];
      return m && (m.band === 'high' || m.band === 'medium');
    })
    .map((r) => r.id);

  const uncertainIds = includeRefs
    .filter((ref) => !params.segmentMatches[ref.id] || params.segmentMatches[ref.id]?.band === 'uncertain')
    .map((r) => r.id);

  if (params.includeOperator === 'AND') {
    const allMatched = includeRefs.every((r) => matchedIds.includes(r.id));
    if (allMatched) {
      return { allowed: true, needsReview: false, matchedIds, reason: 'All required reference subjects matched together' };
    }
    if (params.strictInclusion) {
      return {
        allowed: false,
        needsReview: uncertainIds.length > 0,
        matchedIds,
        reason: 'Excluded by strict AND rule: not all reference subjects appear together',
      };
    }
    return { allowed: true, needsReview: false, matchedIds, reason: 'Soft AND preference: contextual fallback allowed' };
  }

  // ONLY or OR or PREFER
  if (matchedIds.length > 0) {
    return { allowed: true, needsReview: false, matchedIds, reason: `Matched reference (${matchedIds.join(', ')})` };
  }

  if (params.strictInclusion) {
    return {
      allowed: false,
      needsReview: uncertainIds.length > 0,
      matchedIds: [],
      reason:
        uncertainIds.length > 0
          ? 'Uncertain reference match held for manual review under strict inclusion'
          : 'Excluded by strict inclusion rule: reference subject not detected',
    };
  }

  return {
    allowed: true,
    needsReview: false,
    matchedIds: [],
    reason: 'Soft inclusion: allowed as contextual supporting shot',
  };
}
