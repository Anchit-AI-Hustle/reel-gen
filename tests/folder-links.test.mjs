import test from 'node:test';import assert from 'node:assert/strict';import {parseFolderLink,parseFolderLinks} from '../src/folder-links.mjs';
test('Google Drive folder',()=>assert.deepEqual(parseFolderLink('https://drive.google.com/drive/folders/abc_123'),{provider:'google_drive',folderId:'abc_123',requiresAuthorization:true}));
test('OneDrive short link',()=>assert.equal(parseFolderLink('https://1drv.ms/f/s!abc').provider,'onedrive'));
test('Dropbox shared folder',()=>assert.equal(parseFolderLink('https://www.dropbox.com/scl/fo/abc?rlkey=x').provider,'dropbox'));
test('Box shared folder',()=>assert.equal(parseFolderLink('https://app.box.com/s/abc123').provider,'box'));
for(const url of ['http://drive.google.com/drive/folders/a','https://drive.google.com.evil.test/drive/folders/a','https://127.0.0.1/private','https://user:pass@drive.google.com/drive/folders/a','https://drive.google.com:8443/drive/folders/a','https://drive.google.com/drive/folders/a/../../admin'])test('reject unsafe '+url,()=>assert.throws(()=>parseFolderLink(url)));
test('batch preserves invalid links',()=>{let r=parseFolderLinks('https://drive.google.com/drive/folders/abc\nhttps://evil.test');assert.equal(r.length,2);assert.equal(r[0].valid,true);assert.equal(r[1].valid,false)});
test('deduplicate',()=>assert.equal(parseFolderLinks('https://1drv.ms/f/a\nhttps://1drv.ms/f/a').length,1));
