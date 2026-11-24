'use client';

import React, { useEffect, useState } from 'react';
import { Settings as SettingsIcon, Database, Shield, Trash2, Save, UserCheck, LogOut } from 'lucide-react';

export default function SettingsPage() {
  const [settings, setSettings] = useState({
    workspaceName: 'Default Studio Workspace',
    defaultDurationSec: 30,
    defaultAspectRatio: '9:16',
    defaultResolution: '1080p',
    biometricRetentionHours: 24,
    brandText: 'Reel Gen Studio',
  });
  const [dbInfo, setDbInfo] = useState<{ configured: boolean; provider: string; detail: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Real session state wired to /api/auth/session
  const [sessionUser, setSessionUser] = useState<{ email: string; workspaceId: string } | null>(null);
  const [authMode, setAuthMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/state')
      .then((r) => r.json())
      .then((d) => {
        if (d.settings) setSettings(d.settings);
        if (d.database) setDbInfo(d.database);
      })
      .catch(() => {});

    fetch('/api/auth/session')
      .then((r) => r.json())
      .then((d) => {
        if (d.authenticated && d.user) setSessionUser(d.user);
      })
      .catch(() => {});
  }, []);

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    const res = await fetch('/api/auth/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: authMode, email, password }),
    });
    const data = await res.json();
    if (!res.ok) {
      setAuthError(data.error || 'Authentication failed');
      return;
    }
    setSessionUser(data.user);
    setPassword('');
    setNotice(`Signed in as ${data.user.email}`);
  };

  const handleSignOut = async () => {
    await fetch('/api/auth/session', { method: 'DELETE' });
    setSessionUser(null);
    setNotice('Signed out cleanly.');
  };

  const handleSave = async () => {
    const res = await fetch('/api/state', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings }),
    });
    if (res.ok) setNotice('Workspace settings saved.');
  };

  const handlePurgeBiometrics = async () => {
    const res = await fetch('/api/state', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'purge_biometrics' }),
    });
    const data = await res.json();
    if (res.ok) setNotice(`Deleted ${data.cleared ?? 0} ephemeral reference descriptor(s).`);
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <SettingsIcon className="h-6 w-6 text-[#9A83FF]" /> Settings
        </h1>
        <p className="mt-1 text-sm text-[#A6AFC0]">
          Configure account sessions, output defaults, Cloudflare D1 + R2 persistence, privacy retention, and zero-cost limits.
        </p>
      </div>

      {notice && (
        <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-2.5 text-xs text-emerald-200">
          {notice}
        </div>
      )}

      {/* Real Account & Session Auth */}
      <section className="rounded-2xl border border-[#303441] bg-[#171A23] p-5 space-y-3">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <UserCheck className="h-4 w-4 text-[#9A83FF]" /> Studio Account &amp; Workspace Session
        </h2>
        {sessionUser ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#303441] bg-[#11141C] p-3 text-xs">
            <div>
              <p className="font-semibold text-[#F5F5F8]">{sessionUser.email}</p>
              <p className="text-[11px] text-[#A6AFC0]">Workspace: {sessionUser.workspaceId}</p>
            </div>
            <button
              type="button"
              onClick={handleSignOut}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#3B4052] bg-[#222633] hover:bg-[#2C3142] px-3 py-1.5 text-xs font-semibold"
            >
              <LogOut className="h-3.5 w-3.5" /> Sign Out
            </button>
          </div>
        ) : (
          <form onSubmit={handleAuthSubmit} className="space-y-3">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setAuthMode('signin')}
                className={`rounded-lg px-3 py-1 text-xs font-semibold ${authMode === 'signin' ? 'bg-[#2E284B] text-[#E3DCFF]' : 'bg-[#222633] text-[#A6AFC0]'}`}
              >
                Sign In
              </button>
              <button
                type="button"
                onClick={() => setAuthMode('signup')}
                className={`rounded-lg px-3 py-1 text-xs font-semibold ${authMode === 'signup' ? 'bg-[#2E284B] text-[#E3DCFF]' : 'bg-[#222633] text-[#A6AFC0]'}`}
              >
                Create Account
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@studio.com"
                className="rounded-lg border border-[#3B4052] bg-[#0B0D12] px-3 py-2 text-xs"
              />
              <input
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password (min 8 characters)"
                className="rounded-lg border border-[#3B4052] bg-[#0B0D12] px-3 py-2 text-xs"
              />
            </div>
            {authError && <p className="text-xs text-rose-300">{authError}</p>}
            <button
              type="submit"
              className="rounded-xl bg-[#9A83FF] hover:bg-[#AE9BFF] px-4 py-2 text-xs font-bold text-[#0F0B20]"
            >
              {authMode === 'signup' ? 'Create Account' : 'Sign In'}
            </button>
          </form>
        )}
      </section>

      {/* Database status */}
      <section className="rounded-2xl border border-[#303441] bg-[#171A23] p-5 space-y-2">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <Database className="h-4 w-4 text-[#9A83FF]" /> Database &amp; Media Storage (Cloudflare D1 + Workers + R2)
        </h2>
        <p className="text-xs text-[#A6AFC0]">
          {dbInfo?.detail || 'Checking Cloudflare Worker API configuration…'}
        </p>
        <p className="text-[11px] text-[#6E778C]">
          Cloudflare D1 + Workers + R2 backend. Set <code className="text-[#D7CDFF]">CLOUDFLARE_DB_API_URL</code>,{' '}
          <code className="text-[#D7CDFF]">CLOUDFLARE_DB_API_TOKEN</code>, and{' '}
          <code className="text-[#D7CDFF]">CLOUDFLARE_R2_BUCKET</code> in Vercel for live Cloudflare D1 + R2 persistence.
        </p>
      </section>

      {/* Output & Brand Defaults */}
      <section className="rounded-2xl border border-[#303441] bg-[#171A23] p-5 space-y-4">
        <h2 className="text-sm font-semibold">Output Defaults &amp; Brand Kit</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-[#A6AFC0] mb-1">Workspace Name</label>
            <input
              type="text"
              value={settings.workspaceName}
              onChange={(e) => setSettings({ ...settings, workspaceName: e.target.value })}
              className="w-full rounded-lg border border-[#3B4052] bg-[#0B0D12] px-3 py-2 text-xs"
            />
          </div>
          <div>
            <label className="block text-xs text-[#A6AFC0] mb-1">Brand End-Card Text</label>
            <input
              type="text"
              value={settings.brandText}
              onChange={(e) => setSettings({ ...settings, brandText: e.target.value })}
              className="w-full rounded-lg border border-[#3B4052] bg-[#0B0D12] px-3 py-2 text-xs"
            />
          </div>
          <div>
            <label className="block text-xs text-[#A6AFC0] mb-1">Default Duration</label>
            <select
              value={settings.defaultDurationSec}
              onChange={(e) => setSettings({ ...settings, defaultDurationSec: Number(e.target.value) })}
              className="w-full rounded-lg border border-[#3B4052] bg-[#0B0D12] px-3 py-2 text-xs"
            >
              <option value={15}>15 seconds</option>
              <option value={30}>30 seconds</option>
              <option value={60}>60 seconds</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-[#A6AFC0] mb-1">Default Aspect Ratio</label>
            <select
              value={settings.defaultAspectRatio}
              onChange={(e) => setSettings({ ...settings, defaultAspectRatio: e.target.value })}
              className="w-full rounded-lg border border-[#3B4052] bg-[#0B0D12] px-3 py-2 text-xs"
            >
              <option value="9:16">Vertical 9:16</option>
              <option value="16:9">Landscape 16:9</option>
              <option value="1:1">Square 1:1</option>
            </select>
          </div>
        </div>
        <button
          type="button"
          onClick={handleSave}
          className="inline-flex items-center gap-2 rounded-xl bg-[#9A83FF] hover:bg-[#AE9BFF] px-4 py-2 text-xs font-bold text-[#0F0B20]"
        >
          <Save className="h-3.5 w-3.5" /> Save Defaults
        </button>
      </section>

      {/* Privacy & Reference Data Deletion */}
      <section className="rounded-2xl border border-[#303441] bg-[#171A23] p-5 space-y-3">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <Shield className="h-4 w-4 text-[#9A83FF]" /> Reference Image Privacy &amp; Biometric Retention
        </h2>
        <p className="text-xs text-[#A6AFC0]">
          Reel Gen never builds a global person-identification database or searches external identities. Temporary visual descriptors stay strictly scoped to their project and can be deleted at any time.
        </p>
        <button
          type="button"
          onClick={handlePurgeBiometrics}
          className="inline-flex items-center gap-2 rounded-xl border border-rose-500/40 bg-rose-500/10 hover:bg-rose-500/20 px-4 py-2 text-xs font-semibold text-rose-200"
        >
          <Trash2 className="h-3.5 w-3.5" /> Purge All Ephemeral Reference Descriptors
        </button>
      </section>
    </div>
  );
}
