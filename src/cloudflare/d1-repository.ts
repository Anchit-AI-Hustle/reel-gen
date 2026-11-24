// Cloudflare D1 (SQLite) Typed Repository — Prepared Statements & Strict Workspace Isolation

export interface D1PreparedStatementLike {
  bind: (...values: unknown[]) => D1PreparedStatementLike;
  all: <T = Record<string, unknown>>() => Promise<{ results: T[] }>;
  first: <T = Record<string, unknown>>() => Promise<T | null>;
  run: () => Promise<{ success: boolean; meta?: { changes?: number } }>;
}

export interface D1DatabaseLike {
  prepare: (sql: string) => D1PreparedStatementLike;
}

export class D1Repository {
  private readonly db: D1DatabaseLike;

  constructor(db: D1DatabaseLike) {
    this.db = db;
  }

  async ensureWorkspace(params: { workspaceId: string; ownerUserId: string; email: string; name?: string }) {
    await this.db
      .prepare(
        `INSERT OR IGNORE INTO users (id, email, name, password_hash, email_verified)
         VALUES (?, ?, ?, 'managed_session', 1)`
      )
      .bind(params.ownerUserId, params.email, params.name || 'Studio Owner')
      .run();

    await this.db
      .prepare(
        `INSERT OR IGNORE INTO workspaces (id, name, slug, owner_user_id)
         VALUES (?, ?, ?, ?)`
      )
      .bind(params.workspaceId, params.name || 'Default Studio Workspace', params.workspaceId, params.ownerUserId)
      .run();

    await this.db
      .prepare(
        `INSERT OR IGNORE INTO workspace_members (workspace_id, user_id, role)
         VALUES (?, ?, 'owner')`
      )
      .bind(params.workspaceId, params.ownerUserId)
      .run();
  }

  async listProjects(workspaceId: string) {
    const res = await this.db
      .prepare(
        `SELECT id, workspace_id, title, status, brief, target_duration_sec, aspect_ratio, mode, style, settings_json, active_version, created_at, updated_at
         FROM projects
         WHERE workspace_id = ?
         ORDER BY updated_at DESC`
      )
      .bind(workspaceId)
      .all();
    return res.results;
  }

  async getProjectById(workspaceId: string, projectId: string) {
    return this.db
      .prepare(
        `SELECT id, workspace_id, title, status, brief, target_duration_sec, aspect_ratio, mode, style, settings_json, active_version, created_at, updated_at
         FROM projects
         WHERE workspace_id = ? AND id = ?`
      )
      .bind(workspaceId, projectId)
      .first();
  }

  async createProject(params: {
    id: string;
    workspaceId: string;
    title: string;
    status: string;
    brief: string;
    targetDurationSec: number;
    aspectRatio: string;
    mode: string;
    style: string;
    settings: unknown;
    createdBy?: string | null;
  }) {
    const now = new Date().toISOString();
    await this.db
      .prepare(
        `INSERT INTO projects (id, workspace_id, title, status, brief, target_duration_sec, aspect_ratio, mode, style, settings_json, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        params.id,
        params.workspaceId,
        params.title,
        params.status,
        params.brief,
        params.targetDurationSec,
        params.aspectRatio,
        params.mode,
        params.style,
        JSON.stringify(params.settings ?? {}),
        params.createdBy ?? null,
        now,
        now
      )
      .run();
    return this.getProjectById(params.workspaceId, params.id);
  }

  async saveTimelineVersion(params: {
    id: string;
    projectId: string;
    workspaceId: string;
    versionNumber: number;
    label: string;
    edl: unknown;
    prompt: string | null;
  }) {
    const now = new Date().toISOString();
    const edlJson = JSON.stringify(params.edl);
    await this.db
      .prepare(
        `INSERT INTO timeline_versions (id, project_id, workspace_id, version_number, label, edl_json, created_by_prompt, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        params.id,
        params.projectId,
        params.workspaceId,
        params.versionNumber,
        params.label,
        edlJson,
        params.prompt,
        now
      )
      .run();

    await this.db
      .prepare(`UPDATE projects SET active_version = ?, updated_at = ? WHERE id = ? AND workspace_id = ?`)
      .bind(params.versionNumber, now, params.projectId, params.workspaceId)
      .run();

    return { id: params.id, projectId: params.projectId, versionNumber: params.versionNumber, label: params.label };
  }

  async listTimelineVersions(workspaceId: string, projectId: string) {
    const res = await this.db
      .prepare(
        `SELECT id, project_id, version_number, label, edl_json, created_by_prompt, created_at
         FROM timeline_versions
         WHERE workspace_id = ? AND project_id = ?
         ORDER BY version_number DESC`
      )
      .bind(workspaceId, projectId)
      .all();
    return res.results;
  }

  async insertMediaAsset(params: {
    id: string;
    workspaceId: string;
    projectId: string | null;
    fileName: string;
    relativePath: string;
    mimeType: string;
    detectedKind: string;
    decodable: boolean;
    sizeBytes: number;
    sha256Hash: string;
    r2ObjectKey: string;
    probe: unknown;
  }) {
    await this.db
      .prepare(
        `INSERT INTO media_assets (
           id, workspace_id, project_id, file_name, relative_path, mime_type,
           detected_kind, decodable, size_bytes, sha256_hash, r2_object_key, probe_json
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        params.id,
        params.workspaceId,
        params.projectId,
        params.fileName,
        params.relativePath,
        params.mimeType,
        params.detectedKind,
        params.decodable ? 1 : 0,
        params.sizeBytes,
        params.sha256Hash,
        params.r2ObjectKey,
        JSON.stringify(params.probe ?? {})
      )
      .run();
  }

  async listMediaAssets(workspaceId: string) {
    const res = await this.db
      .prepare(
        `SELECT id, workspace_id, project_id, file_name, relative_path, mime_type, detected_kind, decodable, size_bytes, sha256_hash, r2_object_key, availability_status, probe_json, created_at
         FROM media_assets
         WHERE workspace_id = ?
         ORDER BY created_at DESC`
      )
      .bind(workspaceId)
      .all();
    return res.results;
  }

  async recordConsent(params: {
    id: string;
    workspaceId: string;
    projectId: string;
    consentType: 'reference_person_matching' | 'source_footage_processing';
    granted: boolean;
    statement: string;
  }) {
    await this.db
      .prepare(
        `INSERT INTO consent_records (id, workspace_id, project_id, consent_type, granted, statement)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .bind(params.id, params.workspaceId, params.projectId, params.consentType, params.granted ? 1 : 0, params.statement)
      .run();
  }

  async purgeEphemeralReferenceDescriptors(workspaceId: string): Promise<number> {
    const res = await this.db
      .prepare(
        `UPDATE reference_images
         SET ephemeral_descriptor_enc = NULL
         WHERE workspace_id = ? AND ephemeral_descriptor_enc IS NOT NULL`
      )
      .bind(workspaceId)
      .run();
    return res.meta?.changes ?? 0;
  }

  async recordActivity(params: {
    id: string;
    workspaceId: string;
    projectId?: string | null;
    action: string;
    detail: string;
  }) {
    await this.db
      .prepare(
        `INSERT INTO activity_events (id, workspace_id, project_id, action, detail)
         VALUES (?, ?, ?, ?, ?)`
      )
      .bind(params.id, params.workspaceId, params.projectId ?? null, params.action, params.detail)
      .run();
  }

  async listActivity(workspaceId: string, limit = 50) {
    const res = await this.db
      .prepare(
        `SELECT id, workspace_id, project_id, action, detail, created_at
         FROM activity_events
         WHERE workspace_id = ?
         ORDER BY created_at DESC
         LIMIT ?`
      )
      .bind(workspaceId, limit)
      .all();
    return res.results;
  }

  async recordAudit(params: {
    id: string;
    workspaceId: string;
    actorId: string;
    eventType: string;
    resourceType: string;
    resourceId?: string | null;
    outcome: 'allowed' | 'denied' | 'error';
    detail?: string;
  }) {
    await this.db
      .prepare(
        `INSERT INTO audit_logs (id, workspace_id, actor_id, event_type, resource_type, resource_id, outcome, detail)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        params.id,
        params.workspaceId,
        params.actorId,
        params.eventType,
        params.resourceType,
        params.resourceId ?? null,
        params.outcome,
        params.detail ?? null
      )
      .run();
  }
}
