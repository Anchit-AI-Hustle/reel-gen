'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Upload,
  FolderOpen,
  Cloud,
  ImagePlus,
  Sparkles,
  Download,
  SlidersHorizontal,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  ChevronDown,
  ChevronUp,
  Trash2,
  Send,
  Loader2,
  ShieldCheck,
} from 'lucide-react';
import type {
  AspectRatio,
  EditMode,
  MediaAssetRecord,
  ProjectRecord,
  ReferenceAsset,
  ReferenceRoleType,
  ResolutionPreset,
} from '@/types/reel-gen';

const QUICK_CHIPS = [
  'Feature this person',
  'Only show this person',
  'Exclude this person',
  'Find similar scenes',
  'Match this visual style',
  'Use these product shots',
  'Focus on action',
  'Focus on emotional moments',
];

const ROLE_OPTIONS: Array<{ value: ReferenceRoleType; label: string }> = [
  { value: 'person_include', label: 'Person to feature' },
  { value: 'person_exclude', label: 'Person to exclude' },
  { value: 'product_feature', label: 'Product to feature' },
  { value: 'object_find', label: 'Object to find' },
  { value: 'visual_style', label: 'Visual inspiration' },
  { value: 'scene_reference', label: 'Scene reference' },
  { value: 'brand_logo', label: 'Brand reference' },
];


export default function CreatePage() {
  const [media, setMedia] = useState<MediaAssetRecord[]>([]);
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([]);
  const [cloudLinksText, setCloudLinksText] = useState('');
  const [showCloudInput, setShowCloudInput] = useState(true);
  const [brief, setBrief] = useState('');
  const [references, setReferences] = useState<ReferenceAsset[]>([]);
  const [consentConfirmed, setConsentConfirmed] = useState(false);

  const [showAdvanced, setShowAdvanced] = useState(false);
  const [durationSec, setDurationSec] = useState(30);
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('9:16');
  const [resolution, setResolution] = useState<ResolutionPreset>('720p');
  const [mode, setMode] = useState<EditMode>('autopilot');
  const [style, setStyle] = useState('smart');

  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [clarificationQ, setClarificationQ] = useState<string | null>(null);

  const [generatedProject, setGeneratedProject] = useState<ProjectRecord | null>(null);
  const [copilotInput, setCopilotInput] = useState('');
  const [revising, setRevising] = useState(false);
  const [revisionNote, setRevisionNote] = useState<string | null>(null);
  const [replacingRefId, setReplacingRefId] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const refInputRef = useRef<HTMLInputElement>(null);
  const replaceRefInputRef = useRef<HTMLInputElement>(null);
  const generateAbortRef = useRef<AbortController | null>(null);

  // Restore draft state & load persisted workspace media
  useEffect(() => {
    try {
      const saved = localStorage.getItem('reelgen_create_draft_v2');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (typeof parsed.brief === 'string') setBrief(parsed.brief);
        if (typeof parsed.cloudLinksText === 'string') setCloudLinksText(parsed.cloudLinksText);
        if (typeof parsed.durationSec === 'number') setDurationSec(parsed.durationSec);
        if (parsed.aspectRatio) setAspectRatio(parsed.aspectRatio);
      }
    } catch {
      // ignore storage errors
    }

    fetch('/api/state')
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data.media)) {
          setMedia(data.media);
          const playableIds = data.media
            .filter((m: MediaAssetRecord) => m.kind === 'video' && m.decodable)
            .map((m: MediaAssetRecord) => m.id);
          setSelectedAssetIds(playableIds);
        }
        if (Array.isArray(data.projects) && data.projects.length > 0 && data.projects[0].latestArtifact) {
          setGeneratedProject(data.projects[0]);
        }
      })
      .catch(() => {});
  }, []);

  // Autosave draft
  useEffect(() => {
    try {
      localStorage.setItem(
        'reelgen_create_draft_v2',
        JSON.stringify({ brief, cloudLinksText, durationSec, aspectRatio })
      );
    } catch {
      // ignore
    }
  }, [brief, cloudLinksText, durationSec, aspectRatio]);

  const handleUploadFiles = useCallback(async (fileList: FileList | File[]) => {
    const arr = Array.from(fileList);
    if (arr.length === 0) return;
    setUploading(true);
    setErrorMsg(null);
    setUploadStatus(`Indexing ${arr.length} file(s) with FFprobe…`);

    try {
      const form = new FormData();
      for (const f of arr) {
        form.append('files', f);
        form.append('relativePaths', (f as any).webkitRelativePath || f.name);
      }
      const res = await fetch('/api/media/upload', { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');

      const newAssets: MediaAssetRecord[] = data.assets || [];
      setMedia((prev) => {
        const map = new Map(prev.map((m) => [m.id, m]));
        for (const a of newAssets) map.set(a.id, a);
        return Array.from(map.values());
      });
      setSelectedAssetIds((prev) => {
        const set = new Set(prev);
        for (const a of newAssets) {
          if (a.kind === 'video' && a.decodable) set.add(a.id);
        }
        return Array.from(set);
      });
      setUploadStatus(
        `Ready: indexed ${newAssets.length} file(s)${data.deduplicatedCount ? ` (${data.deduplicatedCount} already in library)` : ''}.`
      );
    } catch (err: any) {
      setErrorMsg(err?.message || 'Could not upload files');
      setUploadStatus(null);
    } finally {
      setUploading(false);
    }
  }, []);

  const handleUploadReferences = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    if (!consentConfirmed) { setErrorMsg('Confirm you have permission to process the reference images first.'); return; }
    setErrorMsg(null);
    for (const f of Array.from(fileList)) {
      const form = new FormData();
      form.append('file', f);
      form.append('prompt', brief);
      form.append('consentConfirmed', String(consentConfirmed));
      const res = await fetch('/api/references/upload', { method: 'POST', body: form });
      const data = await res.json();
      if (res.ok && data.reference) {
        setReferences((prev) => [...prev, data.reference]);
      } else {
        setErrorMsg(data.error || `Failed to process reference ${f.name}`);
      }
    }
  };

  const updateRefRole = (id: string, role: ReferenceRoleType) => {
    setReferences((prev) =>
      prev.map((r) =>
        r.id === id
          ? {
              ...r,
              role,
              roleInferred: false,
              enforcement: role === 'person_exclude' ? 'hard' : r.enforcement,
            }
          : r
      )
    );
  };

  const removeRef = (id: string) => {
    setReferences((prev) => prev.filter((r) => r.id !== id));
  };

  const toggleChip = (chip: string) => {
    setBrief((prev) => {
      if (prev.toLowerCase().includes(chip.toLowerCase())) return prev;
      return prev.trim() ? `${prev.trim()}. ${chip}.` : `${chip}.`;
    });
  };

  const playableSelectedCount = media.filter(
    (m) => selectedAssetIds.includes(m.id) && m.kind === 'video' && m.decodable
  ).length;
  const canGenerate = playableSelectedCount > 0 && !generating && !uploading && (references.length === 0 || consentConfirmed);

  const handleReplaceReference = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0 || !replacingRefId) return;
    const f = fileList[0];
    const target = references.find((r) => r.id === replacingRefId);
    const form = new FormData();
    form.append('file', f);
    form.append('prompt', brief);
    if (target) form.append('role', target.role);
    form.append('consentConfirmed', String(consentConfirmed));
    const res = await fetch('/api/references/upload', { method: 'POST', body: form });
    const data = await res.json();
    if (res.ok && data.reference) {
      setReferences((prev) => prev.map((r) => (r.id === replacingRefId ? data.reference : r)));
    } else {
      setErrorMsg(data.error || `Failed to replace reference ${f.name}`);
    }
    setReplacingRefId(null);
  };

  const handleCancelGenerate = () => {
    generateAbortRef.current?.abort();
    generateAbortRef.current = null;
    setGenerating(false);
    setErrorMsg('Generation cancelled. Adjust your inputs and retry anytime.');
  };

  const handleGenerate = async () => {
    setGenerating(true);
    setErrorMsg(null);
    setClarificationQ(null);
    setRevisionNote(null);
<<<<<<< HEAD
    setActiveStageIdx(0);

    const controller = new AbortController();
    generateAbortRef.current = controller;

    const timer = setInterval(() => {
      setActiveStageIdx((i) => (i < PIPELINE_STAGES.length - 1 ? i + 1 : i));
    }, 900);
=======
>>>>>>> 14d88b3b948f9ab3c95ed08313e2c1bc0ee97d84

    try {
      const cloudLinks = cloudLinksText
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);

      const refsWithConsent = references.map((r) => ({ ...r, consentConfirmed }));

      const res = await fetch('/api/projects/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          brief,
          assetIds: selectedAssetIds,
          cloudLinks,
          references: refsWithConsent,
          durationSec,
          aspectRatio,
          resolution,
          mode,
          style,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Generation failed');
      }
      if (data.clarificationNeeded) {
        setClarificationQ(data.clarificationQuestion);
      } else if (data.project) {
        setGeneratedProject(data.project);
      }
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        setErrorMsg(err?.message || 'Failed to generate reel');
      }
    } finally {
<<<<<<< HEAD
      clearInterval(timer);
      generateAbortRef.current = null;
=======
>>>>>>> 14d88b3b948f9ab3c95ed08313e2c1bc0ee97d84
      setGenerating(false);
    }
  };

  const handleCopilotRevise = async (action: 'copilot' | 'alternative') => {
    if (!generatedProject) return;
    if (action === 'copilot' && !copilotInput.trim()) return;
    setRevising(true);
    setErrorMsg(null);
    setRevisionNote(null);
    try {
      const res = await fetch(`/api/projects/${generatedProject.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          prompt: copilotInput.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Revision failed');
      setGeneratedProject(data.project);
      setRevisionNote(data.summary);
      if (action === 'copilot') setCopilotInput('');
    } catch (err: any) {
      setErrorMsg(err?.message || 'Could not apply changes');
    } finally {
      setRevising(false);
    }
  };


  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Create a reel</h1>
          <p className="mt-1 text-sm text-[#A6AFC0]">
            Your footage. Your story. Ready in a few steps.
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-[#303441] bg-[#171A23] px-3 py-1 text-xs text-[#A6AFC0]">
          <Sparkles className="h-3.5 w-3.5 text-[#9A83FF]" />
          {durationSec}s · {aspectRatio} · {mode === 'autopilot' ? 'Autopilot' : 'Copilot'}
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left column: Single-screen Step 1 (Footage) + Step 2 (Describe + Reference Images) + Generate */}
        <div className="lg:col-span-7 space-y-5">
          {/* STEP 1: Add footage */}
          <section className="rounded-2xl border border-[#303441] bg-[#171A23] p-5">
            <div className="flex items-center justify-between gap-2 mb-3">
              <div>
                <h2 className="text-base font-semibold">1. Add your footage</h2>
                <p className="text-xs text-[#A6AFC0]">
                  Upload files, select folders, or import footage from cloud storage.
                </p>
              </div>
              <span className="text-xs text-[#A6AFC0]">
                {playableSelectedCount} playable clip{playableSelectedCount === 1 ? '' : 's'} ready
              </span>
            </div>

            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragging(false);
                if (e.dataTransfer.files?.length) {
                  handleUploadFiles(e.dataTransfer.files);
                }
              }}
              className={`rounded-xl border-2 border-dashed p-6 text-center transition-colors ${
                isDragging
                  ? 'border-[#9A83FF] bg-[#9A83FF]/10'
                  : 'border-[#3B4052] bg-[#11141C] hover:border-[#5D5392]'
              }`}
            >
              <Upload className="mx-auto h-7 w-7 text-[#9A83FF] mb-2" />
              <p className="text-sm font-medium">Drop files or folders here</p>
              <p className="mt-1 text-xs text-[#A6AFC0]">
                Upload any file type. Playable formats are detected; other files are kept as project assets.
              </p>

              <div className="mt-4 flex flex-wrap items-center justify-center gap-2.5">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-2 rounded-lg bg-[#222633] hover:bg-[#2C3142] border border-[#3B4052] px-3.5 py-2 text-xs font-semibold text-[#F5F5F8]"
                >
                  <Upload className="h-3.5 w-3.5" />
                  Choose Files
                </button>
                <button
                  type="button"
                  onClick={() => folderInputRef.current?.click()}
                  className="inline-flex items-center gap-2 rounded-lg bg-[#222633] hover:bg-[#2C3142] border border-[#3B4052] px-3.5 py-2 text-xs font-semibold text-[#F5F5F8]"
                >
                  <FolderOpen className="h-3.5 w-3.5" />
                  Choose Folder
                </button>
                <button
                  type="button"
                  onClick={() => setShowCloudInput((v) => !v)}
                  className="inline-flex items-center gap-2 rounded-lg bg-[#222633] hover:bg-[#2C3142] border border-[#3B4052] px-3.5 py-2 text-xs font-semibold text-[#F5F5F8]"
                >
                  <Cloud className="h-3.5 w-3.5" />
                  Paste cloud link
                </button>
                <Link href="/drives" className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-[#4E447E] bg-[#221D3A] px-3.5 py-2 text-xs font-semibold text-[#DDD4FF]"><Cloud className="h-3.5 w-3.5" /> Connect / browse accounts</Link>
              </div>

              {/* No accept restriction per universal intake spec */}
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => { if (e.target.files) void handleUploadFiles(e.target.files); e.target.value = ''; }}
              />
              <input
                ref={folderInputRef}
                type="file"
                multiple
                // @ts-expect-error webkitdirectory is standard in modern browsers
                webkitdirectory=""
                className="hidden"
                onChange={(e) => { if (e.target.files) void handleUploadFiles(e.target.files); e.target.value = ''; }}
              />
            </div>

            {uploading && (
              <div className="mt-3 flex items-center gap-2 text-xs text-[#C9BCFF]">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>{uploadStatus}</span>
              </div>
            )}
            {!uploading && uploadStatus && (
              <p className="mt-3 text-xs text-emerald-400">{uploadStatus}</p>
            )}

            {showCloudInput && (
              <div className="mt-4 space-y-2 rounded-xl border border-[#303441] bg-[#11141C] p-3.5">
                <label className="block text-xs font-medium text-[#D2D7E5]">
                  Paste cloud folder links
                </label>
                <textarea
                  rows={2}
                  value={cloudLinksText}
                  onChange={(e) => setCloudLinksText(e.target.value)}
                  placeholder="Paste Google Drive, OneDrive, Dropbox, or other supported folder links — one per line."
                  className="w-full rounded-lg border border-[#3B4052] bg-[#0B0D12] px-3 py-2 text-xs text-[#F5F5F8] placeholder:text-[#6E778C] focus:border-[#9A83FF] focus:outline-none"
                />
                <div className="flex items-center justify-between text-[11px] text-[#A6AFC0]">
                  <span>A folder link is a source, not an imported file. Connect the account and import playable footage before generating.</span>
                  <Link href="/drives" className="text-[#9A83FF] hover:underline">
                    Manage Cloud Drives →
                  </Link>
                </div>
              </div>
            )}

            {/* Uploaded media strip */}
            {media.length > 0 && (
              <div className="mt-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium text-[#A6AFC0]">
                    Project footage ({media.length} file{media.length === 1 ? '' : 's'})
                  </span>
                  <Link href="/library" className="text-xs text-[#9A83FF] hover:underline">
                    Open Media Library
                  </Link>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 max-h-56 overflow-y-auto pr-1">
                  {media.map((item) => {
                    const selected = selectedAssetIds.includes(item.id);
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => {
                          setSelectedAssetIds((prev) =>
                            prev.includes(item.id)
                              ? prev.filter((id) => id !== item.id)
                              : [...prev, item.id]
                          );
                        }}
                        className={`group text-left rounded-xl border p-2 transition-colors ${
                          selected
                            ? 'border-[#9A83FF] bg-[#241F3A]'
                            : 'border-[#303441] bg-[#11141C] hover:border-[#4A5064]'
                        }`}
                      >
                        <div className="relative h-20 w-full overflow-hidden rounded-lg bg-[#07090D] mb-1.5 flex items-center justify-center">
                          {item.thumbnailUrl ? (
                            <img
                              src={item.thumbnailUrl}
                              alt={item.fileName}
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <span className="text-[10px] uppercase tracking-wider text-[#A6AFC0]">
                              {item.kind}
                            </span>
                          )}
                          {item.probe?.durationSec ? (
                            <span className="absolute bottom-1 right-1 rounded bg-black/75 px-1.5 py-0.5 text-[10px] font-mono">
                              {item.probe.durationSec.toFixed(1)}s
                            </span>
                          ) : null}
                        </div>
                        <p className="truncate text-xs font-medium text-[#F5F5F8]">{item.fileName}</p>
                        <p className="truncate text-[10px] text-[#A6AFC0]">
                          {item.decodable ? `${item.kind} · ready` : `${item.kind} · reference only`}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </section>

          {/* STEP 2: Describe your reel (optional) + Reference Images */}
          <section className="rounded-2xl border border-[#303441] bg-[#171A23] p-5 space-y-4">
            <div>
              <h2 className="text-base font-semibold">
                2. Describe your reel <span className="text-xs font-normal text-[#A6AFC0]">(optional)</span>
              </h2>
              <p className="text-xs text-[#A6AFC0]">
                Describe your reel in your own words. Attach optional visual references. Automatic subject matching is not yet verified; unverified requirements will not be silently ignored.
              </p>
            </div>

            <div className="space-y-2.5">
              <label htmlFor="brief-input" className="sr-only">
                Describe your reel
              </label>
              <textarea
                id="brief-input"
                rows={3}
                value={brief}
                onChange={(e) => setBrief(e.target.value)}
                placeholder="Create a 30-second energetic reel featuring the person in my reference photo, using only footage where they are visible."
                className="w-full rounded-xl border border-[#3B4052] bg-[#0E1118] px-3.5 py-3 text-sm text-[#F5F5F8] placeholder:text-[#6E778C] focus:border-[#9A83FF] focus:outline-none"
              />

              <label className="flex items-start gap-2 text-xs text-[#C7CDD9] cursor-pointer">
                <input type="checkbox" checked={consentConfirmed} onChange={(e) => setConsentConfirmed(e.target.checked)} className="mt-0.5 accent-[#9A83FF]" />
                <span><ShieldCheck className="inline h-3.5 w-3.5 text-[#9A83FF] mr-1" />I have permission to process the reference images and source footage.</span>
              </label>
              {/* Inline Reference Image Attachment Control */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <button
                  type="button"
                  disabled={!consentConfirmed}
                  onClick={() => refInputRef.current?.click()}
                  className="inline-flex items-center gap-2 rounded-lg border border-[#4E447E] bg-[#221D3A] hover:bg-[#2D264D] px-3 py-1.5 text-xs font-semibold text-[#DDD4FF]"
                >
                  <ImagePlus className="h-3.5 w-3.5" />
                  Add reference images
                </button>
                <span className="text-[11px] text-[#A6AFC0]">
                  No description? We&apos;ll select the strongest moments automatically.
                </span>
                <input
                  ref={refInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => { void handleUploadReferences(e.target.files); e.target.value = ''; }}
                />
                <input
                  ref={replaceRefInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => handleReplaceReference(e.target.files)}
                />
              </div>

              {/* Attached Reference Images with role labels, replace, and remove controls */}
              {references.length > 0 && (
                <div className="space-y-2.5 rounded-xl border border-[#303441] bg-[#11141C] p-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {references.map((ref) => (
                      <div
                        key={ref.id}
                        className="flex items-start gap-2.5 rounded-lg border border-[#303441] bg-[#171A23] p-2"
                      >
                        <img
                          src={ref.previewUrl}
                          alt={ref.label}
                          className="h-14 w-14 rounded-md object-cover shrink-0 bg-black"
                        />
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex items-center justify-between gap-1">
                            <p className="truncate text-xs font-medium">{ref.label}</p>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <button
                                type="button"
                                aria-label={`Replace ${ref.label}`}
                                onClick={() => {
                                  setReplacingRefId(ref.id);
                                  replaceRefInputRef.current?.click();
                                }}
                                className="text-[10px] text-[#C7BAFF] hover:underline"
                              >
                                Replace
                              </button>
                              <button
                                type="button"
                                aria-label={`Remove ${ref.label}`}
                                onClick={() => removeRef(ref.id)}
                                className="text-[#A6AFC0] hover:text-rose-400"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>
                          <select
                            value={ref.role}
                            onChange={(e) => updateRefRole(ref.id, e.target.value as ReferenceRoleType)}
                            className="w-full rounded border border-[#3B4052] bg-[#0B0D12] px-2 py-1 text-[11px] text-[#F5F5F8]"
                          >
                            {ROLE_OPTIONS.map((opt) => (
                              <option key={opt.value} value={opt.value}>
                                {opt.label}
                              </option>
                            ))}
                          </select>
                          <p className="text-[10px] text-[#A6AFC0] truncate">{ref.qualityNotes}</p>
                        </div>
                      </div>
                    ))}
                  </div>

                </div>
              )}

              {/* Optional quick chips */}
              <div className="flex flex-wrap gap-1.5 pt-1">
                {QUICK_CHIPS.map((chip) => (
                  <button
                    key={chip}
                    type="button"
                    onClick={() => toggleChip(chip)}
                    className="rounded-full border border-[#303441] bg-[#222633] hover:border-[#9A83FF]/60 hover:text-[#E6DFFF] px-2.5 py-1 text-[11px] text-[#A6AFC0] transition-colors"
                  >
                    + {chip}
                  </button>
                ))}
              </div>
            </div>

            {/* Collapsed Advanced Settings */}
            <div className="border-t border-[#303441] pt-3">
              <button
                type="button"
                onClick={() => setShowAdvanced((v) => !v)}
                className="flex w-full items-center justify-between text-xs font-medium text-[#C7BAFF]"
              >
                <span>
                  Advanced settings ({durationSec} sec · {aspectRatio === '9:16' ? 'Vertical' : aspectRatio === '16:9' ? 'Landscape' : 'Square'} · {mode === 'autopilot' ? 'Autopilot' : 'Copilot'})
                </span>
                {showAdvanced ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </button>

              {showAdvanced && (
                <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div>
                    <label className="block text-[11px] text-[#A6AFC0] mb-1">Duration</label>
                    <select
                      value={durationSec}
                      onChange={(e) => setDurationSec(Number(e.target.value))}
                      className="w-full rounded-lg border border-[#3B4052] bg-[#0B0D12] px-2.5 py-1.5 text-xs"
                    >
                      <option value={15}>15 sec</option>
                      <option value={30}>30 sec</option>
                      <option value={60}>60 sec</option>
                      <option value={90}>90 sec</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] text-[#A6AFC0] mb-1">Aspect ratio</label>
                    <select
                      value={aspectRatio}
                      onChange={(e) => setAspectRatio(e.target.value as AspectRatio)}
                      className="w-full rounded-lg border border-[#3B4052] bg-[#0B0D12] px-2.5 py-1.5 text-xs"
                    >
                      <option value="9:16">Vertical 9:16</option>
                      <option value="16:9">Landscape 16:9</option>
                      <option value="1:1">Square 1:1</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] text-[#A6AFC0] mb-1">Resolution</label>
                    <select
                      value={resolution}
                      onChange={(e) => setResolution(e.target.value as ResolutionPreset)}
                      className="w-full rounded-lg border border-[#3B4052] bg-[#0B0D12] px-2.5 py-1.5 text-xs"
                    >
                      <option value="720p">720p HD</option>
                      <option value="1080p">1080p Full HD</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] text-[#A6AFC0] mb-1">Mode</label>
                    <select
                      value={mode}
                      onChange={(e) => setMode(e.target.value as EditMode)}
                      className="w-full rounded-lg border border-[#3B4052] bg-[#0B0D12] px-2.5 py-1.5 text-xs"
                    >
                      <option value="autopilot">Autopilot</option>
                      <option value="copilot">Copilot</option>
                    </select>
                  </div>
                </div>
              )}
            </div>

            {errorMsg && (
              <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-200 flex items-start gap-2">
                <XCircle className="h-4 w-4 shrink-0 mt-0.5 text-rose-400" />
                <span>{errorMsg}</span>
              </div>
            )}

            {clarificationQ && (
              <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3.5 text-xs text-amber-100 space-y-2">
                <div className="flex items-center gap-2 font-semibold text-amber-300">
                  <AlertTriangle className="h-4 w-4" />
                  Clarification needed before generating
                </div>
                <p>{clarificationQ}</p>
                <p className="text-[11px] text-amber-200/80">
                  Update your description or reference roles above, then press Generate Reel again.
                </p>
              </div>
            )}

            <button
              type="button"
              disabled={!canGenerate}
              onClick={handleGenerate}
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-[#9A83FF] hover:bg-[#AE9BFF] disabled:opacity-40 disabled:cursor-not-allowed px-5 py-3.5 text-sm font-bold text-[#0F0B20] transition-colors"
            >
              {generating ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Creating your reel…
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  Generate Reel
                </>
              )}
            </button>
          </section>
        </div>

        {/* Right column: Live Pipeline Progress OR Preview, Compliance Report & Copilot Refine */}
        <div className="lg:col-span-5 space-y-5">
          {generating ? (
            <section className="rounded-2xl border border-[#303441] bg-[#171A23] p-6 space-y-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-lg font-semibold">Creating your reel</h2>
                <button
                  type="button"
                  onClick={handleCancelGenerate}
                  className="rounded-lg border border-[#3B4052] bg-[#222633] hover:bg-[#2C3142] px-3 py-1 text-xs font-medium text-[#F5F5F8]"
                >
                  Cancel
                </button>
              </div>
              <p className="text-xs text-[#A6AFC0]">
                Analyzing available footage and preparing the edit. Rendering requires an available FFmpeg worker.
              </p>
              <div role="status" aria-live="polite" className="flex items-center gap-3 text-sm text-[#C7CDD9]"><Loader2 className="h-4 w-4 animate-spin text-[#9A83FF]" /> Waiting for the generation service. Verified stage updates are not available yet.</div>
            </section>
          ) : generatedProject && generatedProject.latestArtifact ? (
            <section className="rounded-2xl border border-[#303441] bg-[#171A23] p-5 space-y-4">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h2 className="text-base font-semibold">Preview &amp; download</h2>
                  <p className="text-xs text-[#A6AFC0]">
                    {generatedProject.latestArtifact.width}×{generatedProject.latestArtifact.height} ·{' '}
                    {generatedProject.latestArtifact.videoCodec.toUpperCase()}/
                    {(generatedProject.latestArtifact.audioCodec || 'AAC').toUpperCase()} MP4 ·{' '}
                    {generatedProject.latestArtifact.durationSec}s · v{generatedProject.activeVersion}
                  </p>
                </div>
                <span className="rounded-full bg-emerald-500/15 border border-emerald-500/40 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-300">
                  {generatedProject.latestArtifact.qaPassed ? 'QA Verified' : 'Needs Review'}
                </span>
              </div>

              <video
                key={generatedProject.latestArtifact.downloadUrl}
                src={generatedProject.latestArtifact.downloadUrl}
                controls
                playsInline
                className="w-full max-h-[420px] rounded-xl bg-black object-contain border border-[#303441]"
              />

              {/* Primary actions */}
              <div className="grid grid-cols-2 gap-2.5">
                <a
                  href={`${generatedProject.latestArtifact.downloadUrl}?download=1`}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#9A83FF] hover:bg-[#AE9BFF] px-4 py-2.5 text-xs font-bold text-[#0F0B20]"
                >
                  <Download className="h-4 w-4" />
                  Download Reel
                </a>
                <Link
                  href={`/editor/${generatedProject.id}`}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-[#3B4052] bg-[#222633] hover:bg-[#2C3142] px-4 py-2.5 text-xs font-semibold text-[#F5F5F8]"
                >
                  <SlidersHorizontal className="h-4 w-4" />
                  Open Editor
                </Link>
                <button
                  type="button"
                  disabled={generating || revising}
                  onClick={handleGenerate}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-[#303441] bg-[#11141C] hover:bg-[#1C202C] px-4 py-2 text-xs font-medium text-[#D5D9E6]"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  Regenerate
                </button>
                <button
                  type="button"
                  disabled={revising}
                  onClick={() => handleCopilotRevise('alternative')}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-[#303441] bg-[#11141C] hover:bg-[#1C202C] px-4 py-2 text-xs font-medium text-[#D5D9E6]"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${revising ? 'animate-spin' : ''}`} />
                  Create Alternative
                </button>
              </div>

              {/* Natural-language Copilot refinement */}
              <div className="rounded-xl border border-[#303441] bg-[#11141C] p-3.5 space-y-2">
                <label className="block text-xs font-semibold text-[#E5E7F0]">Make changes in plain language</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={copilotInput}
                    onChange={(e) => setCopilotInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleCopilotRevise('copilot')}
                    placeholder="e.g. Make it 15 seconds, replace the second clip, or make the ending stronger"
                    className="flex-1 rounded-lg border border-[#3B4052] bg-[#0B0D12] px-3 py-2 text-xs text-[#F5F5F8] placeholder:text-[#6E778C] focus:border-[#9A83FF] focus:outline-none"
                  />
                  <button
                    type="button"
                    disabled={revising || !copilotInput.trim()}
                    onClick={() => handleCopilotRevise('copilot')}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[#9A83FF] hover:bg-[#AE9BFF] disabled:opacity-40 px-3 py-2 text-xs font-bold text-[#0F0B20]"
                  >
                    {revising ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                    Apply
                  </button>
                </div>
                {revisionNote && <p className="text-[11px] text-emerald-400">{revisionNote}</p>}
              </div>

              {/* User-readable Compliance Report */}
              <div className="rounded-xl border border-[#303441] bg-[#11141C] p-3.5 space-y-2.5 text-xs">
                <h3 className="font-semibold text-[#E5E7F0]">Requirements checklist</h3>
                {generatedProject.latestArtifact.complianceReport.insufficientFootageNotice && (
                  <p className="rounded-lg bg-amber-500/10 border border-amber-500/30 p-2 text-amber-200 text-[11px]">
                    {generatedProject.latestArtifact.complianceReport.insufficientFootageNotice}
                  </p>
                )}
                {generatedProject.latestArtifact.complianceReport.requirementsMet.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-400">
                      Requirements met
                    </p>
                    {generatedProject.latestArtifact.complianceReport.requirementsMet.map((item) => (
                      <div key={item.constraintId} className="flex items-start gap-2 text-[#D5D9E6]">
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0 mt-0.5" />
                        <span>{item.label}</span>
                      </div>
                    ))}
                  </div>
                )}
                {generatedProject.latestArtifact.complianceReport.needsReview.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-400">
                      Needs review
                    </p>
                    {generatedProject.latestArtifact.complianceReport.needsReview.map((item) => (
                      <div key={item.constraintId} className="flex items-start gap-2 text-amber-100">
                        <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0 mt-0.5" />
                        <span>
                          {item.label} — <span className="text-amber-200/80">{item.evidence}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                {generatedProject.latestArtifact.complianceReport.couldNotBeSatisfied.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-rose-400">
                      Could not be satisfied
                    </p>
                    {generatedProject.latestArtifact.complianceReport.couldNotBeSatisfied.map((item) => (
                      <div key={item.constraintId} className="flex items-start gap-2 text-rose-100">
                        <XCircle className="h-3.5 w-3.5 text-rose-400 shrink-0 mt-0.5" />
                        <span>
                          {item.label} — <span className="text-rose-200/80">{item.evidence}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>
          ) : (
            <section className="rounded-2xl border border-[#303441] bg-[#171A23] p-6 space-y-4">
              <h2 className="text-base font-semibold">How Reel Gen works</h2>
              <ol className="space-y-3 text-xs text-[#A6AFC0]">
                <li className="flex gap-2.5">
                  <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#2E284B] text-[#D7CDFF] font-bold">
                    1
                  </span>
                  <span>Add raw videos, folders, or cloud links — indexing and FFprobe analysis start automatically.</span>
                </li>
                <li className="flex gap-2.5">
                  <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#2E284B] text-[#D7CDFF] font-bold">
                    2
                  </span>
                  <span>Optionally describe your reel and attach reference images for specific people, products, or styles.</span>
                </li>
                <li className="flex gap-2.5">
                  <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#2E284B] text-[#D7CDFF] font-bold">
                    3
                  </span>
                  <span>Press Generate Reel to assemble a story-driven timeline, render an H.264/AAC MP4, and verify every requirement.</span>
                </li>
              </ol>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
