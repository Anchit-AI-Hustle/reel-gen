#!/usr/bin/env node
import {createRoughCutFromFolder} from './render-engine.mjs';
import {resolve} from 'node:path';
const args=process.argv.slice(2);const val=(name,def)=>{let i=args.indexOf(name);return i>=0?args[i+1]:def};const input=val('--input'),output=val('--output'),duration=Number(val('--duration','30')),ratio=val('--ratio','9:16');if(!input||!output){console.error('Usage: npm run render -- --input /path/to/footage --output /path/to/reel.mp4 [--duration 30] [--ratio 9:16|16:9|1:1]');process.exit(2)}try{let result=await createRoughCutFromFolder({input:resolve(input),output:resolve(output),duration,ratio});console.log(JSON.stringify(result,null,2))}catch(e){console.error(e.stack);process.exit(1)}
