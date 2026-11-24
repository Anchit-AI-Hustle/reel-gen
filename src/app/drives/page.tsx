'use client';

import React, { useEffect, useState } from 'react';
import { Cloud, ShieldCheck, AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import type { ProviderStatusInfo, ParsedCloudLink } from '@/lib/cloud/providers';

export default function CloudDrivesPage() {
  const [providers, setProviders] = useState<ProviderStatusInfo[]>([]);
  const [linksInput, setLinksInput] = useState('');
  const [validationResult, setValidationResult] = useState<{
    valid: ParsedCloudLink[];
    invalid: ParsedCloudLink[];
  } | null>(null);

  useEffect(() => {
    fetch('/api/state')
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d.providers)) setProviders(d.providers);
      })
      .catch(() => {});
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Cloud Drives</h1>
        <p className="mt-1 text-sm text-[#A6AFC0]">
          Connect your footage sources and import complete folders through official OAuth APIs.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {providers.map((p) => (
          <div
            key={p.id}
            className="rounded-2xl border border-[#303441] bg-[#171A23] p-5 flex flex-col justify-between gap-4"
          >
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 font-semibold text-sm">
                  <Cloud className="h-4 w-4 text-[#9A83FF]" />
                  {p.name}
                </div>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${
                    p.configured
                      ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                      : 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                  }`}
                >
                  {p.configured ? 'OAuth Ready' : 'Setup Required'}
                </span>
              </div>
              <p className="text-xs text-[#A6AFC0]">{p.setupInstruction}</p>
              <div className="flex flex-wrap gap-1 pt-1">
                {p.supportedCapabilities.map((cap) => (
                  <span key={cap} className="rounded bg-[#222633] px-2 py-0.5 text-[10px] text-[#C7CDD9]">
                    {cap}
                  </span>
                ))}
              </div>
            </div>

            {p.missingEnvVars.length > 0 ? (
              <div className="rounded-lg border border-[#303441] bg-[#11141C] p-2.5 text-[11px] text-[#A6AFC0]">
                Missing owner env: <span className="font-mono text-amber-300">{p.missingEnvVars.join(', ')}</span>
              </div>
            ) : (
              <button
                type="button"
                className="w-full rounded-xl bg-[#9A83FF] hover:bg-[#AE9BFF] py-2 text-xs font-bold text-[#0F0B20]"
              >
                Connect {p.name}
              </button>
            )}
          </div>
        ))}
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
            Reel Gen never scrapes unauthenticated drives or fakes connected status. Configure official OAuth credentials in Vercel to enable live recursive folder sync.
          </span>
        </div>
      </section>
    </div>
  );
}
