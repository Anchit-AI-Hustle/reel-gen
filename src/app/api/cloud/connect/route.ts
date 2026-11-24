import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { getCloudProvidersStatus } from '@/lib/cloud/providers';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const providerId = String(body.providerId || '');
    const providers = getCloudProvidersStatus();
    const provider = providers.find((p) => p.id === providerId);

    if (!provider) {
      return NextResponse.json({ error: `Unknown cloud provider: ${providerId}` }, { status: 400 });
    }

    if (!provider.configured) {
      return NextResponse.json(
        {
          error: `${provider.name} OAuth is not configured yet. Missing server environment variables: ${provider.missingEnvVars.join(', ')}.`,
          missingEnvVars: provider.missingEnvVars,
        },
        { status: 412 }
      );
    }

    const appUrl = (process.env.APP_URL || 'https://reel-gen.anchit-tandon.com').replace(/\/+$/, '');
    const state = crypto.randomBytes(16).toString('hex');

    if (providerId === 'google_drive') {
      const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      url.searchParams.set('client_id', process.env.GOOGLE_CLIENT_ID!);
      url.searchParams.set('redirect_uri', `${appUrl}/api/cloud/callback/google`);
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('scope', 'https://www.googleapis.com/auth/drive.readonly');
      url.searchParams.set('access_type', 'offline');
      url.searchParams.set('prompt', 'consent');
      url.searchParams.set('state', state);
      return NextResponse.json({ authorizeUrl: url.toString(), state });
    }

    if (providerId === 'onedrive' || providerId === 'sharepoint') {
      const url = new URL('https://login.microsoftonline.com/common/oauth2/v2.0/authorize');
      url.searchParams.set('client_id', process.env.MICROSOFT_CLIENT_ID!);
      url.searchParams.set('redirect_uri', `${appUrl}/api/cloud/callback/microsoft`);
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('scope', 'offline_access Files.Read Sites.Read.All');
      url.searchParams.set('state', state);
      return NextResponse.json({ authorizeUrl: url.toString(), state });
    }

    return NextResponse.json(
      { error: `OAuth redirect flow for ${provider.name} requires provider callback configuration.` },
      { status: 501 }
    );
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Failed to initiate OAuth flow' }, { status: 400 });
  }
}
