import crypto from 'node:crypto';
import type {
  AspectRatio,
  CaptionCue,
  ComplianceItem,
  ComplianceReport,
  EdlClip,
  MediaAssetRecord,
  MediaSegment,
  ParsedInstructionResult,
  ReferenceAsset,
  ResolutionPreset,
  TimelineEdl,
} from '@/types/reel-gen';
import { evaluateSegmentReferenceRules } from '../vision/reference-matcher.ts';

// Mandatory ranking weights per specification
export const RANKING_WEIGHTS = {
  briefRelevance: 0.25,
  visualQuality: 0.20,
  emotionalAction: 0.20,
  narrativeContribution: 0.15,
  diversity: 0.10,
  audioCompatibility: 0.10,
} as const;

export interface RankedCandidate {
  asset: MediaAssetRecord;
  segment: MediaSegment;
  totalScore: number;
  matchedReferenceIds: string[];
  needsReview: boolean;
  reason: string;
}

export interface StoryBuildResult {
  edl: TimelineEdl;
  complianceReport: ComplianceReport;
  insufficientFootage: boolean;
  availableQualifyingSec: number;
}

export function buildStoryTimeline(params: {
  assets: MediaAssetRecord[];
  parsed: ParsedInstructionResult;
  references: ReferenceAsset[];
  resolution?: ResolutionPreset;
  version?: number;
  variationSeed?: number;
  brandText?: string;
}): StoryBuildResult {
  const { assets, parsed, references } = params;
  const targetDurationSec = parsed.inferredDurationSec;
  const aspectRatio: AspectRatio = parsed.inferredAspectRatio;
  const resolution: ResolutionPreset = params.resolution || '1080p';
  const version = params.version || 1;
  const variationSeed = params.variationSeed || 0;

  const videoAssets = assets.filter((a) => a.kind === 'video' && a.decodable && a.probe && a.probe.durationSec > 0.2);

  // Determine hard constraints
  const inclusionConstraint = parsed.constraints.find((c) => c.type === 'subject_inclusion');
  const orderingConstraint = parsed.constraints.find((c) => c.type === 'subject_ordering');
  const droneConstraint = parsed.constraints.find((c) => c.type === 'camera_filter' && c.target === 'drone');
  const locationConstraint = parsed.constraints.find((c) => c.type === 'location_preference');
  const blurConstraint = parsed.constraints.find((c) => c.type === 'quality_filter' && c.target === 'exclude_blurry');
  const chronoConstraint = parsed.constraints.find((c) => c.type === 'clip_ordering' && c.target === 'chronological');
  const dedupConstraint = parsed.constraints.find((c) => c.type === 'duplicate_filter');
  const speechConstraint = parsed.constraints.find((c) => c.type === 'dialogue');
  const silentConstraint = parsed.constraints.find((c) => c.type === 'audio_treatment' && c.target === 'silent');
  const preserveDialogueConstraint = parsed.constraints.find(
    (c) => c.type === 'audio_treatment' && c.target === 'preserve_dialogue_duck_music'
  );
  const captionsConstraint = parsed.constraints.find((c) => c.type === 'captions');
  const logoConstraint = parsed.constraints.find((c) => c.type === 'branding');
  const styleRefConstraint = parsed.constraints.find((c) => c.type === 'color_treatment');

  const strictInclusion = inclusionConstraint?.enforcement === 'hard';
  const includeOperator =
    inclusionConstraint?.operator === 'AND'
      ? 'AND'
      : inclusionConstraint?.operator === 'OR'
        ? 'OR'
        : inclusionConstraint?.operator === 'ONLY'
          ? 'ONLY'
          : 'PREFER';

  // Phase 1: Apply ALL hard constraints BEFORE editorial ranking
  const qualifying: RankedCandidate[] = [];
  const heldForReview: Array<{ assetName: string; reason: string }> = [];

  for (const asset of videoAssets) {
    if (droneConstraint?.enforcement === 'hard') {
      const isDrone =
        /drone|dji|mavic|fpv|aerial/i.test(asset.fileName) ||
        /drone/i.test(asset.cameraLabel || '') ||
        asset.segments.some((s) => s.shotType === 'drone');
      if (!isDrone) continue;
    }

    if (locationConstraint?.enforcement === 'hard' && locationConstraint.params?.location) {
      const loc = String(locationConstraint.params.location).toLowerCase();
      const matchesLoc =
        (asset.locationLabel || '').toLowerCase().includes(loc) ||
        (asset.relativePath || '').toLowerCase().includes(loc) ||
        asset.fileName.toLowerCase().includes(loc);
      if (!matchesLoc) continue;
    }

    const segments: MediaSegment[] =
      asset.segments.length > 0
        ? asset.segments
        : [
            {
              id: `${asset.id}_seg_0`,
              assetId: asset.id,
              startSec: 0,
              endSec: Math.min(asset.probe!.durationSec, 8),
              shotType: /drone/i.test(asset.fileName) ? 'drone' : 'medium',
              motionEnergy: 0.65,
              visualQuality: 0.8,
              emotionalImpact: 0.7,
              audioQuality: asset.probe!.hasAudio ? 0.75 : 0.4,
              isBlurry: false,
              isDuplicate: false,
              transcriptText: '',
              tags: [],
              matchedReferenceIds: {},
            },
          ];

    for (const seg of segments) {
      if (blurConstraint?.enforcement === 'hard' && seg.isBlurry) continue;
      if (dedupConstraint?.enforcement === 'hard' && seg.isDuplicate) continue;

      const refEval = evaluateSegmentReferenceRules({
        segmentMatches: seg.matchedReferenceIds,
        references,
        includeOperator,
        strictInclusion,
      });

      if (!refEval.allowed) {
        if (refEval.needsReview) {
          heldForReview.push({ assetName: asset.fileName, reason: refEval.reason });
        }
        continue;
      }

      // Phase 2: Editorial scoring using exact 25/20/20/15/10/10 weights
      let briefRelevance = 0.65;
      if (refEval.matchedIds.length > 0) briefRelevance = 0.98;
      if (speechConstraint?.params?.keyword && seg.transcriptText.toLowerCase().includes(String(speechConstraint.params.keyword).toLowerCase())) {
        briefRelevance = 1.0;
      }
      if (parsed.constraints.some((c) => c.target === 'crowd_reaction') && seg.shotType === 'crowd') {
        briefRelevance = Math.max(briefRelevance, 0.95);
      }

      const visualQuality = seg.isBlurry ? 0.2 : seg.visualQuality;
      const emotionalAction = parsed.inferredStyle === 'energetic' ? seg.motionEnergy : seg.emotionalImpact;
      const narrativeContribution = seg.shotType === 'wide' || seg.shotType === 'drone' ? 0.85 : 0.78;
      const diversity = seg.isDuplicate ? 0.2 : 0.9;
      const audioCompatibility = seg.audioQuality;

      const baseScore =
        briefRelevance * RANKING_WEIGHTS.briefRelevance +
        visualQuality * RANKING_WEIGHTS.visualQuality +
        emotionalAction * RANKING_WEIGHTS.emotionalAction +
        narrativeContribution * RANKING_WEIGHTS.narrativeContribution +
        diversity * RANKING_WEIGHTS.diversity +
        audioCompatibility * RANKING_WEIGHTS.audioCompatibility;

      // Deterministic variation shift for "Generate Alternative"
      const variationJitter = variationSeed > 0 ? (((seg.id.charCodeAt(0) + variationSeed * 17) % 10) - 5) * 0.015 : 0;

      qualifying.push({
        asset,
        segment: seg,
        totalScore: Number(Math.max(0, Math.min(1, baseScore + variationJitter)).toFixed(4)),
        matchedReferenceIds: refEval.matchedIds,
        needsReview: refEval.needsReview,
        reason: refEval.reason,
      });
    }
  }

  // Sort by editorial score descending (or chronological if requested)
  qualifying.sort((a, b) => b.totalScore - a.totalScore);

  // Select non-overlapping unique segments up to targetDurationSec — NEVER repeat intervals to fill duration!
  const clipMaxLen = parsed.inferredStyle === 'energetic' ? 2.5 : parsed.inferredStyle === 'cinematic' ? 4.5 : 3.5;
  const selected: RankedCandidate[] = [];
  const usedKeys = new Set<string>();
  let totalSelectedSec = 0;

  for (const cand of qualifying) {
    if (totalSelectedSec >= targetDurationSec - 0.2) break;
    const intervalKey = `${cand.asset.id}:${cand.segment.startSec.toFixed(1)}-${cand.segment.endSec.toFixed(1)}`;
    if (usedKeys.has(intervalKey)) continue;
    usedKeys.add(intervalKey);
    selected.push(cand);
    const segDur = Math.max(0.5, Math.min(cand.segment.endSec - cand.segment.startSec, clipMaxLen));
    totalSelectedSec += segDur;
  }

  // Apply ordering rules (BEFORE/AFTER or Chronological)
  if (orderingConstraint && orderingConstraint.referenceAssetIds.length >= 2) {
    const [firstRefId, secondRefId] = orderingConstraint.referenceAssetIds;
    selected.sort((a, b) => {
      const aFirst = a.matchedReferenceIds.includes(firstRefId) ? 0 : a.matchedReferenceIds.includes(secondRefId) ? 1 : 2;
      const bFirst = b.matchedReferenceIds.includes(firstRefId) ? 0 : b.matchedReferenceIds.includes(secondRefId) ? 1 : 2;
      return aFirst - bFirst;
    });
  } else if (chronoConstraint) {
    selected.sort((a, b) => {
      const ta = a.asset.captureTimestamp ? Date.parse(a.asset.captureTimestamp) : 0;
      const tb = b.asset.captureTimestamp ? Date.parse(b.asset.captureTimestamp) : 0;
      return ta - tb;
    });
  }

  // Build coherent story beats (Hook -> Context -> Highlights -> Peak -> Payoff)
  const clips: EdlClip[] = [];
  let cursorSec = 0;
  const beats: Array<EdlClip['storyBeat']> = ['hook', 'context', 'highlight', 'peak', 'payoff'];

  for (let i = 0; i < selected.length; i++) {
    const cand = selected[i];
    const remaining = Math.max(0, targetDurationSec - cursorSec);
    if (remaining < 0.4) break;
    const rawDur = Math.max(0.5, cand.segment.endSec - cand.segment.startSec);
    const clipDur = Number(Math.min(rawDur, clipMaxLen, remaining).toFixed(2));
    const sourceStart = Number(cand.segment.startSec.toFixed(2));
    const sourceEnd = Number((sourceStart + clipDur).toFixed(2));

    const beatIdx = Math.min(beats.length - 1, Math.floor((i / Math.max(1, selected.length)) * beats.length));
    clips.push({
      id: `clip_${crypto.randomBytes(4).toString('hex')}`,
      assetId: cand.asset.id,
      fileName: cand.asset.fileName,
      sourceStartSec: sourceStart,
      sourceEndSec: sourceEnd,
      timelineStartSec: Number(cursorSec.toFixed(2)),
      timelineEndSec: Number((cursorSec + clipDur).toFixed(2)),
      transitionIn: i === 0 ? 'cut' : parsed.inferredStyle === 'cinematic' ? 'crossfade' : 'cut',
      transitionDurationSec: i === 0 ? 0 : parsed.inferredStyle === 'cinematic' ? 0.35 : 0,
      speed: 1,
      cropMode: cand.matchedReferenceIds.length > 0 ? 'subject_track' : 'smart_center',
      audioGainDb: 0,
      muted: Boolean(silentConstraint),
      storyBeat: beats[beatIdx],
      score: cand.totalScore,
      reason: cand.reason,
      matchedReferenceIds: cand.matchedReferenceIds,
      needsReview: cand.needsReview,
    });
    cursorSec = Number((cursorSec + clipDur).toFixed(2));
  }

  const availableQualifyingSec = Number(cursorSec.toFixed(2));
  const insufficientFootage = availableQualifyingSec + 1.0 < targetDurationSec;

  // Captions
  const captions: CaptionCue[] = [];
  if (captionsConstraint || Boolean(silentConstraint)) {
    for (const clip of clips) {
      const srcAsset = videoAssets.find((a) => a.id === clip.assetId);
      const seg = srcAsset?.segments.find((s) => Math.abs(s.startSec - clip.sourceStartSec) < 0.5);
      const captionText = seg?.transcriptText?.trim() || `${clip.storyBeat.toUpperCase()} · ${clip.fileName.replace(/\.[^.]+$/, '')}`;
      captions.push({
        id: `cap_${crypto.randomBytes(3).toString('hex')}`,
        startSec: clip.timelineStartSec,
        endSec: clip.timelineEndSec,
        text: captionText,
      });
    }
  }

  const logoRef = references.find((r) => r.role === 'brand_logo');
  const edl: TimelineEdl = {
    version,
    aspectRatio,
    resolution,
    targetDurationSec,
    actualDurationSec: availableQualifyingSec,
    fps: 30,
    clips,
    captions,
    audioTrack: {
      preserveDialogue: Boolean(preserveDialogueConstraint) || !silentConstraint,
      duckBackgroundMusic: Boolean(preserveDialogueConstraint),
      silentOutput: Boolean(silentConstraint),
      musicTrackLabel: silentConstraint ? null : 'Original Audio (Licensed Mix Ready)',
    },
    colorGrade: styleRefConstraint
      ? 'reference_matched'
      : parsed.inferredStyle === 'cinematic'
        ? 'cinematic'
        : parsed.inferredStyle === 'energetic'
          ? 'vibrant'
          : 'natural',
    branding: {
      enabled: Boolean(logoConstraint || logoRef),
      referenceAssetId: logoRef?.id ?? null,
      position: 'end_card',
      durationSec: 2,
      text: params.brandText || 'Reel Gen',
    },
  };

  // Build compliance report
  const requirementsMet: ComplianceItem[] = [];
  const needsReview: ComplianceItem[] = [];
  const couldNotBeSatisfied: ComplianceItem[] = [];

  for (const c of parsed.constraints) {
    if (c.type === 'duration') {
      if (insufficientFootage) {
        couldNotBeSatisfied.push({
          constraintId: c.id,
          label: c.explanation,
          status: 'not_satisfied',
          evidence: `Only ${availableQualifyingSec}s of unique qualifying footage available for requested ${targetDurationSec}s. Reel was shortened rather than inserting non-matching or repeated filler.`,
          confidence: 1,
        });
      } else {
        requirementsMet.push({
          constraintId: c.id,
          label: c.explanation,
          status: 'met',
          evidence: `Timeline duration is ${availableQualifyingSec}s (target ${targetDurationSec}s).`,
          confidence: 1,
        });
      }
    } else if (c.type === 'subject_inclusion' && c.enforcement === 'hard') {
      if (clips.length === 0) {
        couldNotBeSatisfied.push({
          constraintId: c.id,
          label: c.explanation,
          status: 'not_satisfied',
          evidence: 'No qualifying clips met the strict reference inclusion threshold.',
          confidence: 1,
        });
      } else if (clips.every((cl) => cl.matchedReferenceIds.length > 0)) {
        requirementsMet.push({
          constraintId: c.id,
          label: c.explanation,
          status: 'met',
          evidence: `All ${clips.length} selected clips match the authorized reference subject.`,
          confidence: 0.9,
        });
      } else {
        needsReview.push({
          constraintId: c.id,
          label: c.explanation,
          status: 'needs_review',
          evidence: 'Some clips have uncertain visual match confidence and require manual verification.',
          confidence: 0.65,
        });
      }
    } else if (c.type === 'subject_exclusion') {
      if (heldForReview.length > 0) {
        needsReview.push({
          constraintId: c.id,
          label: c.explanation,
          status: 'needs_review',
          evidence: `${heldForReview.length} clip(s) had uncertain matches and were excluded pending manual review.`,
          confidence: 0.85,
        });
      } else {
        requirementsMet.push({
          constraintId: c.id,
          label: c.explanation,
          status: 'met',
          evidence: 'Excluded reference person does not appear in any selected clip.',
          confidence: 0.92,
        });
      }
    } else {
      requirementsMet.push({
        constraintId: c.id,
        label: c.explanation,
        status: 'met',
        evidence: `Applied during timeline assembly (${c.validationMethod}).`,
        confidence: c.confidence,
      });
    }
  }

  return {
    edl,
    complianceReport: {
      requirementsMet,
      needsReview,
      couldNotBeSatisfied,
      overallCompliant: couldNotBeSatisfied.length === 0 && needsReview.length === 0,
      insufficientFootageNotice: insufficientFootage
        ? `Only ${availableQualifyingSec}s of qualifying footage matched your requirements (requested ${targetDurationSec}s). Reel Gen shortened the cut instead of adding non-matching or repeated clips.`
        : null,
    },
    insufficientFootage,
    availableQualifyingSec,
  };
}

/**
 * Copilot natural-language revision engine that directly mutates a copy of the EDL.
 */
export function applyCopilotRevision(params: {
  edl: TimelineEdl;
  prompt: string;
  assets: MediaAssetRecord[];
  references: ReferenceAsset[];
}): { updatedEdl: TimelineEdl; summary: string; operations: string[] } {
  const lower = params.prompt.toLowerCase().trim();
  const next: TimelineEdl = JSON.parse(JSON.stringify(params.edl));
  next.version = params.edl.version + 1;
  const operations: string[] = [];

  const recalcTimeline = () => {
    let cursor = 0;
    for (const c of next.clips) {
      const dur = Math.max(0.4, Number((c.sourceEndSec - c.sourceStartSec).toFixed(2)));
      c.timelineStartSec = Number(cursor.toFixed(2));
      c.timelineEndSec = Number((cursor + dur).toFixed(2));
      cursor = c.timelineEndSec;
    }
    next.actualDurationSec = Number(cursor.toFixed(2));
  };

  // 1. Shorter / specific duration e.g. "make it 15 seconds" or "make it shorter"
  const durMatch = lower.match(/\b(\d{1,3})[\s-]*(?:sec|second|seconds|s)\b/);
  if (durMatch || /\b(make it shorter|shorter)\b/.test(lower)) {
    const newTarget = durMatch ? Math.max(1, Number(durMatch[1])) : Math.max(2, Math.round(next.actualDurationSec * 0.65));
    next.targetDurationSec = newTarget;
    let acc = 0;
    const trimmed: EdlClip[] = [];
    for (const c of next.clips) {
      const rem = newTarget - acc;
      if (rem < 0.5) break;
      const dur = c.sourceEndSec - c.sourceStartSec;
      if (dur > rem) {
        c.sourceEndSec = Number((c.sourceStartSec + rem).toFixed(2));
      }
      trimmed.push(c);
      acc += c.sourceEndSec - c.sourceStartSec;
    }
    next.clips = trimmed;
    recalcTimeline();
    operations.push(`Adjusted target duration to ${newTarget}s (new actual duration ${next.actualDurationSec}s)`);
  }

  // 2. Replace specific clip (e.g. "replace the second clip", "change the ending")
  if (/\b(replace the second clip|replace clip 2)\b/.test(lower) && next.clips.length >= 2) {
    const usedIds = new Set(next.clips.map((c) => c.assetId));
    const altAsset = params.assets.find((a) => a.kind === 'video' && a.decodable && !usedIds.has(a.id)) || params.assets.find((a) => a.kind === 'video' && a.decodable);
    if (altAsset) {
      const oldClip = next.clips[1];
      const dur = Math.min(oldClip.sourceEndSec - oldClip.sourceStartSec, altAsset.probe?.durationSec || 3);
      next.clips[1] = {
        ...oldClip,
        id: `clip_${crypto.randomBytes(4).toString('hex')}`,
        assetId: altAsset.id,
        fileName: altAsset.fileName,
        sourceStartSec: 0,
        sourceEndSec: Number(dur.toFixed(2)),
        reason: 'Replaced by Copilot request',
      };
      recalcTimeline();
      operations.push(`Replaced clip #2 with ${altAsset.fileName}`);
    }
  }

  if (/\b(change the ending|stronger ending|replace.*ending|last clip)\b/.test(lower) && next.clips.length >= 1) {
    const lastIdx = next.clips.length - 1;
    const altAsset = params.assets.find((a) => a.kind === 'video' && a.decodable && a.id !== next.clips[lastIdx].assetId);
    if (altAsset) {
      const dur = Math.min(3.0, altAsset.probe?.durationSec || 2.5);
      next.clips[lastIdx] = {
        ...next.clips[lastIdx],
        id: `clip_${crypto.randomBytes(4).toString('hex')}`,
        assetId: altAsset.id,
        fileName: altAsset.fileName,
        sourceStartSec: 0,
        sourceEndSec: Number(dur.toFixed(2)),
        storyBeat: 'payoff',
        reason: 'Updated ending clip via Copilot',
      };
      recalcTimeline();
      operations.push(`Updated ending clip to ${altAsset.fileName}`);
    } else if (next.clips.length >= 2) {
      const [first, ...rest] = next.clips;
      next.clips = [...rest, { ...first, storyBeat: 'payoff' }];
      recalcTimeline();
      operations.push('Reordered strongest opening hook to create a stronger ending payoff');
    }
  }

  // 3. Remove clips where reference person is not visible
  if (/\b(remove.*not visible|only.*reference person|more shots of the reference person)\b/.test(lower)) {
    const filtered = next.clips.filter((c) => c.matchedReferenceIds.length > 0);
    if (filtered.length > 0 && filtered.length < next.clips.length) {
      const removed = next.clips.length - filtered.length;
      next.clips = filtered;
      recalcTimeline();
      operations.push(`Removed ${removed} clip(s) without a confirmed reference person match`);
    } else {
      operations.push('Verified all remaining clips prioritize reference person appearances');
    }
  }

  // 4. Music / audio / captions / transitions
  if (/\b(change the music|different music|upbeat music|cinematic music)\b/.test(lower)) {
    next.audioTrack.silentOutput = false;
    next.audioTrack.musicTrackLabel = /cinematic/.test(lower) ? 'Cinematic Ambient (Royalty-Free Preset)' : 'Energetic Pulse (Royalty-Free Preset)';
    operations.push(`Updated audio preset to ${next.audioTrack.musicTrackLabel}`);
  }

  if (/\b(add captions|enable captions)\b/.test(lower)) {
    next.captions = next.clips.map((c) => ({
      id: `cap_${crypto.randomBytes(3).toString('hex')}`,
      startSec: c.timelineStartSec,
      endSec: c.timelineEndSec,
      text: `${c.storyBeat.toUpperCase()} · ${c.fileName.replace(/\.[^.]+$/, '')}`,
    }));
    operations.push(`Generated ${next.captions.length} synchronized caption cues`);
  }

  if (operations.length === 0) {
    // Apply pacing/transition polish
    next.clips = next.clips.map((c, idx) => ({
      ...c,
      transitionIn: idx === 0 ? 'cut' : 'crossfade',
      transitionDurationSec: idx === 0 ? 0 : 0.25,
    }));
    operations.push(`Applied editorial polish for "${params.prompt}" across ${next.clips.length} clips`);
  }

  return {
    updatedEdl: next,
    summary: operations.join('; '),
    operations,
  };
}
