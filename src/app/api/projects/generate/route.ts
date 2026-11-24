import path from 'node:path';
import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import {
  appendActivity,
  getDataDir,
  readWorkspaceState,
  writeWorkspaceState,
} from '@/lib/db/neon-store';
import { parseCreativeInstruction } from '@/lib/nlp/constraint-parser';
import { analyzeVideoSegments, renderEdlToMp4 } from '@/lib/render/ffmpeg-worker';
import { buildStoryTimeline } from '@/lib/story/highlight-engine';
import type {
  AspectRatio,
  EditMode,
  ProcessingJobRecord,
  ProjectRecord,
  ReferenceAsset,
  ResolutionPreset,
} from '@/types/reel-gen';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const brief = String(body.brief || '').trim();
    const assetIds: string[] = Array.isArray(body.assetIds) ? body.assetIds : [];
    const cloudLinks: string[] = Array.isArray(body.cloudLinks) ? body.cloudLinks : [];
    const references: ReferenceAsset[] = Array.isArray(body.references) ? body.references : [];
    const defaultDurationSec = Number(body.durationSec || 30);
    const defaultAspectRatio: AspectRatio = body.aspectRatio || '9:16';
    const resolution: ResolutionPreset = body.resolution || '720p';
    const mode: EditMode = body.mode || 'autopilot';
    const style = String(body.style || 'smart');
    const allowShortenedReel = Boolean(body.allowShortenedReel ?? true);

    const state = readWorkspaceState();
    const selectedAssets =
      assetIds.length > 0
        ? state.media.filter((m) => assetIds.includes(m.id))
        : state.media.filter((m) => m.kind === 'video' && m.decodable);

    if (selectedAssets.length === 0 && cloudLinks.length === 0) {
      return NextResponse.json(
        { error: 'Please add at least one playable video file or cloud folder link before generating.' },
        { status: 400 }
      );
    }

    // 1. Parse natural-language instructions & check for contradictions
    const parsed = parseCreativeInstruction({
      prompt: brief,
      references,
      defaultDurationSec,
      defaultAspectRatio,
    });

    const projectId = crypto.randomUUID();
    const now = new Date().toISOString();
    const title = brief ? brief.slice(0, 52) + (brief.length > 52 ? '…' : '') : `Auto Reel · ${new Date().toLocaleDateString()}`;

    if (parsed.clarificationNeeded) {
      const blockedProject: ProjectRecord = {
        id: projectId,
        workspaceId: state.workspaceId,
        title,
        status: 'needs_clarification',
        brief,
        targetDurationSec: parsed.inferredDurationSec,
        aspectRatio: parsed.inferredAspectRatio,
        mode,
        style: parsed.inferredStyle || style,
        cloudLinks,
        references,
        parsedInstruction: parsed,
        currentEdl: null,
        versions: [],
        activeVersion: 0,
        latestArtifact: null,
        latestJob: null,
        createdAt: now,
        updatedAt: now,
      };
      state.projects.unshift(blockedProject);
      appendActivity(state, 'Clarification required', parsed.clarificationQuestion || 'Contradictory brief detected', projectId);
      writeWorkspaceState(state);
      return NextResponse.json({ project: blockedProject, clarificationNeeded: true, clarificationQuestion: parsed.clarificationQuestion });
    }

    const playableVideos = selectedAssets.filter((a) => a.kind === 'video' && a.decodable);
    if (playableVideos.length === 0) {
      return NextResponse.json(
        {
          error:
            'No locally decodable video footage is available yet. If you pasted cloud folder links, connect the cloud provider in Cloud Drives first so Reel Gen can import the clips.',
        },
        { status: 400 }
      );
    }

    // Check person-matching consent
    const hasPersonRef = references.some((r) => r.role === 'person_include' || r.role === 'person_exclude');
    if (hasPersonRef && references.some((r) => (r.role === 'person_include' || r.role === 'person_exclude') && !r.consentConfirmed)) {
      return NextResponse.json(
        { error: 'Please confirm you are authorized to process the attached reference photo(s) and source footage.' },
        { status: 400 }
      );
    }

    const jobId = crypto.randomUUID();
    const job: ProcessingJobRecord = {
      id: jobId,
      projectId,
      state: 'ANALYZING',
      progressPct: 35,
      stageLabel: 'Analyzing scenes & reference matches',
      stageDetail: `Inspecting ${playableVideos.length} video clip(s)`,
      errorMessage: null,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
    };

    // 2. Analyze segments for every playable video clip
    for (const asset of playableVideos) {
      asset.segments = await analyzeVideoSegments({ asset, references });
    }

    // 3. Build story EDL respecting hard constraints BEFORE ranking
    const storyResult = buildStoryTimeline({
      assets: playableVideos,
      parsed,
      references,
      resolution,
      version: 1,
      brandText: state.settings.brandText,
    });

    if (storyResult.edl.clips.length === 0) {
      job.state = 'FAILED';
      job.progressPct = 100;
      job.stageLabel = 'No qualifying footage matched strict rules';
      job.errorMessage =
        'Zero clips satisfied your strict reference/filter requirements. You can relax the constraint to soft preference or add more matching footage.';
      job.updatedAt = new Date().toISOString();
      state.jobs.unshift(job);
      writeWorkspaceState(state);
      return NextResponse.json({ error: job.errorMessage, complianceReport: storyResult.complianceReport }, { status: 422 });
    }

    if (storyResult.insufficientFootage && !allowShortenedReel) {
      return NextResponse.json(
        {
          error: storyResult.complianceReport.insufficientFootageNotice,
          availableQualifyingSec: storyResult.availableQualifyingSec,
        },
        { status: 422 }
      );
    }

    // 4. Render real H.264/AAC MP4 via FFmpeg & validate via FFprobe
    const outFileName = `reel_${projectId.slice(0, 8)}_v1.mp4`;
    const outPath = path.join(getDataDir(), 'renders', outFileName);
    const assetsById = new Map(playableVideos.map((a) => [a.id, a]));

    const artifact = await renderEdlToMp4({
      edl: storyResult.edl,
      assetsById,
      outputPath: outPath,
      projectId,
      jobId,
      downloadUrl: `/api/files/renders/${outFileName}`,
      complianceReport: storyResult.complianceReport,
    });

    const finishedAt = new Date().toISOString();
    job.state = artifact.qaPassed ? 'COMPLETED' : 'FAILED';
    job.progressPct = 100;
    job.stageLabel = artifact.qaPassed ? 'Completed & QA Verified' : 'QA Check Failed';
    job.stageDetail = `${artifact.width}x${artifact.height} ${artifact.videoCodec.toUpperCase()}/${(artifact.audioCodec || 'aac').toUpperCase()} · ${artifact.durationSec}s`;
    job.updatedAt = finishedAt;
    job.completedAt = finishedAt;

    const project: ProjectRecord = {
      id: projectId,
      workspaceId: state.workspaceId,
      title,
      status: artifact.qaPassed ? 'ready' : 'failed',
      brief,
      targetDurationSec: parsed.inferredDurationSec,
      aspectRatio: parsed.inferredAspectRatio,
      mode,
      style: parsed.inferredStyle || style,
      cloudLinks,
      references,
      parsedInstruction: parsed,
      currentEdl: storyResult.edl,
      versions: [
        {
          version: 1,
          label: 'Initial Autopilot Cut',
          edl: storyResult.edl,
          prompt: brief || 'Auto highlights',
          createdAt: finishedAt,
        },
      ],
      activeVersion: 1,
      latestArtifact: artifact,
      latestJob: job,
      createdAt: now,
      updatedAt: finishedAt,
    };

    state.projects.unshift(project);
    state.jobs.unshift(job);
    state.artifacts.unshift(artifact);
    appendActivity(
      state,
      'Reel rendered & verified',
      `${project.title} (${artifact.durationSec}s · ${artifact.aspectRatio} · ${artifact.videoCodec.toUpperCase()} MP4)`,
      projectId
    );
    writeWorkspaceState(state);

    return NextResponse.json({ project, artifact, job });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Reel generation failed' }, { status: 500 });
  }
}
