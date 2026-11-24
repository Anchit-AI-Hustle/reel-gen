import { NextResponse } from 'next/server';
import { getCloudProvidersStatus, parseCloudLinksBatch } from '@/lib/cloud/providers';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const raw = String(body.links || '');
    const parsed = parseCloudLinksBatch(raw);
    const providers = getCloudProvidersStatus();
    return NextResponse.json({
      ...parsed,
      providers,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Validation failed' }, { status: 400 });
  }
}
