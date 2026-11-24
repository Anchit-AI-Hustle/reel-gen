#!/usr/bin/env node
import {readFile,access} from 'node:fs/promises';
import {join,resolve} from 'node:path';
const root=resolve(new URL('..',import.meta.url).pathname);
const packageJson=JSON.parse(await readFile(join(root,'package.json'),'utf8'));
const files=['db/001_initial.sql','src/neon-repository.mjs','src/google-drive.mjs','src/onedrive.mjs','src/render-engine.mjs','src/media-intake.mjs','docs/GEMINI_MASTER_PROMPT.md'];
const result=[];
for(const f of files){try{await access(join(root,f));result.push({requirement:f,status:'PRESENT'})}catch{result.push({requirement:f,status:'MISSING'})}}
const supabasePackages=Object.keys({...packageJson.dependencies,...packageJson.devDependencies}).filter(x=>x.toLowerCase().includes('supabase'));
result.push({requirement:'Zero Supabase package dependencies',status:supabasePackages.length?'FAIL':'PASS'});
result.push({requirement:'Neon project live',status:process.env.DATABASE_URL?'UNVERIFIED_ENV_PRESENT':'BLOCKED_NO_DATABASE_URL'});
result.push({requirement:'Google OAuth production',status:process.env.GOOGLE_CLIENT_ID?'UNVERIFIED_ENV_PRESENT':'BLOCKED_NO_CLIENT_ID'});
result.push({requirement:'Microsoft OAuth production',status:process.env.MICROSOFT_CLIENT_ID?'UNVERIFIED_ENV_PRESENT':'BLOCKED_NO_CLIENT_ID'});
result.push({requirement:'Server-side hosted render worker',status:'NOT_IMPLEMENTED'});
result.push({requirement:'Semantic AI highlight selection',status:'NOT_IMPLEMENTED'});
result.push({requirement:'Vercel production deployment of this source',status:'NOT_DEPLOYED'});
console.log(JSON.stringify({project:'reel-gen',verifiedAt:new Date().toISOString(),results:result},null,2));
if(result.some(x=>x.status==='MISSING'||x.status==='FAIL'))process.exitCode=1;
