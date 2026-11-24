import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import {
  appendActivity,
  getDataDir,
  readWorkspaceState,
  writeWorkspaceState,
} from '@/lib/db/cloudflare-store';
import { classifyUploadedFile, inferShootMetadata } from '@/lib/media/intake';
import { generateThumbnail, probeMediaFile } from '@/lib/render/ffmpeg-worker';
import type { MediaAssetRecord } from '@/types/reel-gen';

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const files = formData.getAll('files') as File[];
    const relPaths = formData.getAll('relativePaths').map((v) => String(v || ''));

    if (!files || files.length === 0) {
      return NextResponse.json({ error: 'No files provided' }, { status: 400 });
    }

    const dataDir = getDataDir();
    const state = readWorkspaceState();
    const uploaded: MediaAssetRecord[] = [];
    let deduplicatedCount = 0;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const buffer = Buffer.from(await file.arrayBuffer());
      const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');

      const existing = state.media.find((m) => m.sha256 === sha256);
      if (existing) {
        uploaded.push(existing);
        deduplicatedCount++;
        continue;
      }

      const safeFileName = path.basename(file.name).replace(/[^a-zA-Z0-9._ -]/g, '_');
      const relativePath = relPaths[i] || safeFileName;
      const classification = classifyUploadedFile(safeFileName, file.type, buffer.subarray(0, 16));
      const shootInfo = inferShootMetadata(relativePath);

      const id = crypto.randomUUID();
      const storedName = `${id}_${safeFileName}`;
      const storagePath = path.join(dataDir, 'uploads', storedName);
      fs.writeFileSync(storagePath, buffer);

      let probe = null;
      let thumbnailUrl: string | null = null;
      if (classification.kind === 'video' || classification.kind === 'audio') {
        probe = await probeMediaFile(storagePath);
      }
      if (classification.kind === 'video' && probe && probe.width > 0) {
        const thumbName = `${id}.jpg`;
        const thumbPath = path.join(dataDir, 'thumbnails', thumbName);
        const ok = await generateThumbnail(storagePath, thumbPath);
        if (ok) {
          thumbnailUrl = `/api/files/thumbnails/${thumbName}`;
        }
      }

      const record: MediaAssetRecord = {
        id,
        workspaceId: state.workspaceId,
        projectId: null,
        shootId: shootInfo.shootName.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        fileName: safeFileName,
        relativePath,
        mimeType: classification.mimeType,
        kind: classification.kind,
        decodable: classification.kind === 'video' ? Boolean(probe && probe.durationSec > 0) : classification.decodable,
        sizeBytes: buffer.length,
        sha256,
        storagePath,
        previewUrl: `/api/files/uploads/${storedName}`,
        thumbnailUrl: classification.kind === 'image' && classification.decodable ? `/api/files/uploads/${storedName}` : thumbnailUrl,
        sourceProvider: 'local_upload',
        captureTimestamp: shootInfo.shootDate ? `${shootInfo.shootDate}T12:00:00.000Z` : null,
        cameraLabel: shootInfo.cameraLabel,
        locationLabel: shootInfo.location,
        shootName: shootInfo.shootName,
        availabilityStatus:
          classification.kind === 'video' && (!probe || probe.durationSec <= 0)
            ? 'unsupported_codec'
            : 'ready',
        probe,
        segments: [],
        createdAt: new Date().toISOString(),
      };

      state.media.unshift(record);
      uploaded.push(record);
    }

    appendActivity(
      state,
      'Media imported',
      `Indexed ${uploaded.length} file(s)${deduplicatedCount > 0 ? ` (${deduplicatedCount} deduplicated)` : ''}`
    );
    writeWorkspaceState(state);

    return NextResponse.json({
      assets: uploaded,
      deduplicatedCount,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Upload failed' }, { status: 500 });
  }
}
