'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { SlidersHorizontal, Sparkles, ArrowRight } from 'lucide-react';
import type { ProjectRecord } from '@/types/reel-gen';

export default function EditorIndexPage() {
  const [projects, setProjects] = useState<ProjectRecord[]>([]);

  useEffect(() => {
    fetch('/api/state')
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d.projects)) setProjects(d.projects);
      })
      .catch(() => {});
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Reel Editor</h1>
        <p className="mt-1 text-sm text-[#A6AFC0]">
          Select a project to open the multitrack timeline editor, or create a new reel.
        </p>
      </div>

      {projects.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[#3B4052] bg-[#171A23] p-12 text-center space-y-3">
          <SlidersHorizontal className="mx-auto h-8 w-8 text-[#9A83FF]" />
          <p className="text-sm font-medium">No editable projects yet</p>
          <p className="text-xs text-[#A6AFC0]">
            Upload footage and generate your first reel to unlock multitrack timeline editing.
          </p>
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-xl bg-[#9A83FF] px-4 py-2 text-xs font-bold text-[#0F0B20]"
          >
            <Sparkles className="h-3.5 w-3.5" />
            Create a reel
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects.map((p) => (
            <Link
              key={p.id}
              href={`/editor/${p.id}`}
              className="rounded-2xl border border-[#303441] bg-[#171A23] hover:border-[#9A83FF] p-5 flex flex-col justify-between gap-3 transition-colors"
            >
              <div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wider text-[#9A83FF]">
                    {p.aspectRatio} · v{p.activeVersion}
                  </span>
                  <span className="text-[11px] text-[#A6AFC0]">{p.status}</span>
                </div>
                <h2 className="mt-2 text-base font-semibold line-clamp-2">{p.title}</h2>
                <p className="mt-1 text-xs text-[#A6AFC0]">
                  {p.currentEdl?.clips.length || 0} clips · {p.currentEdl?.actualDurationSec || 0}s
                </p>
              </div>
              <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#D9CEFF]">
                Open in Timeline Editor <ArrowRight className="h-3.5 w-3.5" />
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
