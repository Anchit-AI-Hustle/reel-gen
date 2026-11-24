// Cloudflare Worker API Entrypoint (`reel-gen-api`)
// Connects Vercel server-side routes securely to Cloudflare D1 (DB binding) and Cloudflare R2 (MEDIA_BUCKET binding).

import { verifyWorkerRequestAuth } from './auth.ts';
import { D1Repository, type D1DatabaseLike } from './d1-repository.ts';
import { R2MediaStorage, buildTenantR2Key, type R2BucketLike, type StorageBucketCategory } from './storage.ts';

export interface WorkerEnv {
  DB: D1DatabaseLike;
  MEDIA_BUCKET: R2BucketLike;
  APP_URL?: string;
  CLOUDFLARE_DB_API_TOKEN?: string;
  AUTH_SECRET?: string;
}

function jsonResponse(data: unknown, status = 200, appUrl = 'https://reel-gen.anchit-tandon.com'): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': appUrl,
      'access-control-allow-methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
      'access-control-allow-headers': 'authorization, content-type, x-reelgen-workspace, x-reelgen-actor, x-reelgen-ts, x-reelgen-sig',
      'x-content-type-options': 'nosniff',
    },
  });
}

export async function handleWorkerRequest(request: Request, env: WorkerEnv): Promise<Response> {
  const appUrl = env.APP_URL || 'https://reel-gen.anchit-tandon.com';
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'access-control-allow-origin': appUrl,
        'access-control-allow-methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
        'access-control-allow-headers': 'authorization, content-type, x-reelgen-workspace, x-reelgen-actor, x-reelgen-ts, x-reelgen-sig',
      },
    });
  }

  const url = new URL(request.url);
  if (url.pathname === '/health' && request.method === 'GET') {
    return jsonResponse(
      { ok: true, service: 'reel-gen-api', database: 'cloudflare-d1', storage: 'cloudflare-r2' },
      200,
      appUrl
    );
  }

  const auth = await verifyWorkerRequestAuth(request, env);
  if (!auth.ok) {
    return jsonResponse({ error: auth.error }, auth.status, appUrl);
  }

  const { workspaceId, actorId } = auth.identity;
  const repo = new D1Repository(env.DB);
  const storage = new R2MediaStorage(env.MEDIA_BUCKET);

  try {
    await repo.ensureWorkspace({
      workspaceId,
      ownerUserId: actorId,
      email: `${actorId}@reel-gen.local`,
    });

    if (url.pathname === '/v1/state' && request.method === 'GET') {
      const [projects, media, activity] = await Promise.all([
        repo.listProjects(workspaceId),
        repo.listMediaAssets(workspaceId),
        repo.listActivity(workspaceId, 50),
      ]);
      return jsonResponse({ workspaceId, projects, media, activity }, 200, appUrl);
    }

    if (url.pathname === '/v1/projects' && request.method === 'GET') {
      const projects = await repo.listProjects(workspaceId);
      return jsonResponse({ projects }, 200, appUrl);
    }

    if (url.pathname === '/v1/projects' && request.method === 'POST') {
      const body = (await request.json()) as Record<string, any>;
      const projectId = String(body.id || crypto.randomUUID());
      const project = await repo.createProject({
        id: projectId,
        workspaceId,
        title: String(body.title || 'Untitled Reel'),
        status: String(body.status || 'draft'),
        brief: String(body.brief || ''),
        targetDurationSec: Number(body.targetDurationSec || 30),
        aspectRatio: String(body.aspectRatio || '9:16'),
        mode: String(body.mode || 'autopilot'),
        style: String(body.style || 'smart'),
        settings: body.settings || {},
        createdBy: actorId,
      });
      await repo.recordActivity({
        id: crypto.randomUUID(),
        workspaceId,
        projectId,
        action: 'Project created',
        detail: String(body.title || 'Untitled Reel'),
      });
      return jsonResponse({ project }, 201, appUrl);
    }

    if (url.pathname === '/v1/media' && request.method === 'POST') {
      const body = (await request.json()) as Record<string, any>;
      const id = String(body.id || crypto.randomUUID());
      await repo.insertMediaAsset({
        id,
        workspaceId,
        projectId: body.projectId ? String(body.projectId) : null,
        fileName: String(body.fileName || 'unnamed'),
        relativePath: String(body.relativePath || body.fileName || 'unnamed'),
        mimeType: String(body.mimeType || 'application/octet-stream'),
        detectedKind: String(body.kind || 'unknown'),
        decodable: Boolean(body.decodable),
        sizeBytes: Number(body.sizeBytes || 0),
        sha256Hash: String(body.sha256 || ''),
        r2ObjectKey: String(body.r2ObjectKey || buildTenantR2Key({ workspaceId, category: 'uploads', fileName: String(body.fileName || id) })),
        probe: body.probe || {},
      });
      return jsonResponse({ ok: true, id }, 201, appUrl);
    }

    if (url.pathname === '/v1/consent' && request.method === 'POST') {
      const body = (await request.json()) as Record<string, any>;
      const id = crypto.randomUUID();
      await repo.recordConsent({
        id,
        workspaceId,
        projectId: String(body.projectId),
        consentType: body.consentType === 'source_footage_processing' ? 'source_footage_processing' : 'reference_person_matching',
        granted: Boolean(body.granted),
        statement: String(body.statement || 'User confirmed authorization to process reference images and footage.'),
      });
      return jsonResponse({ ok: true, id }, 201, appUrl);
    }

    const versionMatch = url.pathname.match(/^\/v1\/projects\/([^/]+)\/versions$/);
    if (versionMatch && request.method === 'POST') {
      const projectId = versionMatch[1];
      const body = (await request.json()) as Record<string, any>;
      const saved = await repo.saveTimelineVersion({
        id: crypto.randomUUID(),
        projectId,
        workspaceId,
        versionNumber: Number(body.versionNumber || 1),
        label: String(body.label || 'Timeline update'),
        edl: body.edl || {},
        prompt: body.prompt ? String(body.prompt) : null,
      });
      return jsonResponse({ version: saved }, 201, appUrl);
    }

    if (url.pathname === '/v1/references/biometrics' && request.method === 'DELETE') {
      const cleared = await repo.purgeEphemeralReferenceDescriptors(workspaceId);
      await repo.recordAudit({
        id: crypto.randomUUID(),
        workspaceId,
        actorId,
        eventType: 'purge_biometrics',
        resourceType: 'reference_images',
        outcome: 'allowed',
        detail: `Purged ${cleared} ephemeral descriptors`,
      });
      return jsonResponse({ ok: true, cleared }, 200, appUrl);
    }

    const storageMatch = url.pathname.match(/^\/v1\/storage\/([^/]+)\/([^/]+)$/);
    if (storageMatch) {
      const category = storageMatch[1] as StorageBucketCategory;
      const fileName = decodeURIComponent(storageMatch[2]);
      const key = buildTenantR2Key({ workspaceId, category, fileName });

      if (request.method === 'PUT') {
        const contentType = request.headers.get('content-type') || 'application/octet-stream';
        const data = await request.arrayBuffer();
        const stored = await storage.putObject({ workspaceId, category, fileName, contentType, data });
        return jsonResponse({ ok: true, ...stored }, 201, appUrl);
      }
      if (request.method === 'GET') {
        const obj = await storage.getObject(workspaceId, key);
        if (!obj) return jsonResponse({ error: 'Object not found' }, 404, appUrl);
        return new Response(obj.body as BodyInit, {
          status: 200,
          headers: {
            'content-type': obj.httpMetadata?.contentType || 'application/octet-stream',
            'cache-control': 'private, max-age=300',
          },
        });
      }
      if (request.method === 'DELETE') {
        await storage.deleteObject(workspaceId, key);
        return jsonResponse({ ok: true, deleted: key }, 200, appUrl);
      }
    }

    return jsonResponse({ error: 'Route not found' }, 404, appUrl);
  } catch (err: any) {
    return jsonResponse({ error: err?.message || 'Worker execution error' }, 500, appUrl);
  }
}

export default {
  fetch: handleWorkerRequest,
};
