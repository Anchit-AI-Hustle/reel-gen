import { NextResponse } from 'next/server';
import {
  appendActivity,
  getDatabaseStatus,
  readWorkspaceState,
  writeWorkspaceState,
} from '@/lib/db/neon-store';
import { getCloudProvidersStatus } from '@/lib/cloud/providers';

export async function GET() {
  const state = readWorkspaceState();
  return NextResponse.json({
    ...state,
    database: getDatabaseStatus(),
    providers: getCloudProvidersStatus(),
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
