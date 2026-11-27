import { NextResponse } from 'next/server';
import {
  appendActivity,
  readWorkspaceState,
  writeWorkspaceState,
} from '@/lib/db/cloudflare-store';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const connectionId = String(body.connectionId || '');
    const providerId = String(body.providerId || '');

    const state = readWorkspaceState();
    const existing = state.sourceConnections || [];
    const target = existing.find(
      (c) => (connectionId && c.id === connectionId) || (providerId && c.provider === providerId)
    );

    if (!target) {
      return NextResponse.json({ error: 'Connection not found' }, { status: 404 });
    }

    state.sourceConnections = existing.filter((c) => c.id !== target.id);
    appendActivity(
      state,
      'Cloud drive disconnected',
      `Disconnected ${target.provider}${target.accountEmail ? ` (${target.accountEmail})` : ''}`
    );
    writeWorkspaceState(state);

    return NextResponse.json({ ok: true, disconnectedId: target.id });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Failed to disconnect cloud drive' }, { status: 400 });
  }
}
