'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Film, Search, Upload, FolderOpen, Sparkles, CheckCircle2, AlertCircle } from 'lucide-react';
import type { MediaAssetRecord, MediaKind } from '@/types/reel-gen';

export default function MediaLibraryPage() {
  const [media, setMedia] = useState<MediaAssetRecord[]>([]);
  const [search, setSearch] = useState('');
  const [kindFilter, setKindFilter] = useState<'all' | MediaKind>('all');
  const [uploading, setUploading] = useState(false);
  const [previewItem, setPreviewItem] = useState<MediaAssetRecord | null>(null);
  const [sortBy, setSortBy] = useState<'newest' | 'name' | 'size'>('newest');
  const fileRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);

  const loadMedia = () => {
    fetch('/api/state')
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d.media)) setMedia(d.media);
      })
      .catch(() => {});
  };

  useEffect(() => {
    loadMedia();
  }, []);

  const handleUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      const form = new FormData();
      for (const f of Array.from(files)) {
        form.append('files', f);
        form.append('relativePaths', (f as any).webkitRelativePath || f.name);
      }
      await fetch('/api/media/upload', { method: 'POST', body: form });
      loadMedia();
    } finally {
      setUploading(false);
    }
  };

  const filtered = media
    .filter((m) => {
      if (kindFilter !== 'all' && m.kind !== kindFilter) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        return (
          m.fileName.toLowerCase().includes(q) ||
          (m.shootName || '').toLowerCase().includes(q) ||
          (m.locationLabel || '').toLowerCase().includes(q) ||
          (m.cameraLabel || '').toLowerCase().includes(q)
        );
      }
      return true;
    })
    .sort((a, b) => {
      if (sortBy === 'name') return a.fileName.localeCompare(b.fileName);
      if (sortBy === 'size') return b.sizeBytes - a.sizeBytes;
      return b.createdAt.localeCompare(a.createdAt);
    });

  // Group by inferred shoot
  const grouped = filtered.reduce<Record<string, MediaAssetRecord[]>>((acc, item) => {
    const key = item.shootName || 'Direct Upload Shoot';
    if (!acc[key]) acc[key] = [];
    acc[key].push(item);
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Media Library</h1>
          <p className="mt-1 text-sm text-[#A6AFC0]">
            Browse, organize, and select footage from your shoots.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="inline-flex items-center gap-2 rounded-xl bg-[#9A83FF] hover:bg-[#AE9BFF] px-4 py-2 text-xs font-bold text-[#0F0B20]"
          >
            <Upload className="h-4 w-4" />
            {uploading ? 'Indexing…' : 'Add Media'}
          </button>
          <button
            type="button"
            onClick={() => folderRef.current?.click()}
            disabled={uploading}
            className="inline-flex items-center gap-2 rounded-xl border border-[#303441] bg-[#171A23] hover:bg-[#222633] px-4 py-2 text-xs font-semibold"
          >
            <FolderOpen className="h-4 w-4" />
            Import Folder
          </button>
          <Link
            href="/drives"
            className="inline-flex items-center gap-2 rounded-xl border border-[#303441] bg-[#171A23] hover:bg-[#222633] px-4 py-2 text-xs font-semibold"
          >
            Connect Drive
          </Link>
          <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => handleUpload(e.target.files)} />
          <input
            ref={folderRef}
            type="file"
            multiple
            // @ts-expect-error webkitdirectory is standard in modern browsers
            webkitdirectory=""
            className="hidden"
            onChange={(e) => handleUpload(e.target.files)}
          />
        </div>
      </div>

      {/* Search, Sort & Filters */}
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-[#303441] bg-[#171A23] p-4">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-[#A6AFC0]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by filename, shoot, location, or camera…"
            className="w-full rounded-lg border border-[#3B4052] bg-[#0B0D12] pl-9 pr-3 py-2 text-xs text-[#F5F5F8] focus:border-[#9A83FF] focus:outline-none"
          />
        </div>
        <select
          aria-label="Sort media"
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as 'newest' | 'name' | 'size')}
          className="rounded-lg border border-[#3B4052] bg-[#0B0D12] px-3 py-2 text-xs text-[#F5F5F8]"
        >
          <option value="newest">Sort: Newest</option>
          <option value="name">Sort: Name A–Z</option>
          <option value="size">Sort: Largest</option>
        </select>
        <div className="flex flex-wrap gap-1.5">
          {(['all', 'video', 'image', 'audio', 'document', 'archive'] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKindFilter(k)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium capitalize ${
                kindFilter === k
                  ? 'bg-[#2E284B] text-[#E3DCFF] border border-[#9A83FF]/50'
                  : 'bg-[#222633] text-[#A6AFC0] hover:text-[#F5F5F8]'
              }`}
            >
              {k}
            </button>
          ))}
        </div>
      </div>

      {/* Shoot-grouped grid */}
      {Object.keys(grouped).length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[#3B4052] bg-[#171A23] p-12 text-center space-y-3">
          <Film className="mx-auto h-8 w-8 text-[#9A83FF]" />
          <p className="text-sm font-medium">No media assets yet</p>
          <p className="text-xs text-[#A6AFC0]">
            Upload raw footage here or on the Create screen to start indexing shoots automatically.
          </p>
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-xl bg-[#9A83FF] px-4 py-2 text-xs font-bold text-[#0F0B20]"
          >
            <Sparkles className="h-3.5 w-3.5" />
            Go to Create
          </Link>
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(grouped).map(([shootName, items]) => (
            <section key={shootName} className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-[#E3DCFF]">{shootName}</h2>
                <span className="text-xs text-[#A6AFC0]">{items.length} asset(s)</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {items.map((item) => (
                  <div
                    key={item.id}
                    className="rounded-xl border border-[#303441] bg-[#171A23] overflow-hidden flex flex-col"
                  >
                    <button
                      type="button"
                      onClick={() => setPreviewItem(item)}
                      className="relative h-36 w-full bg-[#07090D] flex items-center justify-center overflow-hidden"
                    >
                      {item.thumbnailUrl ? (
                        <img src={item.thumbnailUrl} alt={item.fileName} className="h-full w-full object-cover" />
                      ) : (
                        <span className="text-xs uppercase tracking-wider text-[#A6AFC0]">{item.kind}</span>
                      )}
                      {item.probe?.durationSec ? (
                        <span className="absolute bottom-2 right-2 rounded bg-black/75 px-1.5 py-0.5 text-[10px] font-mono">
                          {item.probe.durationSec.toFixed(1)}s
                        </span>
                      ) : null}
                    </button>
                    <div className="p-3 space-y-1.5 flex-1 flex flex-col justify-between">
                      <div>
                        <p className="truncate text-xs font-semibold" title={item.fileName}>
                          {item.fileName}
                        </p>
                        <p className="text-[11px] text-[#A6AFC0] truncate">
                          {[item.cameraLabel, item.locationLabel, item.probe ? `${item.probe.width}×${item.probe.height}` : null]
                            .filter(Boolean)
                            .join(' · ') || item.mimeType}
                        </p>
                      </div>
                      <div className="flex items-center justify-between pt-2 border-t border-[#262A36] text-[10px]">
                        <span className="inline-flex items-center gap-1 text-[#A6AFC0]">
                          {item.decodable ? (
                            <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                          ) : (
                            <AlertCircle className="h-3 w-3 text-amber-400" />
                          )}
                          {item.decodable ? 'Decodable' : 'Reference asset'}
                        </span>
                        <span className="text-[#6E778C]">{(item.sizeBytes / (1024 * 1024)).toFixed(2)} MB</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {/* Preview Modal */}
      {previewItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
          <div className="w-full max-w-2xl rounded-2xl border border-[#303441] bg-[#171A23] p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold truncate">{previewItem.fileName}</h3>
              <button
                type="button"
                onClick={() => setPreviewItem(null)}
                className="rounded-lg bg-[#222633] px-3 py-1 text-xs"
              >
                Close
              </button>
            </div>
            {previewItem.kind === 'video' && previewItem.decodable ? (
              <video src={previewItem.previewUrl} controls playsInline className="w-full max-h-[60vh] rounded-xl bg-black" />
            ) : previewItem.kind === 'image' && previewItem.decodable ? (
              <img src={previewItem.previewUrl} alt={previewItem.fileName} className="w-full max-h-[60vh] rounded-xl object-contain bg-black" />
            ) : (
              <p className="text-xs text-[#A6AFC0]">
                Stored as project reference asset ({previewItem.mimeType}). Browser video preview is not applicable.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
