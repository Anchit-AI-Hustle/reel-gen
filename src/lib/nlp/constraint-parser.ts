import crypto from 'node:crypto';
import type {
  AspectRatio,
  ContradictionIssue,
  ParsedConstraint,
  ParsedInstructionResult,
  ReferenceAsset,
  ReferenceRoleType,
} from '@/types/reel-gen';

function makeId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(4).toString('hex')}`;
}

export function inferReferenceRoleFromPrompt(
  prompt: string,
  refIndex: number,
  explicitRole?: ReferenceRoleType
): { role: ReferenceRoleType; enforcement: 'hard' | 'soft'; inferred: boolean } {
  if (explicitRole) {
    const isStrict =
      explicitRole === 'person_exclude' ||
      /\b(only|strictly|exclusively|never|exclude|without|do not show|don't show)\b/i.test(prompt);
    return {
      role: explicitRole,
      enforcement: isStrict ? 'hard' : 'soft',
      inferred: false,
    };
  }

  const lower = prompt.toLowerCase();
  if (/\b(exclude|do not show|don't show|without|remove|hide)\b/.test(lower) && /\b(person|photo|face|them|him|her)\b/.test(lower)) {
    return { role: 'person_exclude', enforcement: 'hard', inferred: true };
  }
  if (/\b(logo|watermark|brand|end with the attached logo)\b/.test(lower)) {
    return { role: 'brand_logo', enforcement: 'hard', inferred: true };
  }
  if (/\b(visual style|style reference|color grade|look like this|mood)\b/.test(lower)) {
    return { role: 'visual_style', enforcement: 'soft', inferred: true };
  }
  if (/\b(product|bottle|shoe|watch|phone|item|merch)\b/.test(lower)) {
    return { role: 'product_feature', enforcement: 'hard', inferred: true };
  }
  if (/\b(scene|location|similar scenes|background)\b/.test(lower)) {
    return { role: 'scene_reference', enforcement: 'soft', inferred: true };
  }
  if (/\b(object|car|bike|guitar|ring)\b/.test(lower)) {
    return { role: 'object_find', enforcement: 'soft', inferred: true };
  }
  const strictPerson = /\b(only|strictly|exclusively|every shot|only footage where|only include|only clips where)\b/.test(lower);
  return {
    role: 'person_include',
    enforcement: strictPerson || refIndex >= 0 ? (strictPerson ? 'hard' : 'soft') : 'soft',
    inferred: true,
  };
}

export function parseCreativeInstruction(params: {
  prompt: string;
  references?: ReferenceAsset[];
  defaultDurationSec?: number;
  defaultAspectRatio?: AspectRatio;
}): ParsedInstructionResult {
  const rawPrompt = (params.prompt || '').trim();
  const lower = rawPrompt.toLowerCase();
  const references = params.references || [];
  const constraints: ParsedConstraint[] = [];
  const humanSummary: string[] = [];
  const contradictions: ContradictionIssue[] = [];

  // 1. Duration & multi-version detection
  let inferredDurationSec = params.defaultDurationSec ?? 30;
  let inferredAspectRatio: AspectRatio = params.defaultAspectRatio ?? '9:16';
  const requestedVersions: Array<{ label: string; durationSec: number; aspectRatio: AspectRatio; platform?: string }> = [];

  // Multi-platform version extraction e.g. "15-second Instagram reel and a 60-second YouTube version"
  const igMatch = lower.match(/(\d{1,3})[\s-]*(?:sec|second|seconds|s)\s+(?:[a-z]+\s+){0,2}(instagram|reel|tiktok|shorts)\b|\b(instagram|reel|tiktok|shorts)\s+(?:[a-z]+\s+){0,2}(\d{1,3})[\s-]*(?:sec|second|seconds|s)\b/);
  const ytMatch = lower.match(/(\d{1,3})[\s-]*(?:sec|second|seconds|s)\s+(?:[a-z]+\s+){0,2}(youtube|landscape|widescreen)\b|\b(youtube|landscape|widescreen)\s+(?:[a-z]+\s+){0,2}(\d{1,3})[\s-]*(?:sec|second|seconds|s)\b/);
  if (igMatch && ytMatch) {
    const igDur = Number(igMatch[1] || igMatch[4] || 15);
    const ytDur = Number(ytMatch[1] || ytMatch[4] || 60);
    requestedVersions.push({ label: 'Instagram Reel', durationSec: igDur, aspectRatio: '9:16', platform: 'instagram' });
    requestedVersions.push({ label: 'YouTube Version', durationSec: ytDur, aspectRatio: '16:9', platform: 'youtube' });
    inferredDurationSec = igDur;
    inferredAspectRatio = '9:16';
    constraints.push({
      id: makeId('c_ver'),
      type: 'multi_version',
      target: 'multi_platform_exports',
      referenceAssetIds: [],
      operator: 'AND',
      priority: 90,
      enforcement: 'hard',
      confidence: 0.95,
      explanation: `Produce ${igDur}s vertical Instagram Reel and ${ytDur}s landscape YouTube version`,
      validationMethod: 'artifact_count_and_specs',
      params: { count: 2 },
    });
    humanSummary.push(`Produce a ${igDur}-second 9:16 Instagram reel and a ${ytDur}-second 16:9 YouTube version`);
  } else {
    const durMatch = lower.match(/\b(?:exactly\s+)?(\d{1,3})[\s-]*(?:sec|second|seconds|s)\b/);
    if (durMatch) {
      inferredDurationSec = Math.max(5, Math.min(300, Number(durMatch[1])));
    }
    if (/\b(16:9|landscape|widescreen|youtube|horizontal)\b/.test(lower)) {
      inferredAspectRatio = '16:9';
    } else if (/\b(1:1|square)\b/.test(lower)) {
      inferredAspectRatio = '1:1';
    } else if (/\b(9:16|vertical|portrait|reel|shorts|tiktok|instagram)\b/.test(lower)) {
      inferredAspectRatio = '9:16';
    }

    const versionCountMatch = lower.match(/\b(three|3|two|2|four|4)\s+(?:different\s+)?(?:versions|variations|alternatives|cuts)\b/);
    if (versionCountMatch) {
      const wordMap: Record<string, number> = { two: 2, '2': 2, three: 3, '3': 3, four: 4, '4': 4 };
      const count = wordMap[versionCountMatch[1]] || 3;
      for (let i = 1; i <= count; i++) {
        requestedVersions.push({
          label: `Version ${i}`,
          durationSec: inferredDurationSec,
          aspectRatio: inferredAspectRatio,
        });
      }
      constraints.push({
        id: makeId('c_var'),
        type: 'multi_version',
        target: `${count}_variations`,
        referenceAssetIds: [],
        operator: 'EQUALS',
        priority: 80,
        enforcement: 'hard',
        confidence: 0.95,
        explanation: `Generate ${count} distinct reel variations`,
        validationMethod: 'variation_count',
        params: { count },
      });
      humanSummary.push(`Generate ${count} distinct reel variations`);
    } else {
      requestedVersions.push({
        label: 'Primary Cut',
        durationSec: inferredDurationSec,
        aspectRatio: inferredAspectRatio,
      });
    }
  }

  constraints.push({
    id: makeId('c_dur'),
    type: 'duration',
    target: `${inferredDurationSec}s`,
    referenceAssetIds: [],
    operator: /\bexactly\b/.test(lower) ? 'EQUALS' : 'MAX',
    priority: 85,
    enforcement: /\bexactly\b/.test(lower) ? 'hard' : 'soft',
    confidence: 0.96,
    explanation: `Target approximately ${inferredDurationSec} seconds`,
    validationMethod: 'ffprobe_duration',
    params: { durationSec: inferredDurationSec, exact: /\bexactly\b/.test(lower) },
  });
  humanSummary.push(`Be approximately ${inferredDurationSec} seconds`);

  constraints.push({
    id: makeId('c_ar'),
    type: 'aspect_ratio',
    target: inferredAspectRatio,
    referenceAssetIds: [],
    operator: 'EQUALS',
    priority: 95,
    enforcement: 'hard',
    confidence: 0.98,
    explanation: `Use ${inferredAspectRatio === '9:16' ? 'vertical 9:16' : inferredAspectRatio === '16:9' ? 'landscape 16:9' : 'square 1:1'} format`,
    validationMethod: 'ffprobe_dimensions',
    params: { aspectRatio: inferredAspectRatio },
  });
  humanSummary.push(
    `Use a ${inferredAspectRatio === '9:16' ? 'vertical 9:16' : inferredAspectRatio === '16:9' ? 'landscape 16:9' : 'square 1:1'} format`
  );

  // 2. Reference-image & Person inclusion / exclusion / multi-person logic
  const personIncludeRefs = references.filter((r) => r.role === 'person_include');
  const personExcludeRefs = references.filter((r) => r.role === 'person_exclude');
  const productRefs = references.filter((r) => r.role === 'product_feature');
  const objectRefs = references.filter((r) => r.role === 'object_find');
  const sceneRefs = references.filter((r) => r.role === 'scene_reference');
  const styleRefs = references.filter((r) => r.role === 'visual_style');
  const logoRefs = references.filter((r) => r.role === 'brand_logo');

  const hasStrictOnlyPhrase =
    /\b(only include|only show|only use|using only|only clips where|only footage where|every shot must|exclusively)\b/.test(lower);
  const hasExcludePhrase =
    /\b(exclude|do not show|don't show|never show|without|remove)\b/.test(lower);
  const hasBothTogetherPhrase =
    /\b(both|together|at the same time|in the same shot)\b/.test(lower);
  const hasEitherPhrase =
    /\b(either|or)\b/.test(lower) && /\b(person|people|two|both|a or b)\b/.test(lower);
  const hasSequencePhrase =
    /\b(first[, ]+then|first and .* afterward|before)\b/.test(lower);

  if (personIncludeRefs.length >= 2 && hasBothTogetherPhrase) {
    constraints.push({
      id: makeId('c_both'),
      type: 'subject_inclusion',
      target: personIncludeRefs.map((r) => r.label).join(' AND '),
      referenceAssetIds: personIncludeRefs.map((r) => r.id),
      operator: 'AND',
      priority: 100,
      enforcement: hasStrictOnlyPhrase ? 'hard' : 'soft',
      confidence: 0.94,
      explanation: `Include clips where ${personIncludeRefs.map((r) => r.label).join(' and ')} appear together`,
      validationMethod: 'reference_interval_intersection',
    });
    humanSummary.push(`Include only clips where both reference people appear together`);
  } else if (personIncludeRefs.length >= 2 && hasSequencePhrase) {
    constraints.push({
      id: makeId('c_seq'),
      type: 'subject_ordering',
      target: `${personIncludeRefs[0].label} BEFORE ${personIncludeRefs[1].label}`,
      referenceAssetIds: [personIncludeRefs[0].id, personIncludeRefs[1].id],
      operator: 'BEFORE',
      priority: 98,
      enforcement: 'hard',
      confidence: 0.92,
      explanation: `Show ${personIncludeRefs[0].label} first, then ${personIncludeRefs[1].label}`,
      validationMethod: 'timeline_order_check',
    });
    humanSummary.push(`Show ${personIncludeRefs[0].label} first, followed by ${personIncludeRefs[1].label}`);
  } else if (personIncludeRefs.length >= 2 && hasEitherPhrase) {
    constraints.push({
      id: makeId('c_either'),
      type: 'subject_inclusion',
      target: personIncludeRefs.map((r) => r.label).join(' OR '),
      referenceAssetIds: personIncludeRefs.map((r) => r.id),
      operator: 'OR',
      priority: 95,
      enforcement: hasStrictOnlyPhrase ? 'hard' : 'soft',
      confidence: 0.93,
      explanation: `Feature either ${personIncludeRefs.map((r) => r.label).join(' or ')}`,
      validationMethod: 'reference_interval_union',
    });
    humanSummary.push(`Include shots featuring either ${personIncludeRefs.map((r) => r.label).join(' or ')}`);
  } else if (personIncludeRefs.length > 0) {
    const isHard = hasStrictOnlyPhrase || personIncludeRefs.some((r) => r.enforcement === 'hard');
    constraints.push({
      id: makeId('c_inc'),
      type: 'subject_inclusion',
      target: personIncludeRefs.map((r) => r.label).join(', '),
      referenceAssetIds: personIncludeRefs.map((r) => r.id),
      operator: isHard ? 'ONLY' : 'PREFER',
      priority: isHard ? 100 : 80,
      enforcement: isHard ? 'hard' : 'soft',
      confidence: 0.95,
      explanation: isHard
        ? `Include only shots containing ${personIncludeRefs.map((r) => r.label).join(', ')}`
        : `Prioritize shots featuring ${personIncludeRefs.map((r) => r.label).join(', ')} while allowing contextual cuts`,
      validationMethod: 'reference_person_presence',
    });
    humanSummary.push(
      isHard
        ? `Include only shots containing the reference person (${personIncludeRefs.map((r) => r.label).join(', ')})`
        : `Prioritize appearances of ${personIncludeRefs.map((r) => r.label).join(', ')} with supporting contextual shots`
    );
  }

  if (personExcludeRefs.length > 0) {
    constraints.push({
      id: makeId('c_exc'),
      type: 'subject_exclusion',
      target: personExcludeRefs.map((r) => r.label).join(', '),
      referenceAssetIds: personExcludeRefs.map((r) => r.id),
      operator: 'NOT',
      priority: 100,
      enforcement: 'hard',
      confidence: 0.97,
      explanation: `Strictly exclude ${personExcludeRefs.map((r) => r.label).join(', ')} from every shot`,
      validationMethod: 'reference_person_absence',
    });
    humanSummary.push(`Exclude ${personExcludeRefs.map((r) => r.label).join(', ')} from all shots (flagging uncertain matches for review)`);
  }

  // Contradiction check 1: Same person included AND excluded in prompt text or via same reference ID
  const namedPersonContradiction = lower.match(/only\s+(person\s+[a-z0-9]+|this person)[^.]*(?:exclude|without|not show)\s+\1/);
  const overlappingRefIds = personIncludeRefs
    .map((r) => r.id)
    .filter((id) => personExcludeRefs.some((e) => e.id === id));
  const sameLabelOverlap = personIncludeRefs.some((inc) =>
    personExcludeRefs.some((exc) => inc.label.toLowerCase() === exc.label.toLowerCase())
  );

  if (namedPersonContradiction || overlappingRefIds.length > 0 || sameLabelOverlap || (hasStrictOnlyPhrase && hasExcludePhrase && references.length === 1)) {
    contradictions.push({
      id: makeId('contra_person'),
      constraintIds: constraints
        .filter((c) => c.type === 'subject_inclusion' || c.type === 'subject_exclusion')
        .map((c) => c.id),
      reason: 'The instruction both requires showing only a person and excluding that same person.',
      clarificationQuestion: 'Should Reel Gen strictly feature this person or exclude them from the reel?',
    });
  }

  // Contradiction check 2: Mandatory dialogue longer than requested exact duration
  const mandatoryDialogueMatch = lower.match(/(\d{1,3})[\s-]*(?:sec|second|seconds|s)\s+of\s+(?:mandatory|required)\s+dialogue/);
  if (mandatoryDialogueMatch) {
    const dialogueSec = Number(mandatoryDialogueMatch[1]);
    if (dialogueSec > inferredDurationSec) {
      contradictions.push({
        id: makeId('contra_dur'),
        constraintIds: constraints.filter((c) => c.type === 'duration').map((c) => c.id),
        reason: `Requested duration (${inferredDurationSec}s) is shorter than mandatory dialogue (${dialogueSec}s).`,
        clarificationQuestion: `Would you like to extend the reel to ${dialogueSec} seconds to fit the mandatory dialogue, or trim the dialogue to fit ${inferredDurationSec} seconds?`,
      });
    }
  }

  // Contradiction check 3: Multi-face ambiguous reference photo
  const ambiguousFaceRef = references.find((r) => (r.role === 'person_include' || r.role === 'person_exclude') && (r.faceCount ?? 0) > 1);
  if (ambiguousFaceRef) {
    contradictions.push({
      id: makeId('contra_multiface'),
      constraintIds: constraints.filter((c) => c.referenceAssetIds.includes(ambiguousFaceRef.id)).map((c) => c.id),
      reason: `Reference photo "${ambiguousFaceRef.fileName}" contains ${ambiguousFaceRef.faceCount} detected faces, so the target person is ambiguous.`,
      clarificationQuestion: `Multiple people were detected in "${ambiguousFaceRef.fileName}". Please upload a cropped photo of the specific person or confirm which person to track.`,
    });
  }

  // Product / Object / Scene / Style / Logo references
  if (productRefs.length > 0 || /\bproduct reel\b/.test(lower)) {
    constraints.push({
      id: makeId('c_prod'),
      type: 'product_matching',
      target: productRefs.map((r) => r.label).join(', ') || 'reference product',
      referenceAssetIds: productRefs.map((r) => r.id),
      operator: 'PREFER',
      priority: 90,
      enforcement: productRefs.length > 0 ? 'hard' : 'soft',
      confidence: 0.9,
      explanation: 'Highlight shots featuring the reference product',
      validationMethod: 'reference_product_match',
    });
    humanSummary.push('Highlight shots featuring the attached reference product');
  }

  if (objectRefs.length > 0) {
    constraints.push({
      id: makeId('c_obj'),
      type: 'object_matching',
      target: objectRefs.map((r) => r.label).join(', '),
      referenceAssetIds: objectRefs.map((r) => r.id),
      operator: 'PREFER',
      priority: 80,
      enforcement: 'soft',
      confidence: 0.88,
      explanation: `Find shots containing ${objectRefs.map((r) => r.label).join(', ')}`,
      validationMethod: 'reference_object_match',
    });
  }

  if (sceneRefs.length > 0) {
    constraints.push({
      id: makeId('c_scene'),
      type: 'scene_matching',
      target: sceneRefs.map((r) => r.label).join(', '),
      referenceAssetIds: sceneRefs.map((r) => r.id),
      operator: 'PREFER',
      priority: 75,
      enforcement: 'soft',
      confidence: 0.88,
      explanation: 'Match scenes visually similar to the scene reference',
      validationMethod: 'visual_similarity_score',
    });
  }

  if (styleRefs.length > 0) {
    constraints.push({
      id: makeId('c_style_ref'),
      type: 'color_treatment',
      target: 'reference_matched',
      referenceAssetIds: styleRefs.map((r) => r.id),
      operator: 'EQUALS',
      priority: 75,
      enforcement: 'soft',
      confidence: 0.9,
      explanation: 'Match color palette and visual mood to the style reference image',
      validationMethod: 'color_grade_applied',
    });
    humanSummary.push('Match color and visual tone to the attached style reference');
  }

  if (logoRefs.length > 0 || /\bend with the attached logo\b|\bbrand logo\b/.test(lower)) {
    constraints.push({
      id: makeId('c_logo'),
      type: 'branding',
      target: 'end_card_logo',
      referenceAssetIds: logoRefs.map((r) => r.id),
      operator: 'AFTER',
      priority: 90,
      enforcement: 'hard',
      confidence: 0.95,
      explanation: 'End the reel with the attached brand logo overlay/end-card',
      validationMethod: 'branding_overlay_present',
    });
    humanSummary.push('End with the attached brand logo');
  }

  // 3. Camera, Location, Quality, Duplicate, Ordering, Dialogue, Audio, Captions, Style
  if (/\b(only drone|drone footage|aerial)\b/.test(lower)) {
    const strict = /\bonly\b/.test(lower);
    constraints.push({
      id: makeId('c_drone'),
      type: 'camera_filter',
      target: 'drone',
      referenceAssetIds: [],
      operator: strict ? 'ONLY' : 'PREFER',
      priority: strict ? 95 : 75,
      enforcement: strict ? 'hard' : 'soft',
      confidence: 0.94,
      explanation: strict ? 'Use only drone/aerial footage' : 'Prioritize drone/aerial shots',
      validationMethod: 'camera_tag_check',
    });
    humanSummary.push(strict ? 'Use only drone footage' : 'Prioritize drone shots');
  }

  const locationMatch = rawPrompt.match(/\b(?:recorded in|shot in|from|in)\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)\b/);
  if (locationMatch && !/^(The|This|Person|Camera|Instagram|YouTube|Only)$/.test(locationMatch[1])) {
    const loc = locationMatch[1];
    const strict = /\bonly\b/.test(lower);
    constraints.push({
      id: makeId('c_loc'),
      type: 'location_preference',
      target: loc,
      referenceAssetIds: [],
      operator: strict ? 'ONLY' : 'PREFER',
      priority: strict ? 95 : 70,
      enforcement: strict ? 'hard' : 'soft',
      confidence: 0.9,
      explanation: strict ? `Use only clips recorded in ${loc}` : `Prioritize clips from ${loc}`,
      validationMethod: 'shoot_location_metadata',
      params: { location: loc },
    });
    humanSummary.push(strict ? `Use only clips recorded in ${loc}` : `Prioritize footage from ${loc}`);
  }

  if (/\b(crowd reactions?|audience reactions?)\b/.test(lower)) {
    constraints.push({
      id: makeId('c_crowd'),
      type: 'emotional_tone',
      target: 'crowd_reaction',
      referenceAssetIds: [],
      operator: 'PREFER',
      priority: 82,
      enforcement: 'soft',
      confidence: 0.9,
      explanation: 'Prioritize strong crowd reaction shots',
      validationMethod: 'segment_tag_check',
    });
    humanSummary.push('Prioritize the strongest crowd reactions');
  }

  const speechMatch = lower.match(/\bmentions?\s+(?:the\s+)?([a-z0-9\s]{3,40}?)(?:[.,;]|$)/);
  if (speechMatch) {
    const phrase = speechMatch[1].trim();
    constraints.push({
      id: makeId('c_speech'),
      type: 'dialogue',
      target: phrase,
      referenceAssetIds: [],
      operator: 'AND',
      priority: 95,
      enforcement: 'hard',
      confidence: 0.92,
      explanation: `Include the spoken moment mentioning "${phrase}"`,
      validationMethod: 'transcript_keyword_match',
      params: { keyword: phrase },
    });
    humanSummary.push(`Include the spoken moment mentioning "${phrase}"`);
  }

  if (/\b(no blurry|not include blurry|without blurry|avoid blurry|sharp only)\b/.test(lower)) {
    constraints.push({
      id: makeId('c_blur'),
      type: 'quality_filter',
      target: 'exclude_blurry',
      referenceAssetIds: [],
      operator: 'NOT',
      priority: 92,
      enforcement: 'hard',
      confidence: 0.96,
      explanation: 'Exclude blurry or out-of-focus footage',
      validationMethod: 'sharpness_threshold_check',
    });
    humanSummary.push('Exclude blurry footage');
  }

  if (/\b(chronological|in order|time order)\b/.test(lower)) {
    constraints.push({
      id: makeId('c_chrono'),
      type: 'clip_ordering',
      target: 'chronological',
      referenceAssetIds: [],
      operator: 'EQUALS',
      priority: 88,
      enforcement: 'hard',
      confidence: 0.95,
      explanation: 'Order selected scenes chronologically by capture time',
      validationMethod: 'timestamp_monotonic_check',
    });
    humanSummary.push('Arrange scenes in chronological order');
  }

  if (/\b(avoid repetitive|no duplicates?|unique shots|don't repeat)\b/.test(lower)) {
    constraints.push({
      id: makeId('c_dedup'),
      type: 'duplicate_filter',
      target: 'no_repetitive_footage',
      referenceAssetIds: [],
      operator: 'NOT',
      priority: 85,
      enforcement: 'hard',
      confidence: 0.95,
      explanation: 'Avoid repetitive or near-duplicate shots',
      validationMethod: 'duplicate_interval_check',
    });
    humanSummary.push('Avoid repetitive footage');
  }

  if (/\b(silent|muted|no audio)\b/.test(lower)) {
    constraints.push({
      id: makeId('c_silent'),
      type: 'audio_treatment',
      target: 'silent',
      referenceAssetIds: [],
      operator: 'EQUALS',
      priority: 92,
      enforcement: 'hard',
      confidence: 0.97,
      explanation: 'Render a silent reel (muted audio track)',
      validationMethod: 'audio_silence_check',
    });
    humanSummary.push('Produce a silent reel');
  } else if (/\b(keep original dialogue|preserve.*dialogue|lower background music|duck)\b/.test(lower)) {
    constraints.push({
      id: makeId('c_dial'),
      type: 'audio_treatment',
      target: 'preserve_dialogue_duck_music',
      referenceAssetIds: [],
      operator: 'EQUALS',
      priority: 85,
      enforcement: 'soft',
      confidence: 0.94,
      explanation: 'Preserve original dialogue and duck background music',
      validationMethod: 'audio_mix_config',
    });
    humanSummary.push('Preserve relevant dialogue and lower background music');
  }

  if (/\b(caption|captions|subtitle|subtitles)\b/.test(lower)) {
    constraints.push({
      id: makeId('c_cap'),
      type: 'captions',
      target: 'enabled',
      referenceAssetIds: [],
      operator: 'EQUALS',
      priority: 90,
      enforcement: 'hard',
      confidence: 0.97,
      explanation: 'Include synchronized on-screen captions',
      validationMethod: 'caption_track_present',
    });
    humanSummary.push('Include synchronized captions');
  }

  // Category & style inference
  let inferredCategory: ParsedInstructionResult['inferredCategory'] = 'general';
  if (/\b(bride|groom|wedding|ceremony|vows)\b/.test(lower)) inferredCategory = 'wedding';
  else if (/\b(sport|game|match|goal|action|athlete|sprint)\b/.test(lower)) inferredCategory = 'sports';
  else if (/\b(product|launch|unboxing|bottle|merch)\b/.test(lower)) inferredCategory = 'product';
  else if (/\b(interview|speaker|keynote|podcast|talk)\b/.test(lower)) inferredCategory = 'interview';
  else if (/\b(travel|goa|trip|vacation|beach|mountain)\b/.test(lower)) inferredCategory = 'travel';
  else if (/\b(brand|commercial|campaign|logo)\b/.test(lower)) inferredCategory = 'brand';
  else if (/\b(event|crowd|concert|party|conference)\b/.test(lower)) inferredCategory = 'event';

  let inferredStyle = 'smart';
  if (/\b(fast-paced|energetic|dynamic|hype|upbeat|action)\b/.test(lower)) {
    inferredStyle = 'energetic';
    constraints.push({
      id: makeId('c_pace'),
      type: 'pacing',
      target: 'fast_energetic',
      referenceAssetIds: [],
      operator: 'PREFER',
      priority: 75,
      enforcement: 'soft',
      confidence: 0.92,
      explanation: 'Prioritize energetic moments with faster cuts',
      validationMethod: 'clip_pacing_metric',
    });
    humanSummary.push('Prioritize energetic moments with fast-paced cuts');
  } else if (/\b(cinematic|emotional|slow|dramatic|story)\b/.test(lower)) {
    inferredStyle = 'cinematic';
    constraints.push({
      id: makeId('c_cine'),
      type: 'emotional_tone',
      target: 'cinematic_emotional',
      referenceAssetIds: [],
      operator: 'PREFER',
      priority: 75,
      enforcement: 'soft',
      confidence: 0.92,
      explanation: 'Use cinematic pacing and emotional storytelling arc',
      validationMethod: 'story_arc_check',
    });
    humanSummary.push('Use a cinematic, emotional storytelling arc');
  }

  if (humanSummary.length === 2 && !rawPrompt) {
    humanSummary.push('Automatically select the strongest visual and story moments');
  }

  return {
    rawPrompt,
    constraints,
    humanSummary,
    contradictions,
    clarificationNeeded: contradictions.length > 0,
    clarificationQuestion: contradictions[0]?.clarificationQuestion ?? null,
    inferredDurationSec,
    inferredAspectRatio,
    inferredCategory,
    inferredStyle,
    requestedVersions,
  };
}
