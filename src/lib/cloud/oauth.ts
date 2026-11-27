import crypto from 'node:crypto';
import type { CloudProviderId } from '@/types/reel-gen';

export type OAuthCallbackProviderSlug = 'google' | 'microsoft' | 'dropbox' | 'box';

export interface OAuthProviderConfig {
  providerId: CloudProviderId;
  callbackSlug: OAuthCallbackProviderSlug;
  displayName: string;
  authorizeEndpoint: string;
  tokenEndpoint: string;
  profileEndpoint: string;
  clientIdEnv: string;
  clientSecretEnv: string;
  scopes: string[];
  extraAuthParams?: Record<string, string>;
}

export const OAUTH_PROVIDER_CONFIGS: Record<
  Exclude<CloudProviderId, 's3' | 's3_compatible'>,
  OAuthProviderConfig
> = {
  google_drive: {
    providerId: 'google_drive',
    callbackSlug: 'google',
    displayName: 'Google Drive',
    authorizeEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenEndpoint: 'https://oauth2.googleapis.com/token',
    profileEndpoint: 'https://www.googleapis.com/oauth2/v2/userinfo',
    clientIdEnv: 'GOOGLE_CLIENT_ID',
    clientSecretEnv: 'GOOGLE_CLIENT_SECRET',
    scopes: ['openid', 'email', 'https://www.googleapis.com/auth/drive.readonly'],
    extraAuthParams: { access_type: 'offline', prompt: 'consent' },
  },
  onedrive: {
    providerId: 'onedrive',
    callbackSlug: 'microsoft',
    displayName: 'Microsoft OneDrive',
    authorizeEndpoint: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenEndpoint: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    profileEndpoint: 'https://graph.microsoft.com/v1.0/me',
    clientIdEnv: 'MICROSOFT_CLIENT_ID',
    clientSecretEnv: 'MICROSOFT_CLIENT_SECRET',
    scopes: ['offline_access', 'User.Read', 'Files.Read'],
  },
  sharepoint: {
    providerId: 'sharepoint',
    callbackSlug: 'microsoft',
    displayName: 'SharePoint',
    authorizeEndpoint: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenEndpoint: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    profileEndpoint: 'https://graph.microsoft.com/v1.0/me',
    clientIdEnv: 'MICROSOFT_CLIENT_ID',
    clientSecretEnv: 'MICROSOFT_CLIENT_SECRET',
    scopes: ['offline_access', 'User.Read', 'Files.Read', 'Sites.Read.All'],
  },
  dropbox: {
    providerId: 'dropbox',
    callbackSlug: 'dropbox',
    displayName: 'Dropbox',
    authorizeEndpoint: 'https://www.dropbox.com/oauth2/authorize',
    tokenEndpoint: 'https://api.dropboxapi.com/oauth2/token',
    profileEndpoint: 'https://api.dropboxapi.com/2/users/get_current_account',
    clientIdEnv: 'DROPBOX_CLIENT_ID',
    clientSecretEnv: 'DROPBOX_CLIENT_SECRET',
    scopes: ['account_info.read', 'files.metadata.read', 'files.content.read'],
    extraAuthParams: { token_access_type: 'offline' },
  },
  box: {
    providerId: 'box',
    callbackSlug: 'box',
    displayName: 'Box',
    authorizeEndpoint: 'https://account.box.com/api/oauth2/authorize',
    tokenEndpoint: 'https://api.box.com/oauth2/token',
    profileEndpoint: 'https://api.box.com/2.0/users/me',
    clientIdEnv: 'BOX_CLIENT_ID',
    clientSecretEnv: 'BOX_CLIENT_SECRET',
    scopes: ['root_readonly'],
  },
};

export const OAUTH_STATE_COOKIE_NAME = 'reelgen_oauth_state';

export function getOAuthConfig(providerId: CloudProviderId): OAuthProviderConfig | null {
  if (providerId === 's3' || providerId === 's3_compatible') return null;
  return OAUTH_PROVIDER_CONFIGS[providerId] ?? null;
}

export function resolveCallbackBaseUrl(requestUrl?: string): string {
  if (requestUrl) {
    try {
      const u = new URL(requestUrl);
      if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') {
        return `${u.protocol}//${u.host}`;
      }
    } catch {
      // fall through
    }
  }
  const configured = (process.env.APP_URL || 'https://reel-gen.anchit-tandon.com').replace(/\/+$/, '');
  return configured;
}

export function getProviderRedirectUri(providerId: CloudProviderId, requestUrl?: string): string | null {
  const cfg = getOAuthConfig(providerId);
  if (!cfg) return null;
  const base = resolveCallbackBaseUrl(requestUrl);
  return `${base}/api/cloud/callback/${cfg.callbackSlug}`;
}

export function generatePkcePair(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
  return { codeVerifier, codeChallenge };
}

export interface OAuthStatePayload {
  state: string;
  providerId: Exclude<CloudProviderId, 's3' | 's3_compatible'>;
  codeVerifier: string;
  redirectUri: string;
  exp: number;
}

function getSigningSecret(): string {
  return process.env.AUTH_SECRET || process.env.ENCRYPTION_KEY || 'reel-gen-local-oauth-state-secret';
}

export function signOAuthStateCookie(payload: OAuthStatePayload): string {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', getSigningSecret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyOAuthStateCookie(cookieVal: string): OAuthStatePayload | null {
  const parts = cookieVal.split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const expected = crypto.createHmac('sha256', getSigningSecret()).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as OAuthStatePayload;
    if (typeof parsed.exp !== 'number' || parsed.exp < Date.now()) return null;
    if (!parsed.state || !parsed.providerId || !parsed.codeVerifier || !parsed.redirectUri) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function buildOAuthAuthorizationRequest(params: {
  providerId: Exclude<CloudProviderId, 's3' | 's3_compatible'>;
  clientId: string;
  requestUrl?: string;
}): {
  authorizeUrl: string;
  statePayload: OAuthStatePayload;
  signedStateCookie: string;
} {
  const cfg = OAUTH_PROVIDER_CONFIGS[params.providerId];
  const state = crypto.randomBytes(16).toString('hex');
  const { codeVerifier, codeChallenge } = generatePkcePair();
  const redirectUri = getProviderRedirectUri(params.providerId, params.requestUrl)!;

  const url = new URL(cfg.authorizeEndpoint);
  url.searchParams.set('client_id', params.clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  if (cfg.scopes.length > 0) {
    url.searchParams.set('scope', cfg.scopes.join(' '));
  }
  if (cfg.extraAuthParams) {
    for (const [k, v] of Object.entries(cfg.extraAuthParams)) {
      url.searchParams.set(k, v);
    }
  }

  const statePayload: OAuthStatePayload = {
    state,
    providerId: params.providerId,
    codeVerifier,
    redirectUri,
    exp: Date.now() + 10 * 60 * 1000,
  };
  const signedStateCookie = signOAuthStateCookie(statePayload);
  return { authorizeUrl: url.toString(), statePayload, signedStateCookie };
}

export interface TokenExchangeResult {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string | null;
  scopes: string[];
  accountEmail: string | null;
  accountLabel: string | null;
}

export type FetchFn = (url: string, init?: RequestInit) => Promise<{
  ok: boolean;
  status: number;
  text: () => Promise<string>;
  json: () => Promise<any>;
}>;

export async function exchangeOAuthCode(params: {
  providerId: Exclude<CloudProviderId, 's3' | 's3_compatible'>;
  code: string;
  codeVerifier: string;
  redirectUri: string;
  clientId: string;
  clientSecret: string;
  fetchImpl?: FetchFn;
}): Promise<TokenExchangeResult> {
  const cfg = OAUTH_PROVIDER_CONFIGS[params.providerId];
  const fetchFn: FetchFn = params.fetchImpl || (fetch as unknown as FetchFn);

  const form = new URLSearchParams({
    grant_type: 'authorization_code',
    code: params.code,
    redirect_uri: params.redirectUri,
    client_id: params.clientId,
    client_secret: params.clientSecret,
    code_verifier: params.codeVerifier,
  });

  const tokenRes = await fetchFn(cfg.tokenEndpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: form.toString(),
  });

  if (!tokenRes.ok) {
    const errText = await tokenRes.text().catch(() => '');
    throw new Error(`${cfg.displayName} token exchange failed (HTTP ${tokenRes.status}): ${errText.slice(0, 200)}`);
  }

  const tokenData = await tokenRes.json();
  const accessToken = String(tokenData.access_token || '');
  if (!accessToken) {
    throw new Error(`${cfg.displayName} did not return an access_token.`);
  }

  const refreshToken = tokenData.refresh_token ? String(tokenData.refresh_token) : null;
  const expiresIn = Number(tokenData.expires_in || 0);
  const expiresAt = expiresIn > 0 ? new Date(Date.now() + expiresIn * 1000).toISOString() : null;
  const scopes = typeof tokenData.scope === 'string' ? tokenData.scope.split(/\s+/).filter(Boolean) : cfg.scopes;

  // Fetch connected account email/name (best effort)
  let accountEmail: string | null = null;
  let accountLabel: string | null = null;
  try {
    const profileRes = await fetchFn(cfg.profileEndpoint, {
      method: params.providerId === 'dropbox' ? 'POST' : 'GET',
      headers: {
        authorization: `Bearer ${accessToken}`,
        accept: 'application/json',
      },
    });
    if (profileRes.ok) {
      const profile = await profileRes.json();
      accountEmail =
        profile.email ||
        profile.mail ||
        profile.userPrincipalName ||
        profile.login ||
        null;
      accountLabel =
        profile.name?.display_name ||
        profile.displayName ||
        profile.name ||
        accountEmail;
    }
  } catch {
    // non-fatal; keep connection valid even if profile endpoint is unavailable
  }

  return {
    accessToken,
    refreshToken,
    expiresAt,
    scopes,
    accountEmail,
    accountLabel,
  };
}

export async function refreshOAuthAccessToken(params: {
  providerId: Exclude<CloudProviderId, 's3' | 's3_compatible'>;
  refreshToken: string;
  clientId: string;
  clientSecret: string;
  fetchImpl?: FetchFn;
}): Promise<{ accessToken: string; refreshToken: string | null; expiresAt: string | null }> {
  const cfg = OAUTH_PROVIDER_CONFIGS[params.providerId];
  const fetchFn: FetchFn = params.fetchImpl || (fetch as unknown as FetchFn);

  const form = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: params.refreshToken,
    client_id: params.clientId,
    client_secret: params.clientSecret,
  });

  const res = await fetchFn(cfg.tokenEndpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: form.toString(),
  });
  if (!res.ok) {
    throw new Error(`${cfg.displayName} token refresh failed (HTTP ${res.status})`);
  }
  const data = await res.json();
  const accessToken = String(data.access_token || '');
  if (!accessToken) throw new Error(`${cfg.displayName} refresh returned no access_token`);
  const expiresIn = Number(data.expires_in || 0);
  return {
    accessToken,
    refreshToken: data.refresh_token ? String(data.refresh_token) : params.refreshToken,
    expiresAt: expiresIn > 0 ? new Date(Date.now() + expiresIn * 1000).toISOString() : null,
  };
}
