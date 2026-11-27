import { NextResponse } from 'next/server';
import {
  appendActivity,
  getDatabaseStatus,
  readWorkspaceState,
  writeWorkspaceState,
} from '@/lib/db/cloudflare-store';
import { getCloudProvidersStatus } from '@/lib/cloud/providers';
import { getProviderRedirectUri } from '@/lib/cloud/oauth';
import type { PublicSourceConnection } from '@/types/reel-gen';

export async function GET(request: Request) {
  const state = readWorkspaceState();
  const { sourceConnections = [], ...restState } = state;

  // Never leak encrypted or raw OAuth tokens to the browser
  const connections: PublicSourceConnection[] = sourceConnections.map((c) => ({
    id: c.id,
    provider: c.provider,
    accountEmail: c.accountEmail,
    accountLabel: c.accountLabel,
    status: c.status,
    tokenExpiresAt: c.tokenExpiresAt,
    scopes: c.scopes,
    lastSyncedAt: c.lastSyncedAt,
    lastError: c.lastError,
    updatedAt: c.updatedAt,
  }));

  const providers = getCloudProvidersStatus().map((p) => ({
    ...p,
    redirectUri: getProviderRedirectUri(p.id, request.url),
  }));

  return NextResponse.json({
    ...restState,
    connections,
    database: getDatabaseStatus(),
    providers,
  });
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const state = readWorkspaceState();

    if (body.action === 'purge_biometrics') {
      let cleared = 0;
      for (const proj of state.projects) {
        for (const ref of proj.references) {
          if (ref.descriptor) {
            delete ref.descriptor;
            cleared++;
          }
        }
      }
      appendActivity(state, 'Privacy cleanup', `Deleted ${cleared} ephemeral reference visual descriptor(s)`);
      writeWorkspaceState(state);
      return NextResponse.json({ ok: true, cleared, settings: state.settings });
    }

    if (body.settings && typeof body.settings === 'object') {
      state.settings = {
        ...state.settings,
        ...body.settings,
      };
      appendActivity(state, 'Settings updated', 'Saved workspace defaults and privacy preferences');
      writeWorkspaceState(state);
    }

    return NextResponse.json({ ok: true, settings: state.settings });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Failed to update workspace settings' }, { status: 400 });
  }
}
