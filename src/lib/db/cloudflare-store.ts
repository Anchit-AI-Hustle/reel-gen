import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type {
  ActivityEventRecord,
  MediaAssetRecord,
  ProcessingJobRecord,
  ProjectRecord,
  RenderArtifactRecord,
} from '@/types/reel-gen';
import { createWorkspaceClaimSignature } from '@/cloudflare/auth';

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

export interface CloudflareStatusInfo {
  mode: 'cloudflare_d1_r2_connected' | 'local_durable_fallback';
  configured: boolean;
  provider: 'Cloudflare D1 + Workers + R2';
  workerApiUrl: string | null;
  d1DatabaseName: string;
  r2BucketName: string;
  detail: string;
}

export function validateCloudflareWorkerUrl(urlString: string): { valid: boolean; reason?: string } {
  try {
    const parsed = new URL(urlString);
    if (parsed.protocol !== 'https:') {
      return { valid: false, reason: 'CLOUDFLARE_DB_API_URL must use HTTPS.' };
    }
    const host = parsed.hostname.toLowerCase();
    const allowed = host.endsWith('.workers.dev') || host.includes('reel-gen');
    if (!allowed) {
      return {
        valid: false,
        reason: 'CLOUDFLARE_DB_API_URL must point to your Cloudflare Worker endpoint.',
      };
    }
    return { valid: true };
  } catch {
    return { valid: false, reason: 'Malformed CLOUDFLARE_DB_API_URL.' };
  }
}

export function getDatabaseStatus(): CloudflareStatusInfo {
  const apiUrl = process.env.CLOUDFLARE_DB_API_URL || '';
  const apiToken = process.env.CLOUDFLARE_DB_API_TOKEN || '';
  const r2Bucket = process.env.CLOUDFLARE_R2_BUCKET || 'reel-gen-media';

  if (!apiUrl || !apiToken) {
    return {
      mode: 'local_durable_fallback',
      configured: false,
      provider: 'Cloudflare D1 + Workers + R2',
      workerApiUrl: null,
      d1DatabaseName: 'reel-gen-db',
      r2BucketName: r2Bucket,
      detail:
        'Cloudflare Worker API (CLOUDFLARE_DB_API_URL / CLOUDFLARE_DB_API_TOKEN) is not configured yet. Using durable local storage until Cloudflare D1 and R2 are provisioned.',
    };
  }

  const check = validateCloudflareWorkerUrl(apiUrl);
  if (!check.valid) {
    return {
      mode: 'local_durable_fallback',
      configured: false,
      provider: 'Cloudflare D1 + Workers + R2',
      workerApiUrl: null,
      d1DatabaseName: 'reel-gen-db',
      r2BucketName: r2Bucket,
      detail: check.reason || 'Invalid CLOUDFLARE_DB_API_URL.',
    };
  }

  return {
    mode: 'cloudflare_d1_r2_connected',
    configured: true,
    provider: 'Cloudflare D1 + Workers + R2',
    workerApiUrl: apiUrl,
    d1DatabaseName: 'reel-gen-db',
    r2BucketName: r2Bucket,
    detail: `Connected to Cloudflare Worker API (${apiUrl}) with D1 (reel-gen-db) and R2 (${r2Bucket}).`,
  };
}

export async function callCloudflareWorker(params: {
  path: string;
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  workspaceId: string;
  actorId?: string;
  body?: unknown;
}): Promise<Response | null> {
  const status = getDatabaseStatus();
  if (!status.configured || !status.workerApiUrl) return null;

  const token = process.env.CLOUDFLARE_DB_API_TOKEN!;
  const secret = process.env.AUTH_SECRET || token;
  const actorId = params.actorId || 'studio-owner';
  const ts = Date.now();
  const sig = await createWorkspaceClaimSignature({
    secret,
    workspaceId: params.workspaceId,
    actorId,
    timestampMs: ts,
  });

  const targetUrl = `${status.workerApiUrl.replace(/\/+$/, '')}${params.path}`;
  return fetch(targetUrl, {
    method: params.method || 'GET',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'x-reelgen-workspace': params.workspaceId,
      'x-reelgen-actor': actorId,
      'x-reelgen-ts': String(ts),
      'x-reelgen-sig': sig,
    },
    body: params.body !== undefined ? JSON.stringify(params.body) : undefined,
  });
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
