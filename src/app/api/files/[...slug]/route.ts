import fs from 'node:fs';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { getDataDir } from '@/lib/db/cloudflare-store';

const ALLOWED_BUCKETS = new Set(['uploads', 'references', 'renders', 'thumbnails']);

function getMime(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.mp4') return 'video/mp4';
  if (ext === '.mov') return 'video/quicktime';
  if (ext === '.webm') return 'video/webm';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.mp3') return 'audio/mpeg';
  if (ext === '.wav') return 'audio/wav';
  return 'application/octet-stream';
}

export async function GET(
  request: Request,
  context: { params: Promise<{ slug: string[] }> }
) {
  const { slug } = await context.params;
  if (!slug || slug.length !== 2) {
    return NextResponse.json({ error: 'Invalid file path' }, { status: 400 });
  }
  const [bucket, fileName] = slug;
  if (!ALLOWED_BUCKETS.has(bucket) || fileName.includes('..') || fileName.includes('/') || fileName.includes('\\')) {
    return NextResponse.json({ error: 'Forbidden path' }, { status: 403 });
  }

  const fullPath = path.join(getDataDir(), bucket, fileName);
  if (!fs.existsSync(fullPath)) {
    return NextResponse.json({ error: 'File not found' }, { status: 404 });
  }

  const stat = fs.statSync(fullPath);
  const mime = getMime(fullPath);
  const url = new URL(request.url);
  const forceDownload = url.searchParams.get('download') === '1';
  const range = request.headers.get('range');

  if (range) {
    const match = range.match(/bytes=(\d+)-(\d*)/);
    if (match) {
      const start = Number(match[1]);
      const end = match[2] ? Math.min(stat.size - 1, Number(match[2])) : stat.size - 1;
      const chunkSize = end - start + 1;
      const fd = fs.openSync(fullPath, 'r');
      const buf = Buffer.alloc(chunkSize);
      fs.readSync(fd, buf, 0, chunkSize, start);
      fs.closeSync(fd);
      return new NextResponse(buf, {
        status: 206,
        headers: {
          'Content-Range': `bytes ${start}-${end}/${stat.size}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': String(chunkSize),
          'Content-Type': mime,
        },
      });
    }
  }

  const data = fs.readFileSync(fullPath);
  return new NextResponse(data, {
    status: 200,
    headers: {
      'Content-Type': mime,
      'Content-Length': String(stat.size),
      'Accept-Ranges': 'bytes',
      ...(forceDownload ? { 'Content-Disposition': `attachment; filename="${fileName}"` } : {}),
    },
  });
}
