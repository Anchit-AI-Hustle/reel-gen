import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Pool } from 'pg';
import type {
  ActivityEventRecord,
  MediaAssetRecord,
  ProcessingJobRecord,
  ProjectRecord,
  RenderArtifactRecord,
} from '@/types/reel-gen';

export interface WorkspaceStoreState {
  workspaceId: string;
  projects: ProjectRecord[];
  media: MediaAssetRecord[];
  jobs: ProcessingJobRecord[];
  artifacts: RenderArtifactRecord[];
  activity: ActivityEventRecord[];
  settings: {
    workspaceName: string;
    defaultDurationSec: number;
    defaultAspectRatio: '9:16' | '16:9' | '1:1';
    defaultResolution: '720p' | '1080p';
    biometricRetentionHours: number;
    brandText: string;
  };
}

export function validateNeonConnectionUrl(urlString: string): { valid: boolean; reason?: string } {
  try {
    const parsed = new URL(urlString);
    if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
      return { valid: false, reason: 'DATABASE_URL must use postgres:// or postgresql://' };
    }
    if (parsed.hostname.toLowerCase().includes('supabase')) {
      return { valid: false, reason: 'Supabase database URLs are strictly prohibited. Use Neon PostgreSQL only.' };
    }
    if (!parsed.hostname.toLowerCase().includes('neon.tech')) {
      return { valid: false, reason: 'DATABASE_URL must point to a Neon PostgreSQL host (*.neon.tech).' };
    }
    const sslMode = parsed.searchParams.get('sslmode');
    if (sslMode !== 'require' && sslMode !== 'verify-full') {
      return { valid: false, reason: 'Neon DATABASE_URL must include sslmode=require or sslmode=verify-full.' };
    }
    return { valid: true };
  } catch {
    return { valid: false, reason: 'Malformed DATABASE_URL' };
  }
}

export function getDatabaseStatus(): {
  mode: 'neon_connected' | 'local_durable_fallback';
  configured: boolean;
  provider: 'Neon PostgreSQL';
  detail: string;
} {
  const url = process.env.DATABASE_URL;
  if (!url) {
    return {
      mode: 'local_durable_fallback',
      configured: false,
      provider: 'Neon PostgreSQL',
      detail: 'DATABASE_URL is not configured yet. Using durable local filesystem storage until Neon Free PostgreSQL is connected.',
    };
  }
  const check = validateNeonConnectionUrl(url);
  if (!check.valid) {
    return {
      mode: 'local_durable_fallback',
      configured: false,
      provider: 'Neon PostgreSQL',
      detail: check.reason || 'Invalid Neon DATABASE_URL',
    };
  }
  return {
    mode: 'neon_connected',
    configured: true,
    provider: 'Neon PostgreSQL',
    detail: 'Connected to Neon PostgreSQL with TLS.',
  };
}

export function getDataDir(): string {
  const base = process.env.REEL_GEN_DATA_DIR || path.join(process.cwd(), '.reel-gen-data');
  fs.mkdirSync(base, { recursive: true });
  fs.mkdirSync(path.join(base, 'uploads'), { recursive: true });
  fs.mkdirSync(path.join(base, 'references'), { recursive: true });
  fs.mkdirSync(path.join(base, 'renders'), { recursive: true });
  fs.mkdirSync(path.join(base, 'thumbnails'), { recursive: true });
  return base;
}

function getStateFilePath(workspaceId: string): string {
  const safeId = workspaceId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(getDataDir(), `workspace_${safeId}.json`);
}

function createInitialState(workspaceId: string): WorkspaceStoreState {
  return {
    workspaceId,
    projects: [],
    media: [],
    jobs: [],
    artifacts: [],
    activity: [],
    settings: {
      workspaceName: 'Default Studio Workspace',
      defaultDurationSec: 30,
      defaultAspectRatio: '9:16',
      defaultResolution: '1080p',
      biometricRetentionHours: 24,
      brandText: 'Reel Gen Studio',
    },
  };
}

export function readWorkspaceState(workspaceId = 'default-workspace'): WorkspaceStoreState {
  const filePath = getStateFilePath(workspaceId);
  if (!fs.existsSync(filePath)) {
    const initial = createInitialState(workspaceId);
    writeWorkspaceState(initial);
    return initial;
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw) as WorkspaceStoreState;
  } catch {
    const initial = createInitialState(workspaceId);
    writeWorkspaceState(initial);
    return initial;
  }
}

export function writeWorkspaceState(state: WorkspaceStoreState): void {
  const filePath = getStateFilePath(state.workspaceId);
  const tmpPath = `${filePath}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2), 'utf8');
  fs.renameSync(tmpPath, filePath);
}

export function appendActivity(
  state: WorkspaceStoreState,
  action: string,
  detail: string,
  projectId: string | null = null
): ActivityEventRecord {
  const event: ActivityEventRecord = {
    id: crypto.randomUUID(),
    workspaceId: state.workspaceId,
    projectId,
    action,
    detail,
    createdAt: new Date().toISOString(),
  };
  state.activity.unshift(event);
  if (state.activity.length > 200) {
    state.activity = state.activity.slice(0, 200);
  }
  return event;
}

/**
 * Parameterized Neon PostgreSQL repository helper (used when DATABASE_URL is configured and in unit tests).
 */
export interface QueryExecutor {
  query: <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }>;
}

export class NeonRepository {
  private readonly executor: QueryExecutor;

  constructor(executor: QueryExecutor) {
    this.executor = executor;
  }

  static fromEnv(): NeonRepository | null {
    const url = process.env.DATABASE_URL;
    if (!url || !validateNeonConnectionUrl(url).valid) return null;
    const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false }, max: 5 });
    return new NeonRepository(pool);
  }

  async listProjectsByWorkspace(workspaceId: string) {
    const res = await this.executor.query(
      'SELECT id, workspace_id, title, status, brief, target_duration_sec, aspect_ratio, mode, style, created_at, updated_at FROM projects WHERE workspace_id = $1 ORDER BY updated_at DESC',
      [workspaceId]
    );
    return res.rows;
  }

  async saveTimelineVersion(params: {
    projectId: string;
    workspaceId: string;
    versionNumber: number;
    label: string;
    edl: unknown;
    prompt: string | null;
  }) {
    const res = await this.executor.query(
      `INSERT INTO project_versions (project_id, workspace_id, version_number, label, edl, created_by_prompt)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6)
       RETURNING id, project_id, version_number, label, created_at`,
      [
        params.projectId,
        params.workspaceId,
        params.versionNumber,
        params.label,
        JSON.stringify(params.edl),
        params.prompt,
      ]
    );
    return res.rows[0];
  }

  async recordConsent(params: {
    workspaceId: string;
    projectId: string;
    consentType: 'reference_person_matching' | 'source_footage_processing';
    granted: boolean;
    statement: string;
  }) {
    const res = await this.executor.query(
      `INSERT INTO user_consent_records (workspace_id, project_id, consent_type, granted, statement)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, granted_at`,
      [params.workspaceId, params.projectId, params.consentType, params.granted, params.statement]
    );
    return res.rows[0];
  }
}
