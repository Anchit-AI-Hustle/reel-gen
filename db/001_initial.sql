-- Reel Gen core schema: Neon Postgres. No Supabase-specific dependencies.
-- Run using psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/001_initial.sql
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE IF NOT EXISTS users (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),email text NOT NULL UNIQUE,
 password_hash text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS workspaces (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 name text NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS workspace_members (
 workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 role text NOT NULL CHECK(role IN ('owner','editor','viewer')),
 PRIMARY KEY(workspace_id,user_id)
);
CREATE TABLE IF NOT EXISTS sessions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 token_hash text NOT NULL UNIQUE, expires_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS projects (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 title text NOT NULL,brief text NOT NULL DEFAULT '',status text NOT NULL DEFAULT 'created',
 settings jsonb NOT NULL DEFAULT '{}'::jsonb,created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS projects_workspace_date ON projects(workspace_id,created_at DESC);
CREATE TABLE IF NOT EXISTS source_connections (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 provider text NOT NULL, account_label text NOT NULL DEFAULT '',
 credentials_ciphertext text, key_version integer,token_expires_at timestamptz,
 status text NOT NULL DEFAULT 'disconnected', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS source_folders (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 connection_id uuid REFERENCES source_connections(id) ON DELETE SET NULL,provider text NOT NULL,
 provider_folder_id text NOT NULL,url text NOT NULL, sync_cursor text,
 status text NOT NULL DEFAULT 'pending',last_synced_at timestamptz,
 UNIQUE(project_id,provider,provider_folder_id)
);
CREATE TABLE IF NOT EXISTS shoots (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 name text NOT NULL, shoot_date date,location text,metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE TABLE IF NOT EXISTS media_assets (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 folder_id uuid REFERENCES source_folders(id) ON DELETE SET NULL,source_provider text NOT NULL,
 source_file_id text NOT NULL,name text NOT NULL,mime_type text,kind text NOT NULL,
 size_bytes bigint CHECK(size_bytes>=0),source_path text,sha256 text,
 duration_seconds numeric(12,3),metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
 processing_status text NOT NULL DEFAULT 'queued',created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(project_id,source_provider,source_file_id)
);
CREATE INDEX IF NOT EXISTS media_project_idx ON media_assets(project_id,created_at DESC);
CREATE TABLE IF NOT EXISTS media_segments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),asset_id uuid NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
 start_seconds numeric(12,3) NOT NULL,end_seconds numeric(12,3) NOT NULL,
 description text NOT NULL DEFAULT '',scores jsonb NOT NULL DEFAULT '{}'::jsonb,
 embedding jsonb,
 CHECK(start_seconds>=0 AND end_seconds>start_seconds)
);
-- Embeddings can be stored as JSONB for portability; add pgvector later if available.
CREATE TABLE IF NOT EXISTS timelines (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 version integer NOT NULL,edl jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(project_id,version)
);
CREATE TABLE IF NOT EXISTS processing_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 stage text NOT NULL,state text NOT NULL DEFAULT 'queued',attempts integer NOT NULL DEFAULT 0,
 progress numeric(5,2) NOT NULL DEFAULT 0,checkpoint jsonb NOT NULL DEFAULT '{}'::jsonb,
 error_code text,error_message text,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS processing_jobs_project ON processing_jobs(project_id,created_at DESC);
CREATE TABLE IF NOT EXISTS render_artifacts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),job_id uuid NOT NULL REFERENCES processing_jobs(id) ON DELETE CASCADE,
 storage_key text NOT NULL,format text NOT NULL,duration_seconds numeric(12,3),
 validation jsonb NOT NULL DEFAULT '{}'::jsonb,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS activity_events (
 id bigserial PRIMARY KEY,workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 project_id uuid REFERENCES projects(id) ON DELETE SET NULL,actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
 event_type text NOT NULL,details jsonb NOT NULL DEFAULT '{}'::jsonb,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS activity_workspace_date ON activity_events(workspace_id,created_at DESC);
COMMIT;
