'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { LayoutDashboard, Film, CheckCircle2, Clock, Download, Database } from 'lucide-react';
import type {
  ActivityEventRecord,
  MediaAssetRecord,
  ProcessingJobRecord,
  ProjectRecord,
  RenderArtifactRecord,
} from '@/types/reel-gen';

interface DashboardState {
  projects: ProjectRecord[];
  media: MediaAssetRecord[];
  jobs: ProcessingJobRecord[];
  artifacts: RenderArtifactRecord[];
  activity: ActivityEventRecord[];
  database?: { mode: string; configured: boolean; provider: string; detail: string };
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardState | null>(null);

  useEffect(() => {
    fetch('/api/state')
      .then((r) => r.json())
      .then((d) => setData(d))
      .catch(() => {});
  }, []);

  if (!data) {
    return <p className="text-sm text-[#A6AFC0]">Loading real workspace telemetry…</p>;
  }

  const totalStorageMb = (
    data.media.reduce((s, m) => s + m.sizeBytes, 0) /
    (1024 * 1024)
  ).toFixed(2);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
          <p className="mt-1 text-sm text-[#A6AFC0]">
            Track your projects, creations, verified MP4 exports, and processing activity.
          </p>
        </div>
        {data.database && (
          <div className="inline-flex items-center gap-2 rounded-full border border-[#303441] bg-[#171A23] px-3.5 py-1.5 text-xs">
            <Database className={`h-3.5 w-3.5 ${data.database.configured ? 'text-emerald-400' : 'text-amber-400'}`} />
            <span>{data.database.configured ? 'Neon PostgreSQL Connected' : 'Local Durable Store (Neon Pending)'}</span>
          </div>
        )}
      </div>

      {/* Real counts only — zero fabricated metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-2xl border border-[#303441] bg-[#171A23] p-4">
          <p className="text-xs text-[#A6AFC0]">Projects</p>
          <p className="mt-1 text-2xl font-bold">{data.projects.length}</p>
        </div>
        <div className="rounded-2xl border border-[#303441] bg-[#171A23] p-4">
          <p className="text-xs text-[#A6AFC0]">Indexed Media</p>
          <p className="mt-1 text-2xl font-bold">{data.media.length}</p>
        </div>
        <div className="rounded-2xl border border-[#303441] bg-[#171A23] p-4">
          <p className="text-xs text-[#A6AFC0]">Verified MP4 Exports</p>
          <p className="mt-1 text-2xl font-bold">{data.artifacts.filter((a) => a.qaPassed).length}</p>
        </div>
        <div className="rounded-2xl border border-[#303441] bg-[#171A23] p-4">
          <p className="text-xs text-[#A6AFC0]">Storage Used ($0 Tier)</p>
          <p className="mt-1 text-2xl font-bold">{totalStorageMb} MB</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Projects */}
        <section className="rounded-2xl border border-[#303441] bg-[#171A23] p-5 space-y-3">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <LayoutDashboard className="h-4 w-4 text-[#9A83FF]" /> Projects
          </h2>
          {data.projects.length === 0 ? (
            <p className="text-xs text-[#A6AFC0]">No projects created yet.</p>
          ) : (
            <div className="space-y-2">
              {data.projects.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-[#303441] bg-[#11141C] p-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold">{p.title}</p>
                    <p className="text-[11px] text-[#A6AFC0]">
                      {p.status} · {p.aspectRatio} · v{p.activeVersion}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {p.latestArtifact && (
                      <a
                        href={`${p.latestArtifact.downloadUrl}?download=1`}
                        className="rounded-lg bg-[#222633] p-1.5 text-[#D7CDFF]"
                        title="Download MP4"
                      >
                        <Download className="h-3.5 w-3.5" />
                      </a>
                    )}
                    <Link
                      href={`/editor/${p.id}`}
                      className="rounded-lg bg-[#2E284B] px-2.5 py-1 text-xs font-medium text-[#E3DCFF]"
                    >
                      Edit
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Activity & Processing Jobs */}
        <section className="rounded-2xl border border-[#303441] bg-[#171A23] p-5 space-y-3">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <Clock className="h-4 w-4 text-[#9A83FF]" /> Activity &amp; Render Jobs
          </h2>
          {data.activity.length === 0 ? (
            <p className="text-xs text-[#A6AFC0]">No activity recorded yet.</p>
          ) : (
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {data.activity.map((ev) => (
                <div
                  key={ev.id}
                  className="flex items-start justify-between gap-3 rounded-xl border border-[#303441] bg-[#11141C] p-3 text-xs"
                >
                  <div>
                    <p className="font-semibold flex items-center gap-1.5">
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                      {ev.action}
                    </p>
                    <p className="text-[11px] text-[#A6AFC0] mt-0.5">{ev.detail}</p>
                  </div>
                  <span className="text-[10px] text-[#6E778C] shrink-0">
                    {new Date(ev.createdAt).toLocaleTimeString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
