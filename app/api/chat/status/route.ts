import { NextResponse } from 'next/server';

/**
 * Read-only diagnostic for test deployments. It never initializes or calls a
 * provider, RAG, Supabase, embeddings, sync, or any user-message processing.
 */
export async function GET() {
  const mode = process.env.NAURYZ_CHAT_MODE === 'mock' ? 'mock' : 'disabled';
  return NextResponse.json(
    { mode, providersInvoked: false },
    { headers: { 'Cache-Control': 'no-store', 'X-Nauryz-Chat-Mode': mode } },
  );
}
