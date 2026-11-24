-- Reel Gen V2 — Cloudflare D1 (SQLite) Migration 0002: Reference-Image Matching, Consent & Constraints
-- Strictly project-scoped ephemeral descriptors; zero global person-identification database.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS reference_images (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  r2_object_key TEXT NOT NULL,
  sha256_hash TEXT NOT NULL,
  quality_score REAL NOT NULL DEFAULT 0,
  face_count INTEGER NOT NULL DEFAULT 0,
  usable INTEGER NOT NULL DEFAULT 1 CHECK (usable IN (0, 1)),
  quality_notes TEXT,
  ephemeral_descriptor_enc TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_reference_images_project ON reference_images(project_id);

CREATE TABLE IF NOT EXISTS reference_subjects (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  reference_image_id TEXT NOT NULL REFERENCES reference_images(id) ON DELETE CASCADE,
  subject_label TEXT NOT NULL,
  subject_kind TEXT NOT NULL CHECK (subject_kind IN ('person', 'product', 'object', 'scene', 'style', 'logo', 'composition')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS reference_roles (
  id TEXT PRIMARY KEY,
  reference_image_id TEXT NOT NULL REFERENCES reference_images(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN (
    'person_include',
    'person_exclude',
    'product_feature',
    'object_find',
    'scene_reference',
    'visual_style',
    'brand_logo',
    'composition_reference'
  )),
  inferred INTEGER NOT NULL DEFAULT 0 CHECK (inferred IN (0, 1)),
  enforcement TEXT NOT NULL DEFAULT 'soft' CHECK (enforcement IN ('hard', 'soft')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS consent_records (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  consent_type TEXT NOT NULL CHECK (consent_type IN ('reference_person_matching', 'source_footage_processing')),
  granted INTEGER NOT NULL CHECK (granted IN (0, 1)),
  statement TEXT NOT NULL,
  granted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_consent_records_project ON consent_records(project_id);

CREATE TABLE IF NOT EXISTS candidate_visual_matches (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  reference_image_id TEXT NOT NULL REFERENCES reference_images(id) ON DELETE CASCADE,
  media_asset_id TEXT NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
  timestamp_sec REAL NOT NULL,
  confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  confidence_band TEXT NOT NULL CHECK (confidence_band IN ('high', 'medium', 'uncertain', 'none')),
  bbox_json TEXT,
  manual_override TEXT CHECK (manual_override IN ('confirmed', 'rejected') OR manual_override IS NULL),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_visual_matches_project ON candidate_visual_matches(project_id, reference_image_id);

CREATE TABLE IF NOT EXISTS temporal_appearance_intervals (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  reference_image_id TEXT NOT NULL REFERENCES reference_images(id) ON DELETE CASCADE,
  media_asset_id TEXT NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
  start_sec REAL NOT NULL,
  end_sec REAL NOT NULL,
  avg_confidence REAL NOT NULL,
  min_confidence REAL NOT NULL,
  needs_review INTEGER NOT NULL DEFAULT 0 CHECK (needs_review IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_temporal_intervals_project ON temporal_appearance_intervals(project_id, media_asset_id);

CREATE TABLE IF NOT EXISTS parsed_generation_instructions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  raw_prompt TEXT NOT NULL,
  human_summary_json TEXT NOT NULL DEFAULT '[]',
  contradictions_json TEXT NOT NULL DEFAULT '[]',
  clarification_needed INTEGER NOT NULL DEFAULT 0 CHECK (clarification_needed IN (0, 1)),
  clarification_question TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS parsed_constraints (
  id TEXT PRIMARY KEY,
  instruction_id TEXT NOT NULL REFERENCES parsed_generation_instructions(id) ON DELETE CASCADE,
  constraint_key TEXT NOT NULL,
  constraint_type TEXT NOT NULL,
  target TEXT NOT NULL,
  reference_asset_ids_json TEXT NOT NULL DEFAULT '[]',
  operator TEXT NOT NULL CHECK (operator IN ('AND', 'OR', 'NOT', 'BEFORE', 'AFTER', 'ONLY', 'PREFER', 'EQUALS', 'MAX', 'MIN')),
  priority INTEGER NOT NULL DEFAULT 50,
  enforcement TEXT NOT NULL CHECK (enforcement IN ('hard', 'soft')),
  confidence REAL NOT NULL DEFAULT 0.9,
  explanation TEXT NOT NULL,
  validation_method TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS constraint_validations (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  artifact_id TEXT REFERENCES rendered_artifacts(id) ON DELETE CASCADE,
  constraint_id TEXT REFERENCES parsed_constraints(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('met', 'needs_review', 'not_satisfied')),
  evidence TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 1.0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS generation_revisions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  from_version INTEGER NOT NULL,
  to_version INTEGER NOT NULL,
  copilot_prompt TEXT NOT NULL,
  operations_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
