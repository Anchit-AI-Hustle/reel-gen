/** Google Drive v3 OAuth-scope-driven recursion; no API bypass or anonymous scraping. */
import {parseFolderLink} from './folder-links.mjs';
const API='https://www.googleapis.com/drive/v3/files';
function driveApiUrl(folderId,token){const url=new URL(API);url.searchParams.set('q',`'${folderId.replace(/'/g,"\\'")}' in parents and trashed = false`);url.searchParams.set('pageSize','1000');url.searchParams.set('fields','nextPageToken,files(id,name,mimeType,size,modifiedTime,createdTime,parents,webViewLink,videoMediaMetadata),incompleteSearch');url.searchParams.set('supportsAllDrives','true');url.searchParams.set('includeItemsFromAllDrives','true');if(token)url.searchParams.set('pageToken',token);return url.toString()}
export async function* listGoogleDriveFolderRecursive({folderUrl,accessToken,fetcher=fetch,maxFiles=10000,maxDepth=24}){
 let parsed=parseFolderLink(folderUrl);if(parsed.provider!=='google_drive')throw Error('Not a Google Drive folder');if(!accessToken)throw Error('Google OAuth access token required');
 const todo=[{id:parsed.folderId,path:'',depth:0}],visited=new Set();let count=0;
 while(todo.length){let folder=todo.pop();if(visited.has(folder.id))continue;visited.add(folder.id);if(folder.depth>maxDepth)throw Error('Folder depth exceeds configured limit');let page;
 do{let r=await fetcher(driveApiUrl(folder.id,page),{headers:{Authorization:'Bearer '+accessToken},redirect:'error'});if(!r.ok){if(r.status===401||r.status===403)throw Error('Google Drive authorization or permission denied');throw Error('Google Drive listing failed: '+r.status)}let j=await r.json();if(j.incompleteSearch)throw Error('Google Drive returned incomplete listing');for(let f of j.files||[]){if(f.mimeType==='application/vnd.google-apps.folder'){todo.push({id:f.id,path:folder.path+'/'+f.name,depth:folder.depth+1});continue}yield {...f,sourcePath:folder.path+'/'+f.name};if(++count>maxFiles)throw Error('Folder exceeds import safety limit')}page=j.nextPageToken}while(page)
 }
}
