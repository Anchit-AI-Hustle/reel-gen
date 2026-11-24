import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createWorkspaceClaimSignature, verifyWorkerRequestAuth } from '../src/cloudflare/auth.ts';
import { D1Repository, type D1DatabaseLike } from '../src/cloudflare/d1-repository.ts';
import { R2MediaStorage, assertR2KeyOwnership, buildTenantR2Key, type R2BucketLike } from '../src/cloudflare/storage.ts';
import { handleWorkerRequest } from '../src/cloudflare/index.ts';

const TEST_BASE = 'https://worker.test';

test('Cloudflare D1 SQLite migrations 0001 + 0002 execute cleanly in real SQLite with foreign keys enabled', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reelgen-d1-'));
  const dbPath = path.join(tmpDir, 'reel-gen-db.sqlite');
  try {
    const sql1 = fs.readFileSync(path.join(process.cwd(), 'db/migrations/0001_initial.sql'), 'utf8');
    const sql2 = fs.readFileSync(path.join(process.cwd(), 'db/migrations/0002_reference_matching.sql'), 'utf8');

    execFileSync('sqlite3', [dbPath], { input: sql1 });
    execFileSync('sqlite3', [dbPath], { input: sql2 });

    // Idempotent re-application check
    execFileSync('sqlite3', [dbPath], { input: sql1 });
    execFileSync('sqlite3', [dbPath], { input: sql2 });

    const tablesOut = execFileSync('sqlite3', [dbPath, '.tables']).toString('utf8');
    for (const requiredTable of [
      'users',
      'sessions',
      'workspaces',
      'projects',
      'media_assets',
      'timeline_versions',
      'rendered_artifacts',
      'reference_images',
      'consent_records',
      'parsed_constraints',
      'audit_logs',
    ]) {
      assert.ok(tablesOut.includes(requiredTable), `Missing D1 table: ${requiredTable}`);
    }

    const fkTest = `
      PRAGMA foreign_keys = ON;
      INSERT INTO users (id, email, name, password_hash) VALUES ('u1', 'a@test.local', 'Tester', 'hash');
      INSERT INTO workspaces (id, name, slug, owner_user_id) VALUES ('ws1', 'Studio', 'studio', 'u1');
      INSERT INTO projects (id, workspace_id, title) VALUES ('p1', 'ws1', 'Goa Reel');
      INSERT INTO timeline_versions (id, project_id, workspace_id, version_number, label, edl_json) VALUES ('v1', 'p1', 'ws1', 1, 'v1', '{}');
      DELETE FROM projects WHERE id = 'p1';
      SELECT COUNT(*) FROM timeline_versions WHERE project_id = 'p1';
    `;
    const countOut = execFileSync('sqlite3', [dbPath], { input: fkTest }).toString('utf8').trim();
    assert.equal(countOut, '0');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Worker auth rejects missing/unsigned workspace claims and accepts HMAC-signed backend requests', async () => {
  const env = { CLOUDFLARE_DB_API_TOKEN: 'backend_secret_value_123456', AUTH_SECRET: 'signing_secret_987654' };

  const noAuthReq = new Request(`${TEST_BASE}/v1/projects`);
  const r1 = await verifyWorkerRequestAuth(noAuthReq, env);
  assert.equal(r1.ok, false);

  const unsignedWsReq = new Request(`${TEST_BASE}/v1/projects`, {
    headers: { authorization: `Bearer ${env.CLOUDFLARE_DB_API_TOKEN}`, 'x-reelgen-workspace': 'ws_1' },
  });
  const r2 = await verifyWorkerRequestAuth(unsignedWsReq, env);
  assert.equal(r2.ok, false);

  const ts = Date.now();
  const sig = await createWorkspaceClaimSignature({
    secret: env.AUTH_SECRET,
    workspaceId: 'ws_1',
    actorId: 'user_1',
    timestampMs: ts,
  });
  const validReq = new Request(`${TEST_BASE}/v1/projects`, {
    headers: {
      authorization: `Bearer ${env.CLOUDFLARE_DB_API_TOKEN}`,
      'x-reelgen-workspace': 'ws_1',
      'x-reelgen-actor': 'user_1',
      'x-reelgen-ts': String(ts),
      'x-reelgen-sig': sig,
    },
  });
  const r3 = await verifyWorkerRequestAuth(validReq, env);
  assert.equal(r3.ok, true);
  if (r3.ok) {
    assert.equal(r3.identity.workspaceId, 'ws_1');
  }
});

test('R2MediaStorage enforces tenant-scoped keys and blocks cross-workspace object access', async () => {
  const store = new Map<string, { body: Uint8Array; httpMetadata?: { contentType?: string } }>();
  const mockBucket: R2BucketLike = {
    put: async (key, value, opts) => {
      store.set(key, {
        body: value instanceof Uint8Array ? value : new Uint8Array(value as ArrayBuffer),
        httpMetadata: opts?.httpMetadata,
      });
    },
    get: async (key) => {
      const hit = store.get(key);
      return hit ? { body: hit.body, size: hit.body.byteLength, httpMetadata: hit.httpMetadata } : null;
    },
    delete: async (key) => {
      store.delete(key);
    },
  };

  const r2 = new R2MediaStorage(mockBucket);
  const putRes = await r2.putObject({
    workspaceId: 'ws_alpha',
    category: 'references',
    fileName: 'subject.jpg',
    contentType: 'image/jpeg',
    data: new Uint8Array([1, 2, 3, 4]),
  });
  assert.equal(putRes.key, buildTenantR2Key({ workspaceId: 'ws_alpha', category: 'references', fileName: 'subject.jpg' }));

  const fetched = await r2.getObject('ws_alpha', putRes.key);
  assert.ok(fetched && fetched.size === 4);

  assert.throws(() => assertR2KeyOwnership(putRes.key, 'ws_beta'), /Forbidden/);
  await assert.rejects(() => r2.getObject('ws_beta', putRes.key), /Forbidden/);
});

test('Cloudflare Worker /health and D1Repository prepared statements work end-to-end', async () => {
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  const mockDb: D1DatabaseLike = {
    prepare: (sql: string) => {
      let bound: unknown[] = [];
      const stmt = {
        bind: (...vals: unknown[]) => {
          bound = vals;
          return stmt;
        },
        all: async <T,>() => {
          calls.push({ sql, values: bound });
          return { results: [] as T[] };
        },
        first: async <T,>() => {
          calls.push({ sql, values: bound });
          return null as T | null;
        },
        run: async () => {
          calls.push({ sql, values: bound });
          return { success: true, meta: { changes: 1 } };
        },
      };
      return stmt;
    },
  };

  const repo = new D1Repository(mockDb);
  await repo.listProjects('ws_isolated');
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /WHERE workspace_id = \?/);
  assert.deepEqual(calls[0].values, ['ws_isolated']);

  const healthRes = await handleWorkerRequest(new Request(`${TEST_BASE}/health`), {
    DB: mockDb,
    MEDIA_BUCKET: { put: async () => {}, get: async () => null, delete: async () => {} },
  });
  assert.equal(healthRes.status, 200);
  const body = (await healthRes.json()) as { ok: boolean; database: string };
  assert.equal(body.ok, true);
  assert.equal(body.database, 'cloudflare-d1');
});
