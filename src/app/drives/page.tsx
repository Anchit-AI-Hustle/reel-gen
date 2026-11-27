'use client';

import React, { useEffect, useState } from 'react';
import {
  Cloud,
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Copy,
  RefreshCw,
  Unplug,
  Loader2,
} from 'lucide-react';
import type { ProviderStatusInfo, ParsedCloudLink } from '@/lib/cloud/providers';
import type { PublicSourceConnection } from '@/types/reel-gen';

interface ProviderWithRedirect extends ProviderStatusInfo {
  redirectUri?: string | null;
}

export default function CloudDrivesPage() {
  const [providers, setProviders] = useState<ProviderWithRedirect[]>([]);
  const [connections, setConnections] = useState<PublicSourceConnection[]>([]);
  const [linksInput, setLinksInput] = useState('');
  const [validationResult, setValidationResult] = useState<{
    valid: ParsedCloudLink[];
    invalid: ParsedCloudLink[];
  } | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [connectSuccess, setConnectSuccess] = useState<string | null>(null);
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [copiedUri, setCopiedUri] = useState<string | null>(null);

  const loadState = () => {
    fetch('/api/state')
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d.providers)) setProviders(d.providers);
        if (Array.isArray(d.connections)) setConnections(d.connections);
      })
      .catch(() => {});
  };

  useEffect(() => {
    loadState();
    try {
      const params = new URLSearchParams(window.location.search);
      const connected = params.get('connected');
      const account = params.get('account');
      const err = params.get('error');
      if (connected) {
        setConnectSuccess(
          `Connected ${connected.replace('_', ' ')}${account ? ` as ${account}` : ''}.`
        );
      }
      if (err) {
        setConnectError(err);
      }
    } catch {
      // ignore
    }
  }, []);

  const handleValidate = async () => {
    const res = await fetch('/api/cloud/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ links: linksInput }),
    });
    const data = await res.json();
    setValidationResult({ valid: data.valid || [], invalid: data.invalid || [] });
  };

  const handleConnect = async (providerId: string) => {
    setConnectError(null);
    setConnectSuccess(null);
    setConnectingId(providerId);
    try {
      const res = await fetch('/api/cloud/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerId }),
      });
      const data = await res.json();
      if (res.ok && data.authorizeUrl) {
        window.location.href = data.authorizeUrl;
        return;
      }
      if (res.ok && data.connected) {
        setConnectSuccess(`Connected ${providerId.replace('_', ' ')} successfully.`);
        loadState();
        return;
      }
      setConnectError(data.error || 'OAuth setup is required before connecting.');
    } catch (err: any) {
      setConnectError(err?.message || 'Could not start platform sign-in.');
    } finally {
      setConnectingId(null);
    }
  };

  const handleDisconnect = async (connectionId: string, providerName: string) => {
    setConnectError(null);
    setConnectSuccess(null);
    const res = await fetch('/api/cloud/disconnect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ connectionId }),
    });
    if (res.ok) {
      setConnectSuccess(`Disconnected ${providerName}.`);
      loadState();
    } else {
      const d = await res.json().catch(() => ({}));
      setConnectError(d.error || 'Failed to disconnect drive.');
    }
  };

  const copyRedirectUri = async (uri: string) => {
    try {
      await navigator.clipboard.writeText(uri);
      setCopiedUri(uri);
      setTimeout(() => setCopiedUri(null), 2000);
    } catch {
      // ignore clipboard restrictions
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Cloud Drives</h1>
        <p className="mt-1 text-sm text-[#A6AFC0]">
          Sign in with your cloud storage platforms to link drives and import complete folders via official OAuth 2.0 + PKCE.
        </p>
      </div>

      {connectSuccess && (
        <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-xs text-emerald-200 flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
          <span>{connectSuccess}</span>
        </div>
      )}

      {connectError && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-xs text-amber-200 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400 mt-0.5" />
          <span>{connectError}</span>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {providers.map((p) => {
          const activeConn = connections.find((c) => c.provider === p.id && c.status === 'connected');
          const isBusy = connectingId === p.id;

          return (
            <div
              key={p.id}
              className="rounded-2xl border border-[#303441] bg-[#171A23] p-5 flex flex-col justify-between gap-4"
            >
              <div className="space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 font-semibold text-sm">
                    <Cloud className="h-4 w-4 text-[#9A83FF]" />
                    {p.name}
                  </div>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${
                      activeConn
                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                        : p.configured
                          ? 'bg-[#2E284B] text-[#E3DCFF] border border-[#9A83FF]/40'
                          : 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                    }`}
                  >
                    {activeConn ? 'Connected' : p.configured ? 'OAuth Ready' : 'Setup Required'}
                  </span>
                </div>

                {activeConn ? (
                  <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-2.5 text-xs text-emerald-100 space-y-0.5">
                    <p className="font-semibold truncate">
                      {activeConn.accountEmail || activeConn.accountLabel || 'Authorized account'}
                    </p>
                    <p className="text-[10px] text-emerald-200/80">
                      Encrypted OAuth tokens active · Updated {new Date(activeConn.updatedAt).toLocaleDateString()}
                    </p>
                  </div>
                ) : (
                  <p className="text-xs text-[#A6AFC0]">{p.setupInstruction}</p>
                )}

                <div className="flex flex-wrap gap-1 pt-0.5">
                  {p.supportedCapabilities.map((cap) => (
                    <span key={cap} className="rounded bg-[#222633] px-2 py-0.5 text-[10px] text-[#C7CDD9]">
                      {cap}
                    </span>
                  ))}
                </div>

                {p.redirectUri && !activeConn && (
                  <div className="rounded-lg border border-[#303441] bg-[#0E1118] p-2 space-y-1">
                    <div className="flex items-center justify-between gap-1 text-[10px] text-[#A6AFC0]">
                      <span>OAuth Redirect URI</span>
                      <button
                        type="button"
                        onClick={() => copyRedirectUri(p.redirectUri!)}
                        className="inline-flex items-center gap-1 text-[#C7BAFF] hover:underline"
                      >
                        <Copy className="h-3 w-3" />
                        {copiedUri === p.redirectUri ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                    <code className="block truncate text-[10px] text-[#D7CDFF]">{p.redirectUri}</code>
                  </div>
                )}
              </div>

              {activeConn ? (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => handleConnect(p.id)}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl border border-[#3B4052] bg-[#222633] hover:bg-[#2C3142] py-2 text-xs font-semibold"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${isBusy ? 'animate-spin' : ''}`} />
                    Reconnect
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDisconnect(activeConn.id, p.name)}
                    className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-rose-500/40 bg-rose-500/10 hover:bg-rose-500/20 px-3 py-2 text-xs font-semibold text-rose-200"
                  >
                    <Unplug className="h-3.5 w-3.5" />
                    Disconnect
                  </button>
                </div>
              ) : p.configured ? (
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => handleConnect(p.id)}
                  className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-[#9A83FF] hover:bg-[#AE9BFF] disabled:opacity-50 py-2 text-xs font-bold text-[#0F0B20]"
                >
                  {isBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                  Sign in with {p.name}
                </button>
              ) : (
                <div className="space-y-2">
                  <div className="rounded-lg border border-[#303441] bg-[#11141C] p-2.5 text-[11px] text-[#A6AFC0]">
                    Missing server env: <span className="font-mono text-amber-300">{p.missingEnvVars.join(', ')}</span>
                  </div>
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => handleConnect(p.id)}
                    className="w-full rounded-xl border border-[#3B4052] bg-[#222633] hover:bg-[#2C3142] py-2 text-xs font-semibold text-[#D5D9E6]"
                  >
                    Sign in with {p.name}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <section className="rounded-2xl border border-[#303441] bg-[#171A23] p-5 space-y-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-[#9A83FF]" />
          <h2 className="text-sm font-semibold">Validate Cloud Folder Links (SSRF &amp; Allowlist Guard)</h2>
        </div>
        <textarea
          rows={3}
          value={linksInput}
          onChange={(e) => setLinksInput(e.target.value)}
          placeholder="Paste Google Drive, OneDrive, SharePoint, Dropbox, Box, or S3 folder links — one per line"
          className="w-full rounded-xl border border-[#3B4052] bg-[#0B0D12] px-3 py-2 text-xs focus:border-[#9A83FF] focus:outline-none"
        />
        <button
          type="button"
          onClick={handleValidate}
          className="rounded-xl bg-[#222633] hover:bg-[#2C3142] border border-[#3B4052] px-4 py-2 text-xs font-semibold"
        >
          Validate Links
        </button>

        {validationResult && (
          <div className="space-y-2 pt-2 text-xs">
            {validationResult.valid.map((v) => (
              <div key={v.originalUrl} className="flex items-center gap-2 text-emerald-300">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                <span className="truncate">
                  {v.provider} · Folder ID: <code className="text-emerald-200">{v.folderId || 'detected'}</code>
                </span>
              </div>
            ))}
            {validationResult.invalid.map((inv) => (
              <div key={inv.originalUrl} className="flex items-center gap-2 text-rose-300">
                <XCircle className="h-4 w-4 shrink-0" />
                <span>
                  Blocked: {inv.originalUrl} ({inv.reason})
                </span>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-start gap-2 rounded-xl border border-[#303441] bg-[#11141C] p-3 text-xs text-[#A6AFC0]">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400 mt-0.5" />
          <span>
            Reel Gen never scrapes unauthenticated drives or fakes connected status. Add your OAuth client credentials in Vercel (and register the Redirect URI shown above) to sign in and link drives.
          </span>
        </div>
      </section>
    </div>
  );
}
