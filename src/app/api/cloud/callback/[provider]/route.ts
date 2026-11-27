import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { encryptSensitivePayload } from '@/lib/auth';
import {
  OAUTH_STATE_COOKIE_NAME,
  exchangeOAuthCode,
  getOAuthConfig,
  resolveCallbackBaseUrl,
  verifyOAuthStateCookie,
} from '@/lib/cloud/oauth';
import {
  appendActivity,
  readWorkspaceState,
  writeWorkspaceState,
} from '@/lib/db/cloudflare-store';

function parseCookie(request: Request, name: string): string | null {
  const header = request.headers.get('cookie') || '';
  const match = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function redirectToDrives(baseUrl: string, params: Record<string, string>) {
  const url = new URL('/drives', baseUrl);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  const res = NextResponse.redirect(url);
  res.cookies.set(OAUTH_STATE_COOKIE_NAME, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  });
  return res;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ provider: string }> }
) {
  const { provider: callbackSlug } = await context.params;
  const baseUrl = resolveCallbackBaseUrl(request.url);
  const url = new URL(request.url);

  const oauthError = url.searchParams.get('error');
  const oauthErrorDesc = url.searchParams.get('error_description');
  if (oauthError) {
    return redirectToDrives(baseUrl, {
      error: `${callbackSlug} authorization denied: ${oauthErrorDesc || oauthError}`,
    });
  }

  const code = url.searchParams.get('code');
  const returnedState = url.searchParams.get('state');
  const rawStateCookie = parseCookie(request, OAUTH_STATE_COOKIE_NAME);

  if (!code || !returnedState || !rawStateCookie) {
    return redirectToDrives(baseUrl, {
      error: 'Missing OAuth authorization code or expired sign-in state. Please try connecting again.',
    });
  }

  const statePayload = verifyOAuthStateCookie(rawStateCookie);
  if (!statePayload || statePayload.state !== returnedState) {
    return redirectToDrives(baseUrl, {
      error: 'OAuth state verification failed (possible expired session or CSRF mismatch). Please try again.',
    });
  }

  const oauthCfg = getOAuthConfig(statePayload.providerId);
  if (!oauthCfg || oauthCfg.callbackSlug !== callbackSlug) {
    return redirectToDrives(baseUrl, {
      error: `OAuth provider mismatch for callback "${callbackSlug}".`,
    });
  }

  const clientId = process.env[oauthCfg.clientIdEnv] || '';
  const clientSecret = process.env[oauthCfg.clientSecretEnv] || '';
  if (!clientId || !clientSecret) {
    return redirectToDrives(baseUrl, {
      error: `${oauthCfg.displayName} OAuth server credentials (${oauthCfg.clientIdEnv} / ${oauthCfg.clientSecretEnv}) are missing.`,
    });
  }

  try {
    const tokenResult = await exchangeOAuthCode({
      providerId: statePayload.providerId,
      code,
      codeVerifier: statePayload.codeVerifier,
      redirectUri: statePayload.redirectUri,
      clientId,
      clientSecret,
    });

    const state = readWorkspaceState();
    const connections = state.sourceConnections || [];
    const now = new Date().toISOString();
    const existingIdx = connections.findIndex(
      (c) => c.provider === statePayload.providerId && (!tokenResult.accountEmail || c.accountEmail === tokenResult.accountEmail)
    );

    const record = {
      id: existingIdx >= 0 ? connections[existingIdx].id : crypto.randomUUID(),
      workspaceId: state.workspaceId,
      provider: statePayload.providerId,
      accountEmail: tokenResult.accountEmail,
      accountLabel: tokenResult.accountLabel || oauthCfg.displayName,
      status: 'connected' as const,
      encryptedAccessToken: encryptSensitivePayload(tokenResult.accessToken),
      encryptedRefreshToken: tokenResult.refreshToken
        ? encryptSensitivePayload(tokenResult.refreshToken)
        : existingIdx >= 0
          ? connections[existingIdx].encryptedRefreshToken
          : null,
      tokenExpiresAt: tokenResult.expiresAt,
      scopes: tokenResult.scopes,
      lastSyncedAt: now,
      lastError: null,
      createdAt: existingIdx >= 0 ? connections[existingIdx].createdAt : now,
      updatedAt: now,
    };

    if (existingIdx >= 0) connections[existingIdx] = record;
    else connections.unshift(record);

    state.sourceConnections = connections;
    appendActivity(
      state,
      'Cloud drive connected',
      `Connected ${oauthCfg.displayName}${tokenResult.accountEmail ? ` (${tokenResult.accountEmail})` : ''}`
    );
    writeWorkspaceState(state);

    return redirectToDrives(baseUrl, {
      connected: statePayload.providerId,
      ...(tokenResult.accountEmail ? { account: tokenResult.accountEmail } : {}),
    });
  } catch (err: any) {
    return redirectToDrives(baseUrl, {
      error: err?.message || `Failed to complete ${oauthCfg.displayName} sign-in.`,
    });
  }
}
