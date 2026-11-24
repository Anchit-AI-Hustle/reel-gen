/** Microsoft Graph shared-item recursive folder listing using official API only. */
export const graphSharingId=url=>'u!'+Buffer.from(url,'utf8').toString('base64').replace(/=+$/,'').replace(/\+/g,'-').replace(/\//g,'_');
const allowed=['1drv.ms','onedrive.live.com','www.onedrive.com'];
export function validateOneDriveLink(raw){let u;try{u=new URL(raw)}catch{throw Error('Invalid OneDrive URL')}if(u.protocol!=='https:'||u.username||u.password||u.port||!allowed.includes(u.hostname))throw Error('Invalid OneDrive sharing link');return u.href}
export async function* listOneDriveFolderRecursive({sharingUrl,accessToken,fetcher=fetch,maxFiles=10000}){
 if(!accessToken)throw Error('Microsoft Graph OAuth access token required');let url=`https://graph.microsoft.com/v1.0/shares/${graphSharingId(validateOneDriveLink(sharingUrl))}/driveItem`;
 const base=await fetcher(url,{headers:{Authorization:'Bearer '+accessToken},redirect:'error'});if(!base.ok)throw Error('Microsoft Graph shared item resolution failed: '+base.status);let root=await base.json();if(!root.folder)throw Error('Shared link does not resolve to a folder');if(!root.parentReference?.driveId||!root.id)throw Error('Missing drive identifiers');let q=[{driveId:root.parentReference.driveId,id:root.id,path:''}],n=0;
 while(q.length){let dir=q.shift(),next=`https://graph.microsoft.com/v1.0/drives/${encodeURIComponent(dir.driveId)}/items/${encodeURIComponent(dir.id)}/children?$top=200`;
 while(next){let u=new URL(next);if(u.protocol!=='https:'||u.hostname!=='graph.microsoft.com'||!u.pathname.startsWith('/v1.0/'))throw Error('Unsafe Graph pagination URL');let resp=await fetcher(u.toString(),{headers:{Authorization:'Bearer '+accessToken},redirect:'error'});if(!resp.ok)throw Error('Microsoft Graph folder listing failed: '+resp.status);let data=await resp.json();for(let f of data.value||[]){if(f.folder){q.push({driveId:dir.driveId,id:f.id,path:dir.path+'/'+f.name});continue}yield {...f,sourcePath:dir.path+'/'+f.name};if(++n>maxFiles)throw Error('Folder exceeds import safety limit')}next=data['@odata.nextLink']||null}
 }
}
