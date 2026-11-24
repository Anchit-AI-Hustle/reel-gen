-- Reel Gen V2 — Migration 001: Core Studio, Neon Persistence, Auth & Cloud Sources
-- PostgreSQL (Neon Free Tier). Zero Supabase dependencies.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  csrf_token TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  brand_kit JSONB NOT NULL DEFAULT '{}'::jsonb,
  output_defaults JSONB NOT NULL DEFAULT '{"durationSec":30,"aspectRatio":"9:16","resolution":"1080p","mode":"autopilot"}'::jsonb,
  retention_days INTEGER NOT NULL DEFAULT 30,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS workspace_members (
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'editor', 'viewer')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (workspace_id, user_id)
);

CREATE TABLE IF NOT EXISTS source_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('google_drive', 'onedrive', 'sharepoint', 'dropbox', 'box', 's3', 's3_compatible')),
  account_email TEXT,
  account_label TEXT,
  status TEXT NOT NULL CHECK (status IN ('connected', 'disconnected', 'needs_authorization', 'expired', 'permission_denied', 'syncing', 'failed')),
  encrypted_access_token TEXT,
  encrypted_refresh_token TEXT,
  token_expires_at TIMESTAMPTZ,
  scopes TEXT[] NOT NULL DEFAULT '{}',
  last_synced_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_source_connections_workspace ON source_connections(workspace_id);

CREATE TABLE IF NOT EXISTS source_folders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  connection_id UUID REFERENCES source_connections(id) ON DELETE SET NULL,
  provider TEXT NOT NULL,
  source_url TEXT NOT NULL,
  external_folder_id TEXT,
  folder_path TEXT,
  access_status TEXT NOT NULL DEFAULT 'pending_auth',
  item_count INTEGER NOT NULL DEFAULT 0,
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS shoots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  client_name TEXT,
  event_type TEXT,
  location TEXT,
  shoot_date DATE,
  cameras TEXT[] NOT NULL DEFAULT '{}',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_shoots_workspace ON shoots(workspace_id);

CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  brief TEXT NOT NULL DEFAULT '',
  target_duration_sec INTEGER NOT NULL DEFAULT 30,
  aspect_ratio TEXT NOT NULL DEFAULT '9:16' CHECK (aspect_ratio IN ('9:16', '16:9', '1:1')),
  mode TEXT NOT NULL DEFAULT 'autopilot' CHECK (mode IN ('autopilot', 'copilot', 'manual')),
  style TEXT NOT NULL DEFAULT 'smart',
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_projects_workspace ON projects(workspace_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS project_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  label TEXT NOT NULL,
  edl JSONB NOT NULL,
  created_by_prompt TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, version_number)
);

CREATE TABLE IF NOT EXISTS media_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  shoot_id UUID REFERENCES shoots(id) ON DELETE SET NULL,
  source_folder_id UUID REFERENCES source_folders(id) ON DELETE SET NULL,
  file_name TEXT NOT NULL,
  relative_path TEXT,
  mime_type TEXT NOT NULL,
  detected_kind TEXT NOT NULL CHECK (detected_kind IN ('video', 'image', 'audio', 'document', 'archive', 'unknown')),
  decodable BOOLEAN NOT NULL DEFAULT FALSE,
  size_bytes BIGINT NOT NULL DEFAULT 0,
  sha256_hash TEXT NOT NULL,
  storage_uri TEXT NOT NULL,
  proxy_uri TEXT,
  thumbnail_uri TEXT,
  source_provider TEXT NOT NULL DEFAULT 'local_upload',
  external_file_id TEXT,
  capture_timestamp TIMESTAMPTZ,
  camera_label TEXT,
  location_label TEXT,
  availability_status TEXT NOT NULL DEFAULT 'ready',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_media_assets_workspace ON media_assets(workspace_id);
CREATE INDEX IF NOT EXISTS idx_media_assets_project ON media_assets(project_id);
CREATE INDEX IF NOT EXISTS idx_media_assets_sha256 ON media_assets(workspace_id, sha256_hash);

CREATE TABLE IF NOT EXISTS media_metadata (
  asset_id UUID PRIMARY KEY REFERENCES media_assets(id) ON DELETE CASCADE,
  duration_sec DOUBLE PRECISION,
  width INTEGER,
  height INTEGER,
  fps DOUBLE PRECISION,
  video_codec TEXT,
  audio_codec TEXT,
  has_audio BOOLEAN NOT NULL DEFAULT FALSE,
  orientation INTEGER DEFAULT 0,
  bitrate BIGINT,
  sharpness_score DOUBLE PRECISION,
  exposure_score DOUBLE PRECISION,
  motion_score DOUBLE PRECISION,
  audio_lufs DOUBLE PRECISION,
  raw_probe JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS media_segments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id UUID NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  start_sec DOUBLE PRECISION NOT NULL,
  end_sec DOUBLE PRECISION NOT NULL,
  shot_type TEXT,
  motion_energy DOUBLE PRECISION NOT NULL DEFAULT 0,
  visual_quality DOUBLE PRECISION NOT NULL DEFAULT 0,
  emotional_impact DOUBLE PRECISION NOT NULL DEFAULT 0,
  audio_quality DOUBLE PRECISION NOT NULL DEFAULT 0,
  is_blurry BOOLEAN NOT NULL DEFAULT FALSE,
  is_duplicate BOOLEAN NOT NULL DEFAULT FALSE,
  tags TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_media_segments_asset ON media_segments(asset_id);

CREATE TABLE IF NOT EXISTS transcripts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id UUID NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  language TEXT NOT NULL DEFAULT 'en',
  full_text TEXT NOT NULL DEFAULT '',
  words JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS embeddings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id UUID NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
  segment_id UUID REFERENCES media_segments(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  model_name TEXT NOT NULL,
  vector_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS highlight_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  segment_id UUID NOT NULL REFERENCES media_segments(id) ON DELETE CASCADE,
  brief_relevance DOUBLE PRECISION NOT NULL,
  visual_quality DOUBLE PRECISION NOT NULL,
  emotional_action DOUBLE PRECISION NOT NULL,
  narrative_contribution DOUBLE PRECISION NOT NULL,
  diversity DOUBLE PRECISION NOT NULL,
  audio_compatibility DOUBLE PRECISION NOT NULL,
  total_score DOUBLE PRECISION NOT NULL,
  passed_hard_constraints BOOLEAN NOT NULL DEFAULT TRUE,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS story_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  arc_beats JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS timelines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  version INTEGER NOT NULL DEFAULT 1,
  edl JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_timelines_project ON timelines(project_id, version DESC);

CREATE TABLE IF NOT EXISTS processing_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  job_type TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN (
    'CREATED', 'VALIDATING_SOURCES', 'WAITING_FOR_AUTH', 'INDEXING',
    'ANALYZING', 'SELECTING_HIGHLIGHTS', 'PLANNING', 'EDITING',
    'RENDERING', 'VALIDATING_OUTPUT', 'COMPLETED', 'RETRYING',
    'PAUSED', 'CANCELLED', 'FAILED'
  )),
  progress_pct INTEGER NOT NULL DEFAULT 0 CHECK (progress_pct >= 0 AND progress_pct <= 100),
  stage_detail TEXT,
  error_message TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_processing_jobs_project ON processing_jobs(project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS render_artifacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  job_id UUID REFERENCES processing_jobs(id) ON DELETE SET NULL,
  format TEXT NOT NULL DEFAULT 'mp4',
  video_codec TEXT NOT NULL DEFAULT 'h264',
  audio_codec TEXT NOT NULL DEFAULT 'aac',
  resolution TEXT NOT NULL,
  aspect_ratio TEXT NOT NULL,
  duration_sec DOUBLE PRECISION NOT NULL,
  size_bytes BIGINT NOT NULL,
  storage_uri TEXT NOT NULL,
  qa_passed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS quality_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  artifact_id UUID NOT NULL REFERENCES render_artifacts(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  passed BOOLEAN NOT NULL,
  checks JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS activity_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  detail TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_activity_events_workspace ON activity_events(workspace_id, created_at DESC);

CREATE TABLE IF NOT EXISTS processing_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  usage_date DATE NOT NULL DEFAULT CURRENT_DATE,
  render_seconds INTEGER NOT NULL DEFAULT 0,
  storage_bytes BIGINT NOT NULL DEFAULT 0,
  jobs_count INTEGER NOT NULL DEFAULT 0,
  estimated_cost_usd NUMERIC(10, 4) NOT NULL DEFAULT 0.0000,
  UNIQUE (workspace_id, usage_date)
);
