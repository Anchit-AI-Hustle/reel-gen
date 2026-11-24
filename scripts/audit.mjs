import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const requiredFiles = [
  'db/migrations/0001_initial.sql',
  'db/migrations/0002_reference_matching.sql',
  'worker/wrangler.toml',
  'src/cloudflare/d1-repository.ts',
  'src/cloudflare/storage.ts',
  'src/cloudflare/auth.ts',
  'src/cloudflare/index.ts',
  'src/lib/db/cloudflare-store.ts',
  'src/lib/nlp/constraint-parser.ts',
  'src/lib/vision/reference-matcher.ts',
  'src/lib/story/highlight-engine.ts',
  'src/lib/render/ffmpeg-worker.ts',
  'src/lib/cloud/providers.ts',
  'src/app/page.tsx',
  'src/app/library/page.tsx',
  'src/app/editor/[projectId]/page.tsx',
  'src/app/drives/page.tsx',
  'src/app/dashboard/page.tsx',
  'src/app/settings/page.tsx',
];

const results = requiredFiles.map((rel) => ({
  requirement: rel,
  status: fs.existsSync(path.join(root, rel)) ? 'PRESENT' : 'MISSING',
}));

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
const hasForbidden = Object.keys(deps).some((k) => /supabase|neon|^pg$/i.test(k));
results.push({ requirement: 'Zero Neon/Supabase/pg package dependencies', status: hasForbidden ? 'FAIL' : 'PASS' });
results.push({
  requirement: 'Cloudflare Worker API configured',
  status: process.env.CLOUDFLARE_DB_API_URL && process.env.CLOUDFLARE_DB_API_TOKEN ? 'CONFIGURED' : 'BLOCKED_PENDING_PROVISIONING',
});

console.log(JSON.stringify({ project: 'reel-gen', architecture: 'cloudflare-d1-workers-r2', verifiedAt: new Date().toISOString(), results }, null, 2));
if (results.some((r) => r.status === 'MISSING' || r.status === 'FAIL')) {
  process.exit(1);
}
