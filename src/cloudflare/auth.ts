// Web Crypto API authentication & signed workspace claims for Cloudflare Workers

export interface VerifiedWorkerIdentity {
  workspaceId: string;
  actorId: string;
}

function timingSafeEqualString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function createWorkspaceClaimSignature(params: {
  secret: string;
  workspaceId: string;
  actorId: string;
  timestampMs: number;
}): Promise<string> {
  const payload = `${params.workspaceId}:${params.actorId}:${params.timestampMs}`;
  return hmacSha256Hex(params.secret, payload);
}

/**
 * Verifies BOTH the backend Bearer token AND the HMAC-signed workspace identity claim.
 * Never trusts an unsigned workspaceId header from a browser or untrusted caller.
 */
export async function verifyWorkerRequestAuth(
  request: Request,
  env: { CLOUDFLARE_DB_API_TOKEN?: string; AUTH_SECRET?: string }
): Promise<{ ok: true; identity: VerifiedWorkerIdentity } | { ok: false; status: number; error: string }> {
  const expectedToken = env.CLOUDFLARE_DB_API_TOKEN;
  if (!expectedToken || expectedToken.length < 16) {
    return { ok: false, status: 503, error: 'Worker API token secret is not configured' };
  }

  const authHeader = request.headers.get('authorization') || '';
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!bearer || !timingSafeEqualString(bearer, expectedToken)) {
    return { ok: false, status: 401, error: 'Unauthorized: invalid or missing backend API token' };
  }

  const workspaceId = (request.headers.get('x-reelgen-workspace') || '').trim();
  const actorId = (request.headers.get('x-reelgen-actor') || 'system').trim();
  const tsRaw = (request.headers.get('x-reelgen-ts') || '').trim();
  const sig = (request.headers.get('x-reelgen-sig') || '').trim();

  if (!workspaceId || !tsRaw || !sig) {
    return { ok: false, status: 403, error: 'Forbidden: signed workspace identity claim headers are required' };
  }

  const ts = Number(tsRaw);
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > 5 * 60 * 1000) {
    return { ok: false, status: 401, error: 'Unauthorized: expired or invalid request timestamp' };
  }

  const signingSecret = env.AUTH_SECRET || expectedToken;
  const expectedSig = await createWorkspaceClaimSignature({
    secret: signingSecret,
    workspaceId,
    actorId,
    timestampMs: ts,
  });

  if (!timingSafeEqualString(sig, expectedSig)) {
    return { ok: false, status: 403, error: 'Forbidden: workspace claim signature mismatch' };
  }

  return { ok: true, identity: { workspaceId, actorId } };
}
