import type { CloudProviderId } from '@/types/reel-gen';

export interface ParsedCloudLink {
  originalUrl: string;
  provider: CloudProviderId | null;
  folderId: string | null;
  valid: boolean;
  reason?: string;
}

const PROVIDER_HOST_RULES: Array<{ provider: CloudProviderId; hosts: RegExp }> = [
  { provider: 'google_drive', hosts: /^drive\.google\.com$/i },
  { provider: 'onedrive', hosts: /^(1drv\.ms|onedrive\.live\.com)$/i },
  { provider: 'sharepoint', hosts: /^[a-z0-9-]+\.sharepoint\.com$/i },
  { provider: 'dropbox', hosts: /^(www\.)?dropbox\.com$/i },
  { provider: 'box', hosts: /^([a-z0-9-]+\.)?box\.com$/i },
  { provider: 's3', hosts: /^([a-z0-9.-]+\.)?s3([.-][a-z0-9-]+)?\.amazonaws\.com$/i },
];

export function validateAndParseCloudLink(rawUrl: string): ParsedCloudLink {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return { originalUrl: rawUrl, provider: null, folderId: null, valid: false, reason: 'Empty URL' };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { originalUrl: trimmed, provider: null, folderId: null, valid: false, reason: 'Invalid URL format' };
  }

  if (parsed.protocol !== 'https:') {
    return { originalUrl: trimmed, provider: null, folderId: null, valid: false, reason: 'Only HTTPS cloud links are allowed' };
  }
  if (parsed.username || parsed.password) {
    return { originalUrl: trimmed, provider: null, folderId: null, valid: false, reason: 'URLs with embedded credentials are rejected' };
  }
  if (parsed.port && parsed.port !== '443') {
    return { originalUrl: trimmed, provider: null, folderId: null, valid: false, reason: 'Non-standard ports are blocked (SSRF defense)' };
  }
  if (/(^|\/)\.\.(\/|$)/.test(parsed.pathname) || decodeURIComponent(parsed.pathname).includes('..')) {
    return { originalUrl: trimmed, provider: null, folderId: null, valid: false, reason: 'Path traversal sequence blocked' };
  }

  const host = parsed.hostname.toLowerCase();
  // Block localhost / private IP literals
  if (
    host === 'localhost' ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^\[::1\]$/.test(host)
  ) {
    return { originalUrl: trimmed, provider: null, folderId: null, valid: false, reason: 'Internal/private network addresses are blocked' };
  }

  const matched = PROVIDER_HOST_RULES.find((r) => r.hosts.test(host));
  if (!matched) {
    return {
      originalUrl: trimmed,
      provider: null,
      folderId: null,
      valid: false,
      reason: `Unsupported or unallowlisted cloud host: ${host}`,
    };
  }

  let folderId: string | null = null;
  if (matched.provider === 'google_drive') {
    const m = parsed.pathname.match(/\/folders\/([a-zA-Z0-9_-]+)/);
    folderId = m ? m[1] : parsed.searchParams.get('id');
  } else if (matched.provider === 'onedrive' || matched.provider === 'sharepoint') {
    folderId = toMicrosoftGraphShareId(trimmed);
  } else {
    folderId = parsed.pathname.replace(/^\/+/, '') || null;
  }

  return {
    originalUrl: trimmed,
    provider: matched.provider,
    folderId,
    valid: true,
  };
}

export function parseCloudLinksBatch(rawInput: string): {
  valid: ParsedCloudLink[];
  invalid: ParsedCloudLink[];
} {
  const lines = rawInput
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const valid: ParsedCloudLink[] = [];
  const invalid: ParsedCloudLink[] = [];

  for (const line of lines) {
    if (seen.has(line)) continue;
    seen.add(line);
    const parsed = validateAndParseCloudLink(line);
    if (parsed.valid) valid.push(parsed);
    else invalid.push(parsed);
  }
  return { valid, invalid };
}

export function toMicrosoftGraphShareId(sharedUrl: string): string {
  const clean = sharedUrl.trim();
  const base64 = Buffer.from(clean, 'utf8')
    .toString('base64')
    .replace(/=+$/g, '')
    .replace(/\//g, '_')
    .replace(/\+/g, '-');
  return `u!${base64}`;
}

export interface CloudFileEntry {
  provider: CloudProviderId;
  externalId: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  relativePath: string;
  modifiedTime: string | null;
}

export interface FetchLike {
  (url: string, init?: RequestInit): Promise<{
    ok: boolean;
    status: number;
    json: () => Promise<any>;
  }>;
}

/**
 * Official Google Drive API v3 recursive folder enumerator with pagination & OAuth enforcement.
 */
export async function listGoogleDriveFolderRecursive(params: {
  folderId: string;
  accessToken: string;
  fetchImpl?: FetchLike;
  prefixPath?: string;
}): Promise<CloudFileEntry[]> {
  if (!params.accessToken || params.accessToken.trim().length < 8) {
    throw new Error('Google Drive OAuth access token is required. Refusing unauthenticated scraping.');
  }
  const fetchFn: FetchLike = params.fetchImpl || (fetch as unknown as FetchLike);
  const results: CloudFileEntry[] = [];
  const queue: Array<{ id: string; relPath: string }> = [{ id: params.folderId, relPath: params.prefixPath || '' }];
  const visitedFolders = new Set<string>();

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visitedFolders.has(current.id)) continue;
    visitedFolders.add(current.id);

    let pageToken: string | undefined;
    do {
      const q = `'${current.id.replace(/'/g, "\\'")}' in parents and trashed = false`;
      const url = new URL('https://www.googleapis.com/drive/v3/files');
      url.searchParams.set('q', q);
      url.searchParams.set('fields', 'nextPageToken,files(id,name,mimeType,size,modifiedTime,shortcutDetails)');
      url.searchParams.set('supportsAllDrives', 'true');
      url.searchParams.set('includeItemsFromAllDrives', 'true');
      url.searchParams.set('pageSize', '200');
      if (pageToken) url.searchParams.set('pageToken', pageToken);

      const res = await fetchFn(url.toString(), {
        headers: { Authorization: `Bearer ${params.accessToken}` },
      });
      if (!res.ok) {
        throw new Error(`Google Drive API error (${res.status}) while listing folder ${current.id}`);
      }
      const data = await res.json();
      for (const item of data.files || []) {
        const nextPath = current.relPath ? `${current.relPath}/${item.name}` : item.name;
        if (item.mimeType === 'application/vnd.google-apps.folder') {
          queue.push({ id: item.id, relPath: nextPath });
        } else if (item.mimeType === 'application/vnd.google-apps.shortcut' && item.shortcutDetails?.targetId) {
          if (item.shortcutDetails.targetMimeType === 'application/vnd.google-apps.folder') {
            queue.push({ id: item.shortcutDetails.targetId, relPath: nextPath });
          }
        } else {
          results.push({
            provider: 'google_drive',
            externalId: item.id,
            name: item.name,
            mimeType: item.mimeType || 'application/octet-stream',
            sizeBytes: Number(item.size || 0),
            relativePath: nextPath,
            modifiedTime: item.modifiedTime || null,
          });
        }
      }
      pageToken = data.nextPageToken || undefined;
    } while (pageToken);
  }

  return results;
}

/**
 * Official Microsoft Graph OneDrive/SharePoint recursive shared-folder enumerator.
 */
export async function listOneDriveFolderRecursive(params: {
  sharedUrl: string;
  accessToken: string;
  fetchImpl?: FetchLike;
}): Promise<CloudFileEntry[]> {
  if (!params.accessToken || params.accessToken.trim().length < 8) {
    throw new Error('Microsoft Graph OAuth access token is required.');
  }
  const fetchFn: FetchLike = params.fetchImpl || (fetch as unknown as FetchLike);
  const shareId = toMicrosoftGraphShareId(params.sharedUrl);
  const results: CloudFileEntry[] = [];

  const rootUrl = `https://graph.microsoft.com/v1.0/shares/${shareId}/driveItem/children`;
  const queue: Array<{ url: string; relPath: string }> = [{ url: rootUrl, relPath: '' }];

  while (queue.length > 0) {
    const current = queue.shift()!;
    let nextLink: string | undefined = current.url;

    while (nextLink) {
      const res = await fetchFn(nextLink, {
        headers: { Authorization: `Bearer ${params.accessToken}` },
      });
      if (!res.ok) {
        throw new Error(`Microsoft Graph API error (${res.status})`);
      }
      const data = await res.json();
      for (const item of data.value || []) {
        const nextPath = current.relPath ? `${current.relPath}/${item.name}` : item.name;
        if (item.folder) {
          const driveId = item.parentReference?.driveId;
          const childUrl = driveId
            ? `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${item.id}/children`
            : `https://graph.microsoft.com/v1.0/me/drive/items/${item.id}/children`;
          queue.push({ url: childUrl, relPath: nextPath });
        } else {
          results.push({
            provider: 'onedrive',
            externalId: item.id,
            name: item.name,
            mimeType: item.file?.mimeType || 'application/octet-stream',
            sizeBytes: Number(item.size || 0),
            relativePath: nextPath,
            modifiedTime: item.lastModifiedDateTime || null,
          });
        }
      }
      nextLink = data['@odata.nextLink'] || undefined;
    }
  }

  return results;
}

export interface ProviderStatusInfo {
  id: CloudProviderId;
  name: string;
  configured: boolean;
  status: 'ready_to_connect' | 'setup_required';
  missingEnvVars: string[];
  setupInstruction: string;
  supportedCapabilities: string[];
}

export function getCloudProvidersStatus(): ProviderStatusInfo[] {
  const hasGoogle = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
  const hasMicrosoft = Boolean(process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET);
  const hasDropbox = Boolean(process.env.DROPBOX_CLIENT_ID && process.env.DROPBOX_CLIENT_SECRET);
  const hasBox = Boolean(process.env.BOX_CLIENT_ID && process.env.BOX_CLIENT_SECRET);
  const hasS3 = Boolean(process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY);

  return [
    {
      id: 'google_drive',
      name: 'Google Drive',
      configured: hasGoogle,
      status: hasGoogle ? 'ready_to_connect' : 'setup_required',
      missingEnvVars: hasGoogle ? [] : ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
      setupInstruction: 'Register an OAuth 2.0 Web Client in Google Cloud Console with Drive readonly scope and set GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET in Vercel.',
      supportedCapabilities: ['Recursive folders', 'Shared Drives', 'Shortcuts', 'Pagination', 'OAuth refresh'],
    },
    {
      id: 'onedrive',
      name: 'Microsoft OneDrive',
      configured: hasMicrosoft,
      status: hasMicrosoft ? 'ready_to_connect' : 'setup_required',
      missingEnvVars: hasMicrosoft ? [] : ['MICROSOFT_CLIENT_ID', 'MICROSOFT_CLIENT_SECRET'],
      setupInstruction: 'Register an Azure AD / Entra ID app with Files.Read scope and set MICROSOFT_CLIENT_ID + MICROSOFT_CLIENT_SECRET in Vercel.',
      supportedCapabilities: ['Shared folder links (Graph shares API)', 'Recursive folders', 'Pagination'],
    },
    {
      id: 'sharepoint',
      name: 'SharePoint',
      configured: hasMicrosoft,
      status: hasMicrosoft ? 'ready_to_connect' : 'setup_required',
      missingEnvVars: hasMicrosoft ? [] : ['MICROSOFT_CLIENT_ID', 'MICROSOFT_CLIENT_SECRET'],
      setupInstruction: 'Uses Microsoft Graph OAuth credentials (Sites.Read.All / Files.Read).',
      supportedCapabilities: ['Document libraries', 'Recursive folders'],
    },
    {
      id: 'dropbox',
      name: 'Dropbox',
      configured: hasDropbox,
      status: hasDropbox ? 'ready_to_connect' : 'setup_required',
      missingEnvVars: hasDropbox ? [] : ['DROPBOX_CLIENT_ID', 'DROPBOX_CLIENT_SECRET'],
      setupInstruction: 'Register a Dropbox App with files.content.read scope and set DROPBOX_CLIENT_ID + DROPBOX_CLIENT_SECRET.',
      supportedCapabilities: ['Shared folders', 'Cursor sync'],
    },
    {
      id: 'box',
      name: 'Box',
      configured: hasBox,
      status: hasBox ? 'ready_to_connect' : 'setup_required',
      missingEnvVars: hasBox ? [] : ['BOX_CLIENT_ID', 'BOX_CLIENT_SECRET'],
      setupInstruction: 'Register a Box OAuth app and configure BOX_CLIENT_ID + BOX_CLIENT_SECRET.',
      supportedCapabilities: ['Folder enumeration', 'Enterprise links'],
    },
    {
      id: 's3',
      name: 'Amazon S3 / S3-Compatible',
      configured: hasS3,
      status: hasS3 ? 'ready_to_connect' : 'setup_required',
      missingEnvVars: hasS3 ? [] : ['S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'],
      setupInstruction: 'Configure scoped read-only IAM credentials (or Cloudflare R2 / Backblaze B2 S3-compatible keys).',
      supportedCapabilities: ['Prefix listing', 'Signed URL streaming'],
    },
  ];
}
