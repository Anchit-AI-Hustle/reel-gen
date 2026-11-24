import path from 'node:path';
import type { MediaKind } from '@/types/reel-gen';

const VIDEO_EXTS = new Set([
  '.mp4', '.mov', '.mkv', '.avi', '.webm', '.m4v', '.mts', '.m2ts', '.mxf', '.ts', '.3gp', '.flv', '.wmv', '.ogv', '.prores',
]);
const DECODABLE_VIDEO_EXTS = new Set([
  '.mp4', '.mov', '.mkv', '.avi', '.webm', '.m4v', '.mts', '.m2ts', '.ts', '.3gp', '.flv', '.ogv',
]);
const IMAGE_EXTS = new Set([
  '.jpg', '.jpeg', '.png', '.webp', '.gif', '.tiff', '.tif', '.heic', '.heif', '.bmp', '.dng', '.cr2', '.nef', '.arw', '.raw', '.svg',
]);
const DECODABLE_IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.tiff', '.tif']);
const AUDIO_EXTS = new Set(['.mp3', '.wav', '.flac', '.aac', '.m4a', '.ogg', '.opus', '.aiff', '.wma']);
const DOC_EXTS = new Set(['.pdf', '.docx', '.doc', '.txt', '.md', '.csv', '.json', '.xml', '.srt', '.vtt', '.edl', '.fcpxml']);
const ARCHIVE_EXTS = new Set(['.zip', '.tar', '.gz', '.7z', '.rar', '.tgz']);

export interface FileClassificationResult {
  fileName: string;
  extension: string;
  mimeType: string;
  kind: MediaKind;
  decodable: boolean;
  compatibilityNote: string;
}

export function detectMagicKind(headerBytes?: Uint8Array | Buffer): MediaKind | null {
  if (!headerBytes || headerBytes.length < 4) return null;
  const b0 = headerBytes[0];
  const b1 = headerBytes[1];
  const b2 = headerBytes[2];
  const b3 = headerBytes[3];

  // PNG
  if (b0 === 0x89 && b1 === 0x50 && b2 === 0x4e && b3 === 0x47) return 'image';
  // JPEG
  if (b0 === 0xff && b1 === 0xd8 && b2 === 0xff) return 'image';
  // GIF
  if (b0 === 0x47 && b1 === 0x49 && b2 === 0x46 && b3 === 0x38) return 'image';
  // ZIP
  if (b0 === 0x50 && b1 === 0x4b && (b2 === 0x03 || b2 === 0x05)) return 'archive';
  // PDF
  if (b0 === 0x25 && b1 === 0x50 && b2 === 0x44 && b3 === 0x46) return 'document';
  // MP4 / MOV ftyp
  if (headerBytes.length >= 8 && headerBytes[4] === 0x66 && headerBytes[5] === 0x74 && headerBytes[6] === 0x79 && headerBytes[7] === 0x70) {
    return 'video';
  }
  // WebM / MKV EBML
  if (b0 === 0x1a && b1 === 0x45 && b2 === 0xdf && b3 === 0xa3) return 'video';
  // WAV / AVI RIFF
  if (b0 === 0x52 && b1 === 0x49 && b2 === 0x46 && b3 === 0x46 && headerBytes.length >= 12) {
    const sub = String.fromCharCode(headerBytes[8], headerBytes[9], headerBytes[10], headerBytes[11]);
    if (sub === 'WAVE') return 'audio';
    if (sub === 'AVI ') return 'video';
    if (sub === 'WEBP') return 'image';
  }
  // MP3 ID3 or frame sync
  if ((b0 === 0x49 && b1 === 0x44 && b2 === 0x33) || (b0 === 0xff && (b1 & 0xe0) === 0xe0)) return 'audio';
  return null;
}

export function classifyUploadedFile(
  fileName: string,
  mimeType = 'application/octet-stream',
  headerBytes?: Uint8Array | Buffer
): FileClassificationResult {
  const ext = path.extname(fileName).toLowerCase();
  const magic = detectMagicKind(headerBytes);

  if (magic === 'video' || VIDEO_EXTS.has(ext) || mimeType.startsWith('video/')) {
    const decodable = DECODABLE_VIDEO_EXTS.has(ext) || magic === 'video';
    return {
      fileName,
      extension: ext,
      mimeType: mimeType || 'video/mp4',
      kind: 'video',
      decodable,
      compatibilityNote: decodable
        ? 'Supported video asset ready for FFprobe and proxy processing.'
        : 'Professional/raw video container accepted as project asset; may require transcoding.',
    };
  }

  if (magic === 'image' || IMAGE_EXTS.has(ext) || mimeType.startsWith('image/')) {
    const decodable = DECODABLE_IMAGE_EXTS.has(ext) || magic === 'image';
    return {
      fileName,
      extension: ext,
      mimeType: mimeType || 'image/jpeg',
      kind: 'image',
      decodable,
      compatibilityNote: decodable
        ? 'Supported image asset ready for preview or reference matching.'
        : 'RAW/HEIC camera image accepted as project asset; browser preview may require conversion.',
    };
  }

  if (magic === 'audio' || AUDIO_EXTS.has(ext) || mimeType.startsWith('audio/')) {
    return {
      fileName,
      extension: ext,
      mimeType: mimeType || 'audio/mpeg',
      kind: 'audio',
      decodable: true,
      compatibilityNote: 'Audio asset ready for waveform, transcription, or soundtrack mixing.',
    };
  }

  if (magic === 'document' || DOC_EXTS.has(ext) || mimeType.startsWith('text/') || mimeType === 'application/pdf') {
    return {
      fileName,
      extension: ext,
      mimeType: mimeType || 'application/octet-stream',
      kind: 'document',
      decodable: false,
      compatibilityNote: 'Document/caption/project file stored as reference asset (not video footage).',
    };
  }

  if (magic === 'archive' || ARCHIVE_EXTS.has(ext)) {
    return {
      fileName,
      extension: ext,
      mimeType: mimeType || 'application/zip',
      kind: 'archive',
      decodable: false,
      compatibilityNote: 'Archive accepted as project asset; safe extraction enforces path traversal and zip-bomb limits.',
    };
  }

  return {
    fileName,
    extension: ext,
    mimeType: mimeType || 'application/octet-stream',
    kind: 'unknown',
    decodable: false,
    compatibilityNote: 'Unknown file format retained as project reference asset (not marked playable).',
  };
}

export interface InferredShootInfo {
  shootName: string;
  clientName: string | null;
  shootDate: string | null;
  location: string | null;
  cameraLabel: string | null;
}

/**
 * Infers shoot metadata from folder paths like "Client/2026-11-15_Goa/Camera A/Clip001.mov"
 * without confusing upload timestamps with capture dates.
 */
export function inferShootMetadata(relativePath: string): InferredShootInfo {
  const normalized = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
  const parts = normalized.split('/').filter(Boolean);
  const dirs = parts.slice(0, -1);

  let shootDate: string | null = null;
  let location: string | null = null;
  let cameraLabel: string | null = null;
  let clientName: string | null = null;

  for (const seg of dirs) {
    const dateLoc = seg.match(/(\d{4}[-_]\d{2}[-_]\d{2})(?:[-_\s]+([A-Za-z][A-Za-z0-9\s-]{1,40}))?/);
    if (dateLoc && !shootDate) {
      shootDate = dateLoc[1].replace(/_/g, '-');
      if (dateLoc[2]) {
        location = dateLoc[2].replace(/[_-]+/g, ' ').trim();
      }
      continue;
    }
    if (/^(cam(?:era)?[\s_-]*[a-z0-9]+|drone|gopro|fx3|a7s|red|arri|iphone|b-cam|a-cam)/i.test(seg)) {
      cameraLabel = seg.replace(/[_-]+/g, ' ').trim();
      continue;
    }
    if (!clientName && seg.length > 1 && !/^(raw|footage|clips|media|video|uploads)$/i.test(seg)) {
      clientName = seg.replace(/[_-]+/g, ' ').trim();
    }
  }

  // Also check filename for drone/camera hint
  const baseName = parts[parts.length - 1] || '';
  if (!cameraLabel && /(drone|dji|mavic|fpv)/i.test(baseName)) {
    cameraLabel = 'Drone';
  }

  const shootNameParts = [clientName, shootDate, location].filter(Boolean);
  const shootName = shootNameParts.length > 0 ? shootNameParts.join(' · ') : 'Direct Upload Shoot';

  return {
    shootName,
    clientName,
    shootDate,
    location,
    cameraLabel,
  };
}

export function validateArchiveEntrySafety(
  entryPath: string,
  uncompressedBytes: number,
  compressedBytes: number
): { safe: boolean; reason?: string } {
  const normalized = entryPath.replace(/\\/g, '/');
  if (normalized.startsWith('/') || normalized.includes('../') || normalized === '..') {
    return { safe: false, reason: 'Path traversal detected in archive entry' };
  }
  const MAX_ENTRY_BYTES = 500 * 1024 * 1024;
  if (uncompressedBytes > MAX_ENTRY_BYTES) {
    return { safe: false, reason: 'Archive entry exceeds 500MB safety ceiling' };
  }
  if (compressedBytes > 0 && uncompressedBytes / compressedBytes > 100) {
    return { safe: false, reason: 'Potential zip-bomb compression ratio (>100x) rejected' };
  }
  return { safe: true };
}
