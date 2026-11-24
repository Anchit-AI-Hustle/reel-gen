import {spawn} from 'node:child_process';
import {mkdtemp,readdir,writeFile,rm} from 'node:fs/promises';
import {join,resolve,extname,relative} from 'node:path';
import {tmpdir} from 'node:os';
const videoExts=new Set(['.mp4','.mov','.mkv','.avi','.webm','.m4v','.mts','.m2ts','.mpg','.mpeg','.3gp','.ts','.mxf']);
export const dimensions={'9:16':[720,1280],'16:9':[1280,720],'1:1':[900,900]};
export async function run(command,args,timeoutMs=180000){return new Promise((ok,bad)=>{let out='',err='';const child=spawn(command,args,{stdio:['ignore','pipe','pipe']});let timeout=setTimeout(()=>child.kill('SIGKILL'),timeoutMs);child.stdout.on('data',d=>out+=d.toString());child.stderr.on('data',d=>err+=d.toString());child.on('error',e=>{clearTimeout(timeout);bad(e)});child.on('close',code=>{clearTimeout(timeout);if(code!==0)bad(Error(`${command} failed (${code}): ${err.slice(-1000)}`));else ok({stdout:out,stderr:err})})})}
export async function discoverVideos(folder,maxFiles=10000){let root=resolve(folder),result=[],queue=[root];while(queue.length){let dir=queue.shift();for(let entry of await readdir(dir,{withFileTypes:true})){if(entry.isSymbolicLink())continue;const p=join(dir,entry.name);if(entry.isDirectory())queue.push(p);else if(entry.isFile()&&videoExts.has(extname(entry.name).toLowerCase())){result.push(p);if(result.length>maxFiles)throw Error('Too many video files')}}}return result.sort()}
export async function probeVideo(file){const {stdout}=await run('ffprobe',['-v','error','-show_format','-show_streams','-of','json',file],25000);const parsed=JSON.parse(stdout),video=parsed.streams?.find(s=>s.codec_type==='video'),audio=parsed.streams?.some(s=>s.codec_type==='audio');const duration=Number(parsed.format?.duration||video?.duration);if(!video||!Number.isFinite(duration)||duration<=0)throw Error('Not a decodable video: '+file);return {file,duration,width:video.width,height:video.height,audio,codec:video.codec_name}}
/** Scene boundaries are detected by FFmpeg, not semantic AI. */
export async function detectSceneTimes(file,duration,threshold=0.3){try{let {stderr}=await run('ffmpeg',['-hide_banner','-i',file,'-vf',`select=gt(scene\\,${threshold}),showinfo`,'-an','-f','null','-'],90000);return Array.from(stderr.matchAll(/pts_time:\s*([0-9.]+)/g),m=>Number(m[1])).filter(t=>t>0.5&&t<duration-0.5).slice(0,400)}catch{return []}}
/** Real deterministic rough-cut selection, not an AI quality or narrative ranking. */
export function buildRoughCut(probes,{durationSeconds=30,maxClipSeconds=5,aspectRatio='9:16'}={}){
 if(!dimensions[aspectRatio])throw Error('Unsupported aspect ratio');
 if(!probes.length)throw Error('No decodable video clips');
 let target=Number(durationSeconds);
 if(!(target>0&&target<=600))throw Error('Invalid reel duration');
 let ordered=probes.filter(p=>Number.isFinite(p.duration)&&p.duration>0).sort((a,b)=>a.file.localeCompare(b.file));
 if(!ordered.length)throw Error('No usable source duration');
 target=Math.min(target,ordered.reduce((sum,p)=>sum+p.duration,0));
 let clips=[],elapsed=0,remaining=ordered.map(p=>({p,cursor:0}));
 while(elapsed<target-0.04&&remaining.length){
  let next=[];
  for(let item of remaining){
   let duration=Math.min(maxClipSeconds,item.p.duration-item.cursor,target-elapsed);
   if(duration<=0.02)continue;
   clips.push({file:item.p.file,start:item.cursor,end:item.cursor+duration,sourceDuration:item.p.duration,hasAudio:item.p.audio});
   item.cursor+=duration;elapsed+=duration;
   if(item.p.duration-item.cursor>0.02)next.push(item);
   if(elapsed>=target-0.04)break;
  }
  remaining=next;
  if(clips.length>200)throw Error('Too many timeline segments');
 }
 return {aspectRatio,duration:elapsed,clips,kind:'deterministic-rough-cut',warning:'No semantic AI or human editorial approval applied'};
}
export async function renderEdl(edl,output,{preset='veryfast',crf='23',keepTemp=false}={}){if(!edl||!Array.isArray(edl.clips)||!edl.clips.length)throw Error('Missing timeline clips');const dim=dimensions[edl.aspectRatio];if(!dim)throw Error('Invalid aspect ratio');const temp=await mkdtemp(join(tmpdir(),'reelgen-'));try{let paths=[];for(let i=0;i<edl.clips.length;i++){const c=edl.clips[i],duration=Number(c.end)-Number(c.start);if(!Number.isFinite(duration)||duration<=0||duration>600||Number(c.start)<0)throw Error('Invalid clip trim');const info=await probeVideo(c.file);if(Number(c.end)>info.duration+0.1)throw Error('Timeline clip exceeds source duration');let segment=join(temp,`clip_${String(i).padStart(3,'0')}.mp4`),[w,h]=dim;
const vf=`scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=30,format=yuv420p`;
let args=['-y','-v','error','-ss',String(c.start),'-i',c.file];if(!info.audio)args.push('-f','lavfi','-i','anullsrc=r=48000:cl=stereo');args.push('-t',String(duration),'-map','0:v:0','-map',info.audio?'0:a:0':'1:a:0','-vf',vf,'-c:v','libx264','-preset',preset,'-crf',String(crf),'-c:a','aac','-ar','48000','-ac','2','-b:a','128k','-shortest','-movflags','+faststart',segment);await run('ffmpeg',args,240000);paths.push(segment)}let list=paths.map(p=>`file '${p.replace(/'/g,"'\\''")}'`).join('\n')+'\n',lst=join(temp,'concat.txt');await writeFile(lst,list);await run('ffmpeg',['-y','-v','error','-f','concat','-safe','0','-i',lst,'-c','copy','-movflags','+faststart',output],240000);const validated=await probeVideo(output);if(Math.abs(validated.duration-edl.duration)>Math.max(1.1,edl.duration*0.05))throw Error('Rendered duration did not match timeline');return {output,duration:validated.duration,width:validated.width,height:validated.height,hasAudio:validated.audio,validated:true,segments:edl.clips.length}}
finally{if(!keepTemp)await rm(temp,{recursive:true,force:true})}}
export async function createRoughCutFromFolder({input,output,duration=30,ratio='9:16'}){const files=await discoverVideos(input),probes=[];for(const f of files){try{probes.push(await probeVideo(f))}catch{}}if(!probes.length)throw Error('No decodable videos in selected folder');const edl=buildRoughCut(probes,{durationSeconds:duration,aspectRatio:ratio});let render=await renderEdl(edl,output);return {sources:probes.length,edl,render}}
