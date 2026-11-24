import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { getDataDir } from '@/lib/db/neon-store';
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
    const consentConfirmed = String(formData.get('consentConfirmed') || 'false') === 'true';

    if (!file) {
      return NextResponse.json({ error: 'No reference image provided' }, { status: 400 });
    }

    if (!consentConfirmed) return NextResponse.json({ error: 'Permission to process reference images must be confirmed before upload.' }, { status: 400 });
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
