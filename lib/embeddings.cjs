// Shared by retrieval, Drive sync and the offline ingestion scripts.
const EMBEDDING_MODEL = 'text-embedding-3-small';
const EMBEDDING_DIMENSIONS = 384;
const EMBEDDING_VERSION = `${EMBEDDING_MODEL}:${EMBEDDING_DIMENSIONS}:v1`;

/**
 * @param {string[]} texts
 * @param {string | undefined} [apiKey]
 * @param {typeof fetch} [fetcher]
 * @returns {Promise<number[][]>}
 */
async function getEmbeddings(texts, apiKey = process.env.OPENAI_API_KEY, fetcher = fetch) {
  if (!apiKey) throw new Error('OPENAI_API_KEY is required');
  if (!texts.length || texts.some(text => typeof text !== 'string' || !text.trim())) {
    throw new Error('Embedding inputs must be non-empty strings');
  }
  const response = await fetcher('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: EMBEDDING_MODEL, dimensions: EMBEDDING_DIMENSIONS, input: texts }),
    signal: AbortSignal.timeout(30_000),
  });
  // Do not expose upstream response bodies (which can contain input text) in logs.
  if (!response.ok) throw new Error(`Embedding service HTTP ${response.status}`);
  const data = await response.json();
  if (!Array.isArray(data.data) || data.data.length !== texts.length) {
    throw new Error('Embedding service returned an incomplete batch');
  }
  const ordered = [...data.data].sort((a, b) => a.index - b.index);
  return ordered.map((item, index) => {
    if (item.index !== index || !Array.isArray(item.embedding)
      || item.embedding.length !== EMBEDDING_DIMENSIONS
      || !item.embedding.every(value => typeof value === 'number' && Number.isFinite(value))
      || !item.embedding.some(value => value !== 0)) {
      throw new Error('Embedding service returned an invalid vector');
    }
    return item.embedding;
  });
}

module.exports = { EMBEDDING_MODEL, EMBEDDING_DIMENSIONS, EMBEDDING_VERSION, getEmbeddings };
