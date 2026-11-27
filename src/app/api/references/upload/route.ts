import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { getDataDir } from '@/lib/db/cloudflare-store';
import { inferReferenceRoleFromPrompt } from '@/lib/nlp/constraint-parser';
import { validateReferenceImage } from '@/lib/vision/reference-matcher';
import type { ReferenceAsset, ReferenceRoleType } from '@/types/reel-gen';

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const prompt = String(formData.get('prompt') || '');
    const explicitRole = String(formData.get('role') || '') as ReferenceRoleType | '';
    const customLabel = String(formData.get('label') || '').trim();
    const consentConfirmed = formData.get('consentConfirmed') === 'true';

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'No reference image provided' }, { status: 400 });
    }
    if (!consentConfirmed) {
      return NextResponse.json({ error: 'Confirm you are authorized to use the reference image and source footage before uploading.' }, { status: 403 });
    }
    if (!file.type.startsWith('image/') || file.size === 0 || file.size > 20 * 1024 * 1024) {
      return NextResponse.json({ error: 'Choose a valid image no larger than 20 MB.' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const id = `ref_${crypto.randomBytes(5).toString('hex')}`;
    const safeName = path.basename(file.name).replace(/[^a-zA-Z0-9._ -]/g, '_');
    const storedName = `${id}_${safeName}`;
    const storagePath = path.join(getDataDir(), 'references', storedName);
    fs.writeFileSync(storagePath, buffer);

    const roleDecision = inferReferenceRoleFromPrompt(prompt, 0, explicitRole || undefined);
    const validation = await validateReferenceImage({
      filePath: storagePath,
      fileName: safeName,
      role: roleDecision.role,
      consentConfirmed,
    });

    if (!validation.usable) {
      fs.rmSync(storagePath, { force: true });
      return NextResponse.json({ error: validation.qualityNotes || 'Reference image is unusable.' }, { status: 422 });
    }
    const asset: ReferenceAsset = {
      id,
      label: customLabel || safeName.replace(/\.[^.]+$/, ''),
      fileName: safeName,
      mimeType: file.type || 'image/jpeg',
      role: roleDecision.role,
      roleInferred: roleDecision.inferred,
      enforcement: roleDecision.enforcement,
      storagePath,
      previewUrl: `/api/files/references/${storedName}`,
      qualityScore: validation.qualityScore,
      faceCount: validation.faceCount,
      usable: validation.usable,
      qualityNotes: validation.qualityNotes,
      descriptor: validation.descriptor,
      consentConfirmed,
    };

    return NextResponse.json({ reference: asset });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Reference image upload failed' }, { status: 500 });
  }
}
