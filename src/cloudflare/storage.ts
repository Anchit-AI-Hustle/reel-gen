// Cloudflare R2 Storage Layer — Private-by-Default, Tenant-Scoped Keys, Ownership Enforcement

export type StorageBucketCategory = 'uploads' | 'references' | 'renders' | 'thumbnails' | 'proxies' | 'captions';

const ALLOWED_CATEGORIES = new Set<StorageBucketCategory>([
  'uploads',
  'references',
  'renders',
  'thumbnails',
  'proxies',
  'captions',
]);

export interface R2ObjectBodyLike {
  body: ReadableStream | ArrayBuffer | Uint8Array;
  size: number;
  httpMetadata?: { contentType?: string };
  customMetadata?: Record<string, string>;
}

export interface R2BucketLike {
  put: (
    key: string,
    value: ReadableStream | ArrayBuffer | Uint8Array | string,
    options?: {
      httpMetadata?: { contentType?: string };
      customMetadata?: Record<string, string>;
    }
  ) => Promise<unknown>;
  get: (key: string) => Promise<R2ObjectBodyLike | null>;
  delete: (key: string) => Promise<void>;
}

export function buildTenantR2Key(params: {
  workspaceId: string;
  category: StorageBucketCategory;
  fileName: string;
}): string {
  if (!ALLOWED_CATEGORIES.has(params.category)) {
    throw new Error(`Invalid storage category: ${params.category}`);
  }
  const safeWs = params.workspaceId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const safeFile = params.fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
  if (!safeFile || safeFile.includes('..')) {
    throw new Error('Invalid object file name');
  }
  return `workspaces/${safeWs}/${params.category}/${safeFile}`;
}

export function assertR2KeyOwnership(objectKey: string, activeWorkspaceId: string): void {
  const safeWs = activeWorkspaceId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const expectedPrefix = `workspaces/${safeWs}/`;
  if (!objectKey.startsWith(expectedPrefix) || objectKey.includes('..')) {
    throw new Error('Forbidden: cross-workspace R2 object access denied');
  }
}

export class R2MediaStorage {
  private readonly bucket: R2BucketLike;

  constructor(bucket: R2BucketLike) {
    this.bucket = bucket;
  }

  async putObject(params: {
    workspaceId: string;
    category: StorageBucketCategory;
    fileName: string;
    contentType: string;
    data: ArrayBuffer | Uint8Array;
  }): Promise<{ key: string; sizeBytes: number }> {
    const key = buildTenantR2Key({
      workspaceId: params.workspaceId,
      category: params.category,
      fileName: params.fileName,
    });
    const bytes = params.data instanceof Uint8Array ? params.data : new Uint8Array(params.data);
    await this.bucket.put(key, bytes, {
      httpMetadata: { contentType: params.contentType || 'application/octet-stream' },
      customMetadata: {
        workspaceId: params.workspaceId,
        category: params.category,
        uploadedAt: new Date().toISOString(),
      },
    });
    return { key, sizeBytes: bytes.byteLength };
  }

  async getObject(workspaceId: string, objectKey: string): Promise<R2ObjectBodyLike | null> {
    assertR2KeyOwnership(objectKey, workspaceId);
    return this.bucket.get(objectKey);
  }

  async deleteObject(workspaceId: string, objectKey: string): Promise<void> {
    assertR2KeyOwnership(objectKey, workspaceId);
    await this.bucket.delete(objectKey);
  }
}
