import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

const FOLDER_ID = '10MppomAtLV-B6cexyNEA5J2pwp7bSPXl';
const SERVICE_ACCOUNT = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT || '{}');

// Получаем Google Access Token через JWT
async function getGoogleToken(): Promise<string> {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const claim = Buffer.from(JSON.stringify({
    iss: SERVICE_ACCOUNT.client_email,
    scope: 'https://www.googleapis.com/auth/drive.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  })).toString('base64url');

  const key = await crypto.subtle.importKey(
    'pkcs8',
    Buffer.from(SERVICE_ACCOUNT.private_key.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\n/g, ''), 'base64'),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['sign']
  );

  const sig = Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, Buffer.from(`${header}.${claim}`))).toString('base64url');
  const jwt = `${header}.${claim}.${sig}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });
  const data = await res.json();
  return data.access_token;
}

// Получаем список PDF файлов в папке
async function listFiles(token: string) {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q='${FOLDER_ID}'+in+parents+and+mimeType='application/pdf'+and+trashed=false&fields=files(id,name,modifiedTime)`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const data = await res.json();
  return data.files || [];
}

// Скачиваем текст из PDF через Drive export
async function extractText(fileId: string, token: string): Promise<string> {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text/plain`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) {
    // Попробуем скачать как бинарный и извлечь текст
    const res2 = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const text = await res2.text();
    return text.replace(/[^\u0400-\u04FF\u0041-\u007A\u0410-\u044F0-9 .,!?:;\-\n]/g, ' ').substring(0, 50000);
  }
  return await res.text();
}

// Нарезаем текст на чанки
function chunkText(text: string, fileId: string, fileName: string): any[] {
  const chunks: any[] = [];
  const paragraphs = text.split(/\n{2,}/).filter(p => p.trim().length > 100);

  paragraphs.forEach((para, i) => {
    const clean = para.trim().replace(/\s+/g, ' ');
    if (clean.length < 100) return;

    const chunkId = `auto_${fileId.slice(0, 8)}_${i}`;
    const topic = fileName.replace('.pdf', '').replace(/_/g, ' ').toLowerCase();

    chunks.push({
      chunk_id: chunkId,
      source: fileName,
      topic,
      content: clean.substring(0, 1500),
    });
  });

  return chunks.slice(0, 20); // максимум 20 чанков с файла
}

// Генерируем хеш-эмбеддинг
function textToEmbedding(text: string, dims = 384): number[] {
  const lower = text.toLowerCase();
  const words = lower.replace(/[,.:;]/g, ' ').split(/\s+/).filter(w => w.length >= 2);
  const vec = new Array(dims).fill(0);
  for (const word of words) {
    let h = 0;
    for (let i = 0; i < word.length; i++) h = ((h << 5) - h + word.charCodeAt(i)) >>> 0;
    const weight = 1.0 / (1 + words.filter(w => w === word).length);
    vec[h % dims] += weight;
    vec[(h >>> 8) % dims] += weight * 0.5;
    vec[(h >>> 16) % dims] += weight * 0.25;
  }
  const norm = Math.sqrt(vec.reduce((s, x) => s + x * x, 0));
  return norm > 0 ? vec.map(x => x / norm) : vec;
}

export async function GET(req: NextRequest) {
  // Проверяем секретный ключ (для защиты от посторонних)
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.SYNC_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const token = await getGoogleToken();
    const files = await listFiles(token);

    let added = 0;
    let skipped = 0;
    const results: string[] = [];

    for (const file of files) {
      // Проверяем есть ли уже чанки из этого файла
      const { data: existing } = await supabase
        .from('knowledge_chunks')
        .select('id')
        .like('chunk_id', `auto_${file.id.slice(0, 8)}_%`)
        .limit(1);

      if (existing && existing.length > 0) {
        skipped++;
        results.push(`⏭️ ${file.name} — уже есть`);
        continue;
      }

      // Извлекаем текст
      const text = await extractText(file.id, token);
      if (!text || text.length < 200) {
        results.push(`⚠️ ${file.name} — не удалось извлечь текст`);
        continue;
      }

      // Нарезаем на чанки
      const chunks = chunkText(text, file.id, file.name);

      // Загружаем в Supabase
      for (const chunk of chunks) {
        const embedding = textToEmbedding(chunk.topic + ': ' + chunk.content);
        const { error } = await supabase.from('knowledge_chunks').insert({
          ...chunk,
          embedding,
        });
        if (!error) added++;
      }

      results.push(`✅ ${file.name} — добавлено ${chunks.length} чанков`);
    }

    return Response.json({
      success: true,
      files: files.length,
      added,
      skipped,
      results,
    });

  } catch (error: any) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}