export type AspectRatio = '9:16' | '16:9' | '1:1';
export type EditMode = 'autopilot' | 'copilot' | 'manual';
export type ResolutionPreset = '720p' | '1080p';
export type MediaKind = 'video' | 'image' | 'audio' | 'document' | 'archive' | 'unknown';

export type ReferenceRoleType =
  | 'person_include'
  | 'person_exclude'
  | 'product_feature'
  | 'object_find'
  | 'scene_reference'
  | 'visual_style'
  | 'brand_logo'
  | 'composition_reference';

export type ConstraintOperator =
  | 'AND'
  | 'OR'
  | 'NOT'
  | 'BEFORE'
  | 'AFTER'
  | 'ONLY'
  | 'PREFER'
  | 'EQUALS'
  | 'MAX'
  | 'MIN';

export type ConstraintEnforcement = 'hard' | 'soft';

export type JobState =
  | 'CREATED'
  | 'VALIDATING_SOURCES'
  | 'WAITING_FOR_AUTH'
  | 'INDEXING'
  | 'ANALYZING'
  | 'SELECTING_HIGHLIGHTS'
  | 'PLANNING'
  | 'EDITING'
  | 'RENDERING'
  | 'VALIDATING_OUTPUT'
  | 'COMPLETED'
  | 'RETRYING'
  | 'PAUSED'
  | 'CANCELLED'
  | 'FAILED';

export type CloudProviderId =
  | 'google_drive'
  | 'onedrive'
  | 'sharepoint'
  | 'dropbox'
  | 'box'
  | 's3'
  | 's3_compatible';

export interface ReferenceAsset {
  id: string;
  label: string;
  fileName: string;
  mimeType: string;
  role: ReferenceRoleType;
  roleInferred: boolean;
  enforcement: ConstraintEnforcement;
  storagePath: string;
  previewUrl: string;
  qualityScore: number;
  faceCount: number | null;
  usable: boolean;
  qualityNotes: string;
  descriptor?: number[];
  consentConfirmed: boolean;
}

export interface ParsedConstraint {
  id: string;
  type:
    | 'subject_inclusion'
    | 'subject_exclusion'
    | 'subject_ordering'
    | 'product_matching'
    | 'object_matching'
    | 'scene_matching'
    | 'location_preference'
    | 'camera_filter'
    | 'action_preference'
    | 'emotional_tone'
    | 'story_objective'
    | 'clip_ordering'
    | 'duration'
    | 'aspect_ratio'
    | 'platform'
    | 'pacing'
    | 'transitions'
    | 'captions'
    | 'music'
    | 'dialogue'
    | 'audio_treatment'
    | 'branding'
    | 'color_treatment'
    | 'quality_filter'
    | 'duplicate_filter'
    | 'multi_version';
  target: string;
  referenceAssetIds: string[];
  operator: ConstraintOperator;
  priority: number;
  enforcement: ConstraintEnforcement;
  confidence: number;
  explanation: string;
  validationMethod: string;
  params?: Record<string, string | number | boolean | string[]>;
}

export interface ContradictionIssue {
  id: string;
  constraintIds: string[];
  reason: string;
  clarificationQuestion: string;
}

export interface ParsedInstructionResult {
  rawPrompt: string;
  constraints: ParsedConstraint[];
  humanSummary: string[];
  contradictions: ContradictionIssue[];
  clarificationNeeded: boolean;
  clarificationQuestion: string | null;
  inferredDurationSec: number;
  inferredAspectRatio: AspectRatio;
  inferredCategory: 'wedding' | 'event' | 'sports' | 'product' | 'interview' | 'travel' | 'brand' | 'general';
  inferredStyle: string;
  requestedVersions: Array<{ label: string; durationSec: number; aspectRatio: AspectRatio; platform?: string }>;
}

export interface MediaProbeInfo {
  durationSec: number;
  width: number;
  height: number;
  fps: number;
  videoCodec: string | null;
  audioCodec: string | null;
  hasAudio: boolean;
  orientation: number;
  bitrate: number;
}

export interface MediaSegment {
  id: string;
  assetId: string;
  startSec: number;
  endSec: number;
  shotType: 'wide' | 'medium' | 'closeup' | 'drone' | 'crowd' | 'action' | 'dialogue' | 'product';
  motionEnergy: number;
  visualQuality: number;
  emotionalImpact: number;
  audioQuality: number;
  isBlurry: boolean;
  isDuplicate: boolean;
  transcriptText: string;
  tags: string[];
  matchedReferenceIds: Record<string, { confidence: number; band: 'high' | 'medium' | 'uncertain' | 'none' }>;
}

export interface MediaAssetRecord {
  id: string;
  workspaceId: string;
  projectId: string | null;
  shootId: string | null;
  fileName: string;
  relativePath: string;
  mimeType: string;
  kind: MediaKind;
  decodable: boolean;
  sizeBytes: number;
  sha256: string;
  storagePath: string;
  previewUrl: string;
  thumbnailUrl: string | null;
  sourceProvider: string;
  captureTimestamp: string | null;
  cameraLabel: string | null;
  locationLabel: string | null;
  shootName: string | null;
  availabilityStatus: 'ready' | 'indexing' | 'unsupported_codec' | 'missing_permission' | 'error';
  probe: MediaProbeInfo | null;
  segments: MediaSegment[];
  createdAt: string;
}

export interface EdlClip {
  id: string;
  assetId: string;
  fileName: string;
  sourceStartSec: number;
  sourceEndSec: number;
  timelineStartSec: number;
  timelineEndSec: number;
  transitionIn: 'cut' | 'crossfade' | 'dip_black' | 'whip';
  transitionDurationSec: number;
  speed: number;
  cropMode: 'smart_center' | 'subject_track' | 'fit' | 'fill';
  audioGainDb: number;
  muted: boolean;
  storyBeat: 'hook' | 'context' | 'highlight' | 'peak' | 'payoff';
  score: number;
  reason: string;
  matchedReferenceIds: string[];
  needsReview: boolean;
}

export interface CaptionCue {
  id: string;
  startSec: number;
  endSec: number;
  text: string;
}

export interface BrandOverlay {
  enabled: boolean;
  referenceAssetId: string | null;
  position: 'end_card' | 'top_right' | 'bottom_right';
  durationSec: number;
  text: string;
}

export interface TimelineEdl {
  version: number;
  aspectRatio: AspectRatio;
  resolution: ResolutionPreset;
  targetDurationSec: number;
  actualDurationSec: number;
  fps: number;
  clips: EdlClip[];
  captions: CaptionCue[];
  audioTrack: {
    preserveDialogue: boolean;
    duckBackgroundMusic: boolean;
    silentOutput: boolean;
    musicTrackLabel: string | null;
  };
  colorGrade: 'natural' | 'cinematic' | 'vibrant' | 'warm' | 'reference_matched';
  branding: BrandOverlay;
}

export interface ComplianceItem {
  constraintId: string;
  label: string;
  status: 'met' | 'needs_review' | 'not_satisfied';
  evidence: string;
  confidence: number;
}

export interface ComplianceReport {
  requirementsMet: ComplianceItem[];
  needsReview: ComplianceItem[];
  couldNotBeSatisfied: ComplianceItem[];
  overallCompliant: boolean;
  insufficientFootageNotice: string | null;
}

export interface RenderArtifactRecord {
  id: string;
  projectId: string;
  jobId: string;
  fileName: string;
  storagePath: string;
  downloadUrl: string;
  format: 'mp4';
  videoCodec: string;
  audioCodec: string | null;
  resolution: ResolutionPreset;
  aspectRatio: AspectRatio;
  width: number;
  height: number;
  durationSec: number;
  sizeBytes: number;
  qaPassed: boolean;
  qaChecks: Array<{ name: string; passed: boolean; detail: string }>;
  complianceReport: ComplianceReport;
  createdAt: string;
}

export interface ProcessingJobRecord {
  id: string;
  projectId: string;
  state: JobState;
  progressPct: number;
  stageLabel: string;
  stageDetail: string;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface ProjectVersionRecord {
  version: number;
  label: string;
  edl: TimelineEdl;
  prompt: string | null;
  createdAt: string;
}

export interface ProjectRecord {
  id: string;
  workspaceId: string;
  title: string;
  status: 'draft' | 'processing' | 'ready' | 'needs_clarification' | 'failed';
  brief: string;
  targetDurationSec: number;
  aspectRatio: AspectRatio;
  mode: EditMode;
  style: string;
  cloudLinks: string[];
  references: ReferenceAsset[];
  parsedInstruction: ParsedInstructionResult | null;
  currentEdl: TimelineEdl | null;
  versions: ProjectVersionRecord[];
  activeVersion: number;
  latestArtifact: RenderArtifactRecord | null;
  latestJob: ProcessingJobRecord | null;
  createdAt: string;
  updatedAt: string;
}

export interface ActivityEventRecord {
  id: string;
  workspaceId: string;
  projectId: string | null;
  action: string;
  detail: string;
  createdAt: string;
}

export interface SourceConnectionRecord {
  id: string;
  workspaceId: string;
  provider: CloudProviderId;
  accountEmail: string | null;
  accountLabel: string | null;
  status: 'connected' | 'disconnected' | 'needs_authorization' | 'expired' | 'permission_denied' | 'syncing' | 'failed';
  encryptedAccessToken: string | null;
  encryptedRefreshToken: string | null;
  tokenExpiresAt: string | null;
  scopes: string[];
  lastSyncedAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PublicSourceConnection {
  id: string;
  provider: CloudProviderId;
  accountEmail: string | null;
  accountLabel: string | null;
  status: SourceConnectionRecord['status'];
  tokenExpiresAt: string | null;
  scopes: string[];
  lastSyncedAt: string | null;
  lastError: string | null;
  updatedAt: string;
}

