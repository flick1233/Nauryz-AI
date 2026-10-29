import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';
import { extractPdfText } from '../../../lib/pdf';
import { getEmbeddings } from '../../../lib/embeddings.cjs';
import { downloadPdf, listDriveFiles, PIPELINE_VERSION, syncFile } from '../../../lib/drive-sync';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

async function getGoogleToken(rawAccount: string): Promise<string> {
  const account = JSON.parse(rawAccount);
  if (!account.client_email || !account.private_key) throw new Error('Invalid Google service account');
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const claim = Buffer.from(JSON.stringify({
    iss: account.client_email, scope: 'https://www.googleapis.com/auth/drive.readonly',
    aud: 'https://oauth2.googleapis.com/token', exp: now + 3600, iat: now,
  })).toString('base64url');
  const signature = crypto.sign('RSA-SHA256', Buffer.from(`${header}.${claim}`), account.private_key).toString('base64url');
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${header}.${claim}.${signature}` }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Google authentication HTTP ${response.status}`);
  const data = await response.json();
  if (!data.access_token) throw new Error('Google returned no access token');
  return data.access_token;
}

export async function GET(req: NextRequest) {
  if (process.env.VERCEL_ENV === 'preview') {
    return Response.json({ error: 'Knowledge sync is disabled in Preview' }, { status: 403 });
  }
  const secret = process.env.CRON_SECRET || process.env.SYNC_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const dbKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  const account = process.env.GOOGLE_SERVICE_ACCOUNT;
  const url = process.env.SUPABASE_URL;
  if (!dbKey || !url || !account || !process.env.OPENAI_API_KEY) {
    return Response.json({ error: 'Sync server configuration is incomplete' }, { status: 503 });
  }
  const started = Date.now();
  const db = createClient(url, dbKey, { auth: { persistSession: false, autoRefreshToken: false } });
  try {
    // Fail before any downloads/embeddings if the migration is not installed.
    const { error: schemaError } = await db.from('knowledge_sync_files').select('file_id').limit(1);
    if (schemaError) throw new Error('Sync schema unavailable; apply the Drive sync migration');
    const token = await getGoogleToken(account);
    const files = await listDriveFiles(token, process.env.GOOGLE_DRIVE_FOLDER_ID || '10MppomAtLV-B6cexyNEA5J2pwp7bSPXl');
    const results: { file: string; status: string; chunks?: number; error?: string }[] = [];
    let added = 0, skipped = 0, failed = 0, deferred = 0;
    for (let index = 0; index < files.length; index++) {
      const file = files[index];
      // Leave time for a bounded file operation; the next cron resumes using saved state.
      if (Date.now() - started > 120_000) { deferred = files.length - index; break; }
      const fileStarted = Date.now();
      try {
        const result = await syncFile(file, {
          readState: async fileId => {
            const { data, error } = await db.from('knowledge_sync_files')
              .select('modified_time,source_name,pipeline_version').eq('file_id', fileId).maybeSingle();
            if (error) throw new Error('Cannot read sync state');
            return data;
          },
          extract: async source => {
            const bytes = await downloadPdf(source.id, token);
            return extractPdfText(bytes);
          },
          embed: texts => {
            if (Date.now() - fileStarted > 90_000) throw new Error('Document processing deadline exceeded');
            return getEmbeddings(texts);
          },
          replace: async (source, chunks) => {
            const { data, error } = await db.rpc('replace_drive_knowledge', {
              p_file_id: source.id, p_modified_time: source.modifiedTime,
              p_source_name: source.name, p_pipeline_version: PIPELINE_VERSION, p_chunks: chunks,
            });
            if (error) throw new Error('Transactional document replacement failed');
            if (typeof data !== 'boolean') throw new Error('Invalid document replacement result');
            return data;
          },
        });
        added += result.chunks;
        if (result.status === 'skipped') skipped++;
        results.push({ file: file.name, ...result });
      } catch (error) {
        failed++;
        results.push({ file: file.name, status: 'failed', error: error instanceof Error ? error.message : 'Document sync failed' });
      }
    }
    return Response.json({ success: failed === 0 && deferred === 0, files: files.length, added, skipped, failed, deferred, results }, {
      status: failed || deferred ? 207 : 200, headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    console.error('[sync]', error instanceof Error ? error.message : 'Sync failed');
    return Response.json({ error: 'Knowledge sync failed; inspect server logs' }, { status: 500 });
  }
}
