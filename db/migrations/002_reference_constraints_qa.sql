-- Reel Gen V2 — Migration 002: Reference-Image-Guided Editing, Constraints, Consent & QA Evidence
-- PostgreSQL (Neon Free Tier). Strictly project-scoped biometric representations; zero global identity DB.

CREATE TABLE IF NOT EXISTS reference_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  storage_uri TEXT NOT NULL,
  sha256_hash TEXT NOT NULL,
  quality_score DOUBLE PRECISION NOT NULL DEFAULT 0,
  face_count INTEGER NOT NULL DEFAULT 0,
  usable BOOLEAN NOT NULL DEFAULT TRUE,
  quality_notes TEXT,
  ephemeral_descriptor_enc TEXT,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_reference_assets_project ON reference_assets(project_id);

CREATE TABLE IF NOT EXISTS reference_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_asset_id UUID NOT NULL REFERENCES reference_assets(id) ON DELETE CASCADE,
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
  inferred BOOLEAN NOT NULL DEFAULT FALSE,
  enforcement TEXT NOT NULL DEFAULT 'soft' CHECK (enforcement IN ('hard', 'soft')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_consent_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  consent_type TEXT NOT NULL CHECK (consent_type IN ('reference_person_matching', 'source_footage_processing')),
  granted BOOLEAN NOT NULL,
  statement TEXT NOT NULL,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS visual_match_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  reference_asset_id UUID NOT NULL REFERENCES reference_assets(id) ON DELETE CASCADE,
  media_asset_id UUID NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
  timestamp_sec DOUBLE PRECISION NOT NULL,
  confidence DOUBLE PRECISION NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  confidence_band TEXT NOT NULL CHECK (confidence_band IN ('high', 'medium', 'uncertain', 'none')),
  bbox JSONB,
  manual_override TEXT CHECK (manual_override IN ('confirmed', 'rejected', NULL)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_visual_match_project ON visual_match_candidates(project_id, reference_asset_id);

CREATE TABLE IF NOT EXISTS temporal_appearance_intervals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  reference_asset_id UUID NOT NULL REFERENCES reference_assets(id) ON DELETE CASCADE,
  media_asset_id UUID NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
  start_sec DOUBLE PRECISION NOT NULL,
  end_sec DOUBLE PRECISION NOT NULL,
  avg_confidence DOUBLE PRECISION NOT NULL,
  min_confidence DOUBLE PRECISION NOT NULL,
  needs_review BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS generation_instructions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  raw_prompt TEXT NOT NULL,
  human_summary JSONB NOT NULL DEFAULT '[]'::jsonb,
  contradictions JSONB NOT NULL DEFAULT '[]'::jsonb,
  clarification_needed BOOLEAN NOT NULL DEFAULT FALSE,
  clarification_question TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS parsed_constraints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instruction_id UUID NOT NULL REFERENCES generation_instructions(id) ON DELETE CASCADE,
  constraint_key TEXT NOT NULL,
  constraint_type TEXT NOT NULL,
  target TEXT NOT NULL,
  reference_asset_ids UUID[] NOT NULL DEFAULT '{}',
  operator TEXT NOT NULL CHECK (operator IN ('AND', 'OR', 'NOT', 'BEFORE', 'AFTER', 'ONLY', 'PREFER', 'EQUALS', 'MAX', 'MIN')),
  priority INTEGER NOT NULL DEFAULT 50,
  enforcement TEXT NOT NULL CHECK (enforcement IN ('hard', 'soft')),
  confidence DOUBLE PRECISION NOT NULL DEFAULT 0.9,
  explanation TEXT NOT NULL,
  validation_method TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS constraint_validations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  artifact_id UUID REFERENCES render_artifacts(id) ON DELETE CASCADE,
  constraint_id UUID REFERENCES parsed_constraints(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('met', 'needs_review', 'not_satisfied')),
  evidence TEXT NOT NULL,
  confidence DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS generation_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  from_version INTEGER NOT NULL,
  to_version INTEGER NOT NULL,
  copilot_prompt TEXT NOT NULL,
  operations JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS final_qa_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  artifact_id UUID NOT NULL REFERENCES render_artifacts(id) ON DELETE CASCADE,
  requirements_met JSONB NOT NULL DEFAULT '[]'::jsonb,
  needs_review JSONB NOT NULL DEFAULT '[]'::jsonb,
  could_not_be_satisfied JSONB NOT NULL DEFAULT '[]'::jsonb,
  ffprobe_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
