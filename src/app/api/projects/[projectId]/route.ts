import path from 'node:path';
import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import {
  appendActivity,
  getDataDir,
  readWorkspaceState,
  writeWorkspaceState,
} from '@/lib/db/cloudflare-store';
import { applyCopilotRevision, buildStoryTimeline } from '@/lib/story/highlight-engine';
import { renderEdlToMp4 } from '@/lib/render/ffmpeg-worker';
import type { ProcessingJobRecord, TimelineEdl } from '@/types/reel-gen';

export async function GET(
  _request: Request,
  context: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await context.params;
  const state = readWorkspaceState();
  const project = state.projects.find((p) => p.id === projectId);
  if (!project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }
  return NextResponse.json({ project, media: state.media });
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await context.params;
    const body = await request.json();
    const state = readWorkspaceState();
    const project = state.projects.find((p) => p.id === projectId);
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    if (body.edl) {
      const nextEdl = body.edl as TimelineEdl;
      const nextVersion = project.versions.length + 1;
      nextEdl.version = nextVersion;
      project.currentEdl = nextEdl;
      project.activeVersion = nextVersion;
      project.versions.unshift({
        version: nextVersion,
        label: body.label || `Manual Edit v${nextVersion}`,
        edl: nextEdl,
        prompt: null,
        createdAt: new Date().toISOString(),
      });
      project.updatedAt = new Date().toISOString();
      appendActivity(state, 'Timeline saved', `Saved ${project.title} v${nextVersion}`, project.id);
      writeWorkspaceState(state);
    }

    return NextResponse.json({ project });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Update failed' }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await context.params;
    const body = await request.json();
    const action = String(body.action || 'copilot');
    const state = readWorkspaceState();
    const project = state.projects.find((p) => p.id === projectId);
    if (!project || !project.currentEdl) {
      return NextResponse.json({ error: 'Project or timeline not found' }, { status: 404 });
    }

    let nextEdl: TimelineEdl = project.currentEdl;
    let summary = 'Re-rendered current timeline';
    let label = `Export v${project.versions.length + 1}`;

    if (action === 'copilot') {
      const prompt = String(body.prompt || '').trim();
      if (!prompt) {
        return NextResponse.json({ error: 'Copilot instruction is required' }, { status: 400 });
      }
      const rev = applyCopilotRevision({
        edl: project.currentEdl,
        prompt,
        assets: state.media,
        references: project.references,
      });
      nextEdl = rev.updatedEdl;
      summary = rev.summary;
      label = `Copilot: ${prompt.slice(0, 36)}`;
    } else if (action === 'alternative') {
      if (!project.parsedInstruction) {
        return NextResponse.json({ error: 'Missing parsed brief' }, { status: 400 });
      }
      const alt = buildStoryTimeline({
        assets: state.media.filter((m) => m.kind === 'video' && m.decodable),
        parsed: project.parsedInstruction,
        references: project.references,
        resolution: project.currentEdl.resolution,
        version: project.versions.length + 1,
        variationSeed: project.versions.length + 1,
        brandText: state.settings.brandText,
      });
      nextEdl = alt.edl;
      summary = `Generated alternative cut v${nextEdl.version}`;
      label = `Alternative Cut v${nextEdl.version}`;
    } else if (action === 'render' && body.edl) {
      nextEdl = body.edl as TimelineEdl;
      nextEdl.version = project.versions.length + 1;
      label = `Rendered v${nextEdl.version}`;
    }

    const jobId = crypto.randomUUID();
    const outFileName = `reel_${project.id.slice(0, 8)}_v${nextEdl.version}.mp4`;
    const outPath = path.join(getDataDir(), 'renders', outFileName);
    const assetsById = new Map(state.media.map((a) => [a.id, a]));

    const compliance = project.latestArtifact?.complianceReport || {
      requirementsMet: [],
      needsReview: [],
      couldNotBeSatisfied: [],
      overallCompliant: true,
      insufficientFootageNotice: null,
    };

    const artifact = await renderEdlToMp4({
      edl: nextEdl,
      assetsById,
      outputPath: outPath,
      projectId: project.id,
      jobId,
      downloadUrl: `/api/files/renders/${outFileName}`,
      complianceReport: compliance,
    });

    const now = new Date().toISOString();
    const job: ProcessingJobRecord = {
      id: jobId,
      projectId: project.id,
      state: artifact.qaPassed ? 'COMPLETED' : 'FAILED',
      progressPct: 100,
      stageLabel: artifact.qaPassed ? 'Revision Rendered & Verified' : 'QA Check Failed',
      stageDetail: summary,
      errorMessage: null,
      createdAt: now,
      updatedAt: now,
      completedAt: now,
    };

    project.currentEdl = nextEdl;
    project.activeVersion = nextEdl.version;
    project.latestArtifact = artifact;
    project.latestJob = job;
    project.updatedAt = now;
    project.versions.unshift({
      version: nextEdl.version,
      label,
      edl: nextEdl,
      prompt: body.prompt || null,
      createdAt: now,
    });

    state.jobs.unshift(job);
    state.artifacts.unshift(artifact);
    appendActivity(state, action === 'copilot' ? 'Copilot revision' : 'Reel re-rendered', summary, project.id);
    writeWorkspaceState(state);

    return NextResponse.json({ project, artifact, summary });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Revision failed' }, { status: 500 });
  }
}
