import test from 'node:test';import assert from 'node:assert/strict';import {classifyFile,buildIntakeManifest,minimalCreationRequest,DEFAULT_REEL} from '../src/media-intake.mjs';
test('accepts common and professional video containers',()=>{for(const x of ['a.mp4','a.MOV','a.mkv','a.mxf','a.braw','a.r3d'])assert.equal(classifyFile(x),'video')});
test('accepts audio images documents and archives',()=>{for(const [f,t] of [['a.wav','audio'],['a.heic','image'],['a.pdf','document'],['a.zip','archive']])assert.equal(classifyFile(f),t)});
test('unknown formats are accepted but not falsely called playable',()=>{assert.equal(classifyFile('capture.custom'),'other');assert.equal(buildIntakeManifest([{name:'capture.custom',size:100}])[0].processing,'retain-as-asset')});
test('creates a minimal request with defaults',()=>{let r=minimalCreationRequest({files:[{name:'a.mov',size:5}]});assert.equal(r.settings.durationSeconds,30);assert.equal(r.settings.aspectRatio,'9:16');assert.equal(r.sources.files[0].processing,'probe-and-transcode')});
test('folder links alone are sufficient',()=>assert.equal(minimalCreationRequest({folderLinks:['https://drive.google.com/drive/folders/abc']}).sources.files.length,0));
test('requires at least one source',()=>assert.throws(()=>minimalCreationRequest(),/Add files/));
test('invalid sizes are rejected',()=>assert.throws(()=>buildIntakeManifest([{name:'x.mp4',size:-1}]),/Invalid file size/));
