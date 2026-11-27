import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { getCloudProvidersStatus } from '@/lib/cloud/providers';
import {
  OAUTH_STATE_COOKIE_NAME,
  buildOAuthAuthorizationRequest,
  getOAuthConfig,
  getProviderRedirectUri,
} from '@/lib/cloud/oauth';
import {
  appendActivity,
  readWorkspaceState,
  writeWorkspaceState,
} from '@/lib/db/cloudflare-store';
import type { CloudProviderId } from '@/types/reel-gen';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const providerId = String(body.providerId || '') as CloudProviderId;
    const providers = getCloudProvidersStatus();
    const provider = providers.find((p) => p.id === providerId);

    if (!provider) {
      return NextResponse.json({ error: `Unknown cloud provider: ${providerId}` }, { status: 400 });
    }

    const redirectUri = getProviderRedirectUri(providerId, request.url);

    if (!provider.configured) {
      return NextResponse.json(
        {
          error: `${provider.name} OAuth is not configured yet. Add ${provider.missingEnvVars.join(' and ')} to your server environment variables${redirectUri ? ` and register the Redirect URI: ${redirectUri}` : ''}.`,
          missingEnvVars: provider.missingEnvVars,
          redirectUri,
        },
        { status: 412 }
      );
    }

    // S3 / S3-compatible uses server-side IAM credentials directly rather than browser OAuth redirect
    if (providerId === 's3' || providerId === 's3_compatible') {
      const state = readWorkspaceState();
      const connections = state.sourceConnections || [];
      const now = new Date().toISOString();
      const existingIdx = connections.findIndex((c) => c.provider === providerId);
      const record = {
        id: existingIdx >= 0 ? connections[existingIdx].id : crypto.randomUUID(),
        workspaceId: state.workspaceId,
        provider: providerId,
        accountEmail: null,
        accountLabel: process.env.S3_BUCKET || 'Configured S3 Storage',
        status: 'connected' as const,
        encryptedAccessToken: null,
        encryptedRefreshToken: null,
        tokenExpiresAt: null,
        scopes: ['s3:GetObject', 's3:ListBucket'],
        lastSyncedAt: now,
        lastError: null,
        createdAt: existingIdx >= 0 ? connections[existingIdx].createdAt : now,
        updatedAt: now,
      };
      if (existingIdx >= 0) connections[existingIdx] = record;
      else connections.unshift(record);
      state.sourceConnections = connections;
      appendActivity(state, 'Cloud drive connected', `Connected ${provider.name}`);
      writeWorkspaceState(state);
      return NextResponse.json({ connected: true, providerId });
    }

    const oauthCfg = getOAuthConfig(providerId);
    if (!oauthCfg) {
      return NextResponse.json({ error: `Unsupported OAuth provider: ${providerId}` }, { status: 400 });
    }

    const clientId = process.env[oauthCfg.clientIdEnv] || '';
    const { authorizeUrl, statePayload, signedStateCookie } = buildOAuthAuthorizationRequest({
      providerId: oauthCfg.providerId as Exclude<CloudProviderId, 's3' | 's3_compatible'>,
      clientId,
      requestUrl: request.url,
    });

    const response = NextResponse.json({
      authorizeUrl,
      redirectUri: statePayload.redirectUri,
    });

    response.cookies.set(OAUTH_STATE_COOKIE_NAME, signedStateCookie, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 600,
    });

    return response;
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Failed to initiate OAuth flow' }, { status: 400 });
  }
}
