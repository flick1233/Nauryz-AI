import { createHash } from 'node:crypto';
import { EMBEDDING_VERSION } from './embeddings.cjs';

export interface DriveFile { id: string; name: string; modifiedTime: string }
export interface SyncState { modified_time: string; source_name: string; pipeline_version: string }
export interface KnowledgeChunk { chunk_id: string; source: string; topic: string; content: string; embedding?: number[] }
export const PIPELINE_VERSION = `${EMBEDDING_VERSION}:pdf-v2`;
export const MAX_PDF_BYTES = 15 * 1024 * 1024;
const MAX_CHUNKS = 400;

export function isCurrent(file: DriveFile, state: SyncState | null): boolean {
  return !!state && state.modified_time === file.modifiedTime
    && state.source_name === file.name && state.pipeline_version === PIPELINE_VERSION;
}

export function chunkText(text: string, file: DriveFile): KnowledgeChunk[] {
  const clean = text.replace(/\u0000/g, '').replace(/\s+/g, ' ').trim();
  if (clean.length < 100 || !new RegExp('\\p{L}', 'u').test(clean)) {
    throw new Error('No usable PDF text; scanned documents require OCR');
  }
  const hash = createHash('sha256').update(file.id).digest('hex');
  const topic = file.name.replace(/\.pdf$/i, '').replace(/_/g, ' ').toLowerCase();
  const chunks: KnowledgeChunk[] = [];
  let start = 0;
  while (start < clean.length) {
    let end = Math.min(start + 1500, clean.length);
    if (end < clean.length) {
      const boundary = clean.lastIndexOf(' ', end);
      if (boundary > start + 750) end = boundary;
    }
    chunks.push({ chunk_id: `drive_${hash}_${chunks.length}`, source: file.name, topic, content: clean.slice(start, end) });
    if (chunks.length > MAX_CHUNKS) throw new Error('PDF exceeds chunk limit; split the document before syncing');
    if (end === clean.length) break;
    start = end - 150;
  }
  return chunks;
}

export async function listDriveFiles(token: string, folderId: string, fetcher: typeof fetch = fetch): Promise<DriveFile[]> {
  const files: DriveFile[] = [];
  const seen = new Set<string>();
  let pageToken = '';
  do {
    const params = new URLSearchParams({
      q: `'${folderId.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}' in parents and mimeType='application/pdf' and trashed=false`,
      fields: 'nextPageToken,files(id,name,modifiedTime)', pageSize: '100',
      ...(pageToken ? { pageToken } : {}),
    });
    const response = await fetcher(`https://www.googleapis.com/drive/v3/files?${params}`, {
      headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`Drive listing HTTP ${response.status}`);
    const data = await response.json();
    if (!Array.isArray(data.files) || data.files.some((f: DriveFile) => !f.id || !f.name || !f.modifiedTime)) {
      throw new Error('Invalid Drive file list');
    }
    files.push(...data.files);
    pageToken = data.nextPageToken || '';
    if (pageToken && seen.has(pageToken)) throw new Error('Repeated Drive pagination token');
    seen.add(pageToken);
  } while (pageToken);
  return files;
}

export async function downloadPdf(fileId: string, token: string, fetcher: typeof fetch = fetch): Promise<Buffer> {
  const response = await fetcher(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Drive download HTTP ${response.status}`);
  if (Number(response.headers.get('content-length')) > MAX_PDF_BYTES) {
    await response.body?.cancel();
    throw new Error('PDF exceeds 15 MB limit');
  }
  if (!response.body) throw new Error('Empty Drive response');
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_PDF_BYTES) { await reader.cancel(); throw new Error('PDF exceeds 15 MB limit'); }
      parts.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = Buffer.concat(parts);
  if (!bytes.subarray(0, 1024).includes(Buffer.from('%PDF-'))) throw new Error('Downloaded file is not a PDF');
  return bytes;
}

export interface SyncDependencies {
  readState(fileId: string): Promise<SyncState | null>;
  extract(file: DriveFile): Promise<string>;
  embed(texts: string[]): Promise<number[][]>;
  replace(file: DriveFile, chunks: KnowledgeChunk[]): Promise<boolean>;
}

// Complete parsing and embedding before the transactional database replacement.
export async function syncFile(file: DriveFile, deps: SyncDependencies): Promise<{ status: 'updated' | 'skipped'; chunks: number }> {
  if (isCurrent(file, await deps.readState(file.id))) return { status: 'skipped', chunks: 0 };
  const chunks = chunkText(await deps.extract(file), file);
  // Repeated pages/boilerplate share vectors within one document. Chunk IDs and
  // text stay intact so database/source semantics do not change.
  const texts = chunks.map(chunk => `${chunk.topic}: ${chunk.content}`);
  const unique = Array.from(new Set(texts));
  const embedded = new Map<string, number[]>();
  for (let i = 0; i < unique.length; i += 16) {
    const batch = unique.slice(i, i + 16);
    const vectors = await deps.embed(batch);
    if (vectors.length !== batch.length) throw new Error('Incomplete embedding batch');
    batch.forEach((text, index) => { embedded.set(text, vectors[index]); });
  }
  chunks.forEach((chunk, index) => { chunk.embedding = embedded.get(texts[index])!; });
  const updated = await deps.replace(file, chunks);
  return { status: updated ? 'updated' : 'skipped', chunks: updated ? chunks.length : 0 };
}
