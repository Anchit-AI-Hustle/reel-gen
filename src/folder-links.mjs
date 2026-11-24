const HOSTS = new Set(['drive.google.com','docs.google.com','1drv.ms','onedrive.live.com','www.dropbox.com','dropbox.com','app.box.com']);
export function parseFolderLink(raw) {
  if (typeof raw !== 'string' || raw.length > 4096) throw new Error('Invalid folder URL');
  let u; try { u = new URL(raw.trim()); } catch { throw new Error('Invalid folder URL'); }
  if (u.protocol !== 'https:' || u.username || u.password || u.port || !HOSTS.has(u.hostname.toLowerCase())) throw new Error('Unsupported or unsafe URL');
  const host = u.hostname.toLowerCase();
  if (host === 'drive.google.com' || host === 'docs.google.com') {
    const match = u.pathname.match(/^\/drive\/(?:u\/\d+\/)?folders\/([\w-]+)\/?$/);
    if (!match) throw new Error('Expected Google Drive folder URL');
    return {provider:'google_drive',folderId:match[1],requiresAuthorization:true};
  }
  if (host === '1drv.ms' || host === 'onedrive.live.com') return {provider:'onedrive',sharingUrl:u.href,requiresAuthorization:true};
  if (host.includes('dropbox.com')) {
    if (!/^\/scl\/fo\/|^\/sh\//.test(u.pathname)) throw new Error('Expected Dropbox shared folder URL');
    return {provider:'dropbox',sharingUrl:u.href,requiresAuthorization:true};
  }
  if (host === 'app.box.com') {
    const match = u.pathname.match(/^\/s\/([\w-]+)\/?$/);
    if (!match) throw new Error('Expected Box shared folder URL');
    return {provider:'box',shareId:match[1],requiresAuthorization:true};
  }
  throw new Error('Unsupported provider');
}
export function parseFolderLinks(lines) {
  const inputs = lines.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  if (!inputs.length || inputs.length > 20) throw new Error('Provide between 1 and 20 folder URLs');
  const unique = [...new Set(inputs)];
  return unique.map((url,index)=>{try{return {index,url,...parseFolderLink(url),valid:true}}catch(error){return {index,url,valid:false,error:error.message}}});
}
