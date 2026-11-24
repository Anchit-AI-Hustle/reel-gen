'use client';

import React, { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  ArrowRight,
  Scissors,
  Trash2,
  Save,
  Download,
  Undo2,
  Redo2,
  Send,
  RefreshCw,
  Loader2,
  History,
  Volume2,
  VolumeX,
  Subtitles,
} from 'lucide-react';
import type { EdlClip, MediaAssetRecord, ProjectRecord, TimelineEdl } from '@/types/reel-gen';

export default function ProjectEditorPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = params?.projectId;

  const [project, setProject] = useState<ProjectRecord | null>(null);
  const [media, setMedia] = useState<MediaAssetRecord[]>([]);
  const [edl, setEdl] = useState<TimelineEdl | null>(null);
  const [undoStack, setUndoStack] = useState<TimelineEdl[]>([]);
  const [redoStack, setRedoStack] = useState<TimelineEdl[]>([]);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);

  const [copilotPrompt, setCopilotPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!projectId) return;
    fetch(`/api/projects/${projectId}`)
      .then(async (r) => {
        if (!r.ok) {
          setNotFound(true);
          return null;
        }
        return r.json();
      })
      .then((d) => {
        if (d?.project) {
          setProject(d.project);
          setEdl(d.project.currentEdl);
          setSelectedClipId(d.project.currentEdl?.clips?.[0]?.id ?? null);
        }
        if (Array.isArray(d?.media)) setMedia(d.media);
      })
      .catch(() => setNotFound(true));
  }, [projectId]);

  const mutateEdl = (updater: (draft: TimelineEdl) => TimelineEdl) => {
    if (!edl) return;
    setUndoStack((prev) => [...prev.slice(-20), edl]);
    setRedoStack([]);
    const copy: TimelineEdl = JSON.parse(JSON.stringify(edl));
    const updated = updater(copy);
    // Recalculate timeline positions
    let cursor = 0;
    for (const c of updated.clips) {
      const dur = Math.max(0.3, Number((c.sourceEndSec - c.sourceStartSec).toFixed(2)));
      c.timelineStartSec = Number(cursor.toFixed(2));
      c.timelineEndSec = Number((cursor + dur).toFixed(2));
      cursor = c.timelineEndSec;
    }
    updated.actualDurationSec = Number(cursor.toFixed(2));
    setEdl(updated);
  };

  const handleUndo = () => {
    if (undoStack.length === 0 || !edl) return;
    const prev = undoStack[undoStack.length - 1];
    setUndoStack((s) => s.slice(0, -1));
    setRedoStack((s) => [...s, edl]);
    setEdl(prev);
  };

  const handleRedo = () => {
    if (redoStack.length === 0 || !edl) return;
    const next = redoStack[redoStack.length - 1];
    setRedoStack((s) => s.slice(0, -1));
    setUndoStack((s) => [...s, edl]);
    setEdl(next);
  };

  const moveClip = (idx: number, dir: -1 | 1) => {
    mutateEdl((d) => {
      const target = idx + dir;
      if (target < 0 || target >= d.clips.length) return d;
      const [moved] = d.clips.splice(idx, 1);
      d.clips.splice(target, 0, moved);
      return d;
    });
  };

  const splitClip = (idx: number) => {
    mutateEdl((d) => {
      const c = d.clips[idx];
      const dur = c.sourceEndSec - c.sourceStartSec;
      if (dur < 1.0) return d;
      const mid = Number((c.sourceStartSec + dur / 2).toFixed(2));
      const first: EdlClip = { ...c, sourceEndSec: mid };
      const second: EdlClip = {
        ...c,
        id: `${c.id}_b_${Date.now().toString(36)}`,
        sourceStartSec: mid,
      };
      d.clips.splice(idx, 1, first, second);
      return d;
    });
  };

  const removeClip = (idx: number) => {
    mutateEdl((d) => {
      if (d.clips.length <= 1) return d;
      d.clips.splice(idx, 1);
      return d;
    });
  };

  const handleSave = async () => {
    if (!project || !edl) return;
    setBusy(true);
    setStatusMsg('Saving timeline version…');
    try {
      const res = await fetch(`/api/projects/${project.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ edl }),
      });
      const data = await res.json();
      if (res.ok && data.project) {
        setProject(data.project);
        setStatusMsg(`Saved version v${data.project.activeVersion}`);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleRenderExport = async () => {
    if (!project || !edl) return;
    setBusy(true);
    setStatusMsg('Rendering H.264/AAC MP4 with FFmpeg & running QA…');
    try {
      const res = await fetch(`/api/projects/${project.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'render', edl }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Export failed');
      setProject(data.project);
      setEdl(data.project.currentEdl);
      setStatusMsg(`Export complete: ${data.artifact.fileName} (${data.artifact.durationSec}s MP4)`);
    } catch (err: any) {
      setStatusMsg(err?.message || 'Export error');
    } finally {
      setBusy(false);
    }
  };

  const handleCopilot = async () => {
    if (!project || !copilotPrompt.trim()) return;
    setBusy(true);
    setStatusMsg('Applying Copilot timeline revision & re-rendering…');
    try {
      const res = await fetch(`/api/projects/${project.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'copilot', prompt: copilotPrompt.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Copilot failed');
      setProject(data.project);
      setEdl(data.project.currentEdl);
      setStatusMsg(data.summary);
      setCopilotPrompt('');
    } catch (err: any) {
      setStatusMsg(err?.message || 'Copilot error');
    } finally {
      setBusy(false);
    }
  };

  const handleGenerateAlternative = async () => {
    if (!project) return;
    setBusy(true);
    setStatusMsg('Generating alternative story cut & rendering MP4…');
    try {
      const res = await fetch(`/api/projects/${project.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'alternative' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Alternative generation failed');
      setProject(data.project);
      setEdl(data.project.currentEdl);
      setStatusMsg(data.summary);
    } catch (err: any) {
      setStatusMsg(err?.message || 'Could not generate alternative');
    } finally {
      setBusy(false);
    }
  };

  if (notFound) {
    return (
      <div className="rounded-2xl border border-[#303441] bg-[#171A23] p-8 text-center space-y-3">
        <p className="text-sm font-semibold">Project not found</p>
        <p className="text-xs text-[#A6AFC0]">This project ID does not exist in your workspace.</p>
        <Link href="/editor" className="inline-block rounded-lg bg-[#9A83FF] px-4 py-2 text-xs font-bold text-[#0F0B20]">
          Back to projects
        </Link>
      </div>
    );
  }

  if (!project || !edl) {
    return (
      <div className="rounded-2xl border border-[#303441] bg-[#171A23] p-8 text-center space-y-3">
        <p className="text-sm text-[#A6AFC0]">Loading project editor…</p>
        <Link href="/editor" className="text-xs text-[#9A83FF] hover:underline">
          ← Back to projects
        </Link>
      </div>
    );
  }

  const selectedClip = edl.clips.find((c) => c.id === selectedClipId) || edl.clips[0];

  return (
    <div className="space-y-5">
      {/* Top toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Reel Editor</h1>
          <p className="text-xs text-[#A6AFC0]">
            {project.title} · v{project.activeVersion} · {edl.actualDurationSec}s · {edl.aspectRatio}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={undoStack.length === 0}
            onClick={handleUndo}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#303441] bg-[#171A23] disabled:opacity-40 px-3 py-2 text-xs"
          >
            <Undo2 className="h-3.5 w-3.5" /> Undo
          </button>
          <button
            type="button"
            disabled={redoStack.length === 0}
            onClick={handleRedo}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#303441] bg-[#171A23] disabled:opacity-40 px-3 py-2 text-xs"
          >
            <Redo2 className="h-3.5 w-3.5" /> Redo
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={handleSave}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#3B4052] bg-[#222633] px-3.5 py-2 text-xs font-semibold"
          >
            <Save className="h-3.5 w-3.5" /> Save
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={handleGenerateAlternative}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#3B4052] bg-[#222633] hover:bg-[#2C3142] px-3.5 py-2 text-xs font-semibold"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Alternative
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={handleRenderExport}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#9A83FF] hover:bg-[#AE9BFF] px-4 py-2 text-xs font-bold text-[#0F0B20]"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Render MP4
          </button>
          {project.latestArtifact && (
            <a
              href={`${project.latestArtifact.downloadUrl}?download=1`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-3.5 py-2 text-xs font-semibold text-emerald-300"
            >
              <Download className="h-3.5 w-3.5" /> Download MP4
            </a>
          )}
        </div>
      </div>

      {statusMsg && (
        <div className="rounded-xl border border-[#4E447E] bg-[#221D3A] px-4 py-2.5 text-xs text-[#E4DCFF]">
          {statusMsg}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Preview + Multitrack Timeline */}
        <div className="lg:col-span-8 space-y-5">
          <div className="rounded-2xl border border-[#303441] bg-[#171A23] p-4">
            {project.latestArtifact ? (
              <video
                key={project.latestArtifact.downloadUrl}
                src={project.latestArtifact.downloadUrl}
                controls
                playsInline
                className="w-full max-h-[380px] rounded-xl bg-black object-contain"
              />
            ) : (
              <div className="h-64 flex items-center justify-center rounded-xl bg-black text-xs text-[#A6AFC0]">
                Render MP4 to preview current timeline
              </div>
            )}
          </div>

          {/* Multitrack Timeline */}
          <div className="rounded-2xl border border-[#303441] bg-[#171A23] p-4 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">Multitrack Timeline</h2>
              <span className="text-xs font-mono text-[#A6AFC0]">
                00:00 → {edl.actualDurationSec.toFixed(1)}s ({edl.clips.length} clips)
              </span>
            </div>

            {/* Video Track */}
            <div className="space-y-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-[#9A83FF]">
                V1 · Video Track
              </span>
              <div className="flex gap-2 overflow-x-auto pb-2">
                {edl.clips.map((clip, idx) => {
                  const active = selectedClip?.id === clip.id;
                  return (
                    <div
                      key={clip.id}
                      onClick={() => setSelectedClipId(clip.id)}
                      className={`min-w-[180px] cursor-pointer rounded-xl border p-3 space-y-2 transition-colors ${
                        active
                          ? 'border-[#9A83FF] bg-[#2E274D]'
                          : 'border-[#3B4052] bg-[#11141C] hover:border-[#5D5392]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className="rounded bg-[#222633] px-1.5 py-0.5 text-[10px] uppercase text-[#C7BAFF]">
                          {clip.storyBeat}
                        </span>
                        <span className="text-[10px] font-mono text-[#A6AFC0]">
                          {(clip.sourceEndSec - clip.sourceStartSec).toFixed(1)}s
                        </span>
                      </div>
                      <p className="truncate text-xs font-medium">{clip.fileName}</p>
                      <p className="text-[10px] text-[#A6AFC0] font-mono">
                        In {clip.sourceStartSec}s · Out {clip.sourceEndSec}s
                      </p>
                      <div className="flex items-center gap-1 pt-1">
                        <button
                          type="button"
                          aria-label="Move clip left"
                          onClick={(e) => {
                            e.stopPropagation();
                            moveClip(idx, -1);
                          }}
                          className="rounded bg-[#222633] p-1 hover:bg-[#303441]"
                        >
                          <ArrowLeft className="h-3 w-3" />
                        </button>
                        <button
                          type="button"
                          aria-label="Move clip right"
                          onClick={(e) => {
                            e.stopPropagation();
                            moveClip(idx, 1);
                          }}
                          className="rounded bg-[#222633] p-1 hover:bg-[#303441]"
                        >
                          <ArrowRight className="h-3 w-3" />
                        </button>
                        <button
                          type="button"
                          aria-label="Split clip"
                          onClick={(e) => {
                            e.stopPropagation();
                            splitClip(idx);
                          }}
                          className="rounded bg-[#222633] p-1 hover:bg-[#303441]"
                        >
                          <Scissors className="h-3 w-3" />
                        </button>
                        <button
                          type="button"
                          aria-label="Delete clip"
                          onClick={(e) => {
                            e.stopPropagation();
                            removeClip(idx);
                          }}
                          className="rounded bg-[#222633] p-1 hover:bg-rose-500/30 text-rose-300 ml-auto"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Audio & Captions Track Controls */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-[#262A36]">
              <div className="rounded-xl border border-[#303441] bg-[#11141C] p-3 flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs">
                  {edl.audioTrack.silentOutput ? (
                    <VolumeX className="h-4 w-4 text-amber-400" />
                  ) : (
                    <Volume2 className="h-4 w-4 text-[#9A83FF]" />
                  )}
                  <span>
                    A1 · {edl.audioTrack.silentOutput ? 'Silent output' : edl.audioTrack.musicTrackLabel || 'Original audio'}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    mutateEdl((d) => {
                      d.audioTrack.silentOutput = !d.audioTrack.silentOutput;
                      return d;
                    })
                  }
                  className="rounded-lg bg-[#222633] px-2.5 py-1 text-[11px]"
                >
                  {edl.audioTrack.silentOutput ? 'Unmute' : 'Mute'}
                </button>
              </div>

              <div className="rounded-xl border border-[#303441] bg-[#11141C] p-3 flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs">
                  <Subtitles className="h-4 w-4 text-[#9A83FF]" />
                  <span>T1 · Captions ({edl.captions.length} cues)</span>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    mutateEdl((d) => {
                      if (d.captions.length > 0) d.captions = [];
                      else {
                        d.captions = d.clips.map((c, i) => ({
                          id: `cap_${i}`,
                          startSec: c.timelineStartSec,
                          endSec: c.timelineEndSec,
                          text: `${c.storyBeat.toUpperCase()} · ${c.fileName.replace(/\.[^.]+$/, '')}`,
                        }));
                      }
                      return d;
                    })
                  }
                  className="rounded-lg bg-[#222633] px-2.5 py-1 text-[11px]"
                >
                  {edl.captions.length > 0 ? 'Clear' : 'Auto-Generate'}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Right sidebar: Clip Inspector + AI Copilot + Version History */}
        <div className="lg:col-span-4 space-y-5">
          {/* Selected Clip Inspector */}
          {selectedClip && (
            <section className="rounded-2xl border border-[#303441] bg-[#171A23] p-4 space-y-3">
              <h2 className="text-sm font-semibold">Clip Inspector</h2>
              <p className="text-xs text-[#A6AFC0] truncate">{selectedClip.fileName}</p>
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[11px] text-[#A6AFC0] mb-1">Trim Start (s)</label>
                  <input
                    type="number"
                    step={0.1}
                    min={0}
                    value={selectedClip.sourceStartSec}
                    onChange={(e) => {
                      const val = Math.max(0, Number(e.target.value));
                      mutateEdl((d) => {
                        const target = d.clips.find((c) => c.id === selectedClip.id);
                        if (target && val < target.sourceEndSec - 0.3) target.sourceStartSec = val;
                        return d;
                      });
                    }}
                    className="w-full rounded-lg border border-[#3B4052] bg-[#0B0D12] px-2.5 py-1.5 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-[#A6AFC0] mb-1">Trim End (s)</label>
                  <input
                    type="number"
                    step={0.1}
                    min={0.4}
                    value={selectedClip.sourceEndSec}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      mutateEdl((d) => {
                        const target = d.clips.find((c) => c.id === selectedClip.id);
                        if (target && val > target.sourceStartSec + 0.3) target.sourceEndSec = val;
                        return d;
                      });
                    }}
                    className="w-full rounded-lg border border-[#3B4052] bg-[#0B0D12] px-2.5 py-1.5 text-xs"
                  />
                </div>
              </div>
              <div>
                <label className="block text-[11px] text-[#A6AFC0] mb-1">Transition</label>
                <select
                  value={selectedClip.transitionIn}
                  onChange={(e) => {
                    const val = e.target.value as EdlClip['transitionIn'];
                    mutateEdl((d) => {
                      const target = d.clips.find((c) => c.id === selectedClip.id);
                      if (target) target.transitionIn = val;
                      return d;
                    });
                  }}
                  className="w-full rounded-lg border border-[#3B4052] bg-[#0B0D12] px-2.5 py-1.5 text-xs"
                >
                  <option value="cut">Hard Cut</option>
                  <option value="crossfade">Crossfade</option>
                  <option value="dip_black">Dip to Black</option>
                  <option value="whip">Whip Pan</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] text-[#A6AFC0] mb-1">Replace clip from library</label>
                <select
                  value={selectedClip.assetId}
                  onChange={(e) => {
                    const newAsset = media.find((m) => m.id === e.target.value);
                    if (!newAsset) return;
                    mutateEdl((d) => {
                      const target = d.clips.find((c) => c.id === selectedClip.id);
                      if (target) {
                        target.assetId = newAsset.id;
                        target.fileName = newAsset.fileName;
                        target.sourceStartSec = 0;
                        target.sourceEndSec = Math.min(3, newAsset.probe?.durationSec || 2);
                      }
                      return d;
                    });
                  }}
                  className="w-full rounded-lg border border-[#3B4052] bg-[#0B0D12] px-2.5 py-1.5 text-xs"
                >
                  {media
                    .filter((m) => m.kind === 'video' && m.decodable)
                    .map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.fileName}
                      </option>
                    ))}
                </select>
              </div>
            </section>
          )}

          {/* AI Copilot */}
          <section className="rounded-2xl border border-[#303441] bg-[#171A23] p-4 space-y-3">
            <h2 className="text-sm font-semibold">AI Copilot</h2>
            <p className="text-xs text-[#A6AFC0]">
              Ask for timeline changes in plain language. Every revision updates the real EDL and creates a new version.
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                value={copilotPrompt}
                onChange={(e) => setCopilotPrompt(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCopilot()}
                placeholder="e.g. Replace the second clip or make it 15s"
                className="flex-1 rounded-lg border border-[#3B4052] bg-[#0B0D12] px-3 py-2 text-xs focus:border-[#9A83FF] focus:outline-none"
              />
              <button
                type="button"
                disabled={busy || !copilotPrompt.trim()}
                onClick={handleCopilot}
                className="inline-flex items-center gap-1 rounded-lg bg-[#9A83FF] hover:bg-[#AE9BFF] disabled:opacity-40 px-3 py-2 text-xs font-bold text-[#0F0B20]"
              >
                <Send className="h-3.5 w-3.5" />
              </button>
            </div>
          </section>

          {/* Version History */}
          <section className="rounded-2xl border border-[#303441] bg-[#171A23] p-4 space-y-2.5">
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <History className="h-4 w-4 text-[#9A83FF]" /> Version History
            </h2>
            <div className="space-y-1.5 max-h-48 overflow-y-auto">
              {project.versions.map((v) => (
                <button
                  key={v.version}
                  type="button"
                  onClick={() => setEdl(v.edl)}
                  className="w-full text-left rounded-lg border border-[#303441] bg-[#11141C] hover:border-[#9A83FF] px-3 py-2 text-xs"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold">v{v.version} · {v.label}</span>
                    <span className="text-[10px] text-[#A6AFC0]">{v.edl.actualDurationSec}s</span>
                  </div>
                </button>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
