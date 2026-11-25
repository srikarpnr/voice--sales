import crypto from 'node:crypto';
import { KnowledgeChunk } from './db.js';
import { embed } from './llm.js';

const CHUNK_CHARS = 900;
const OVERLAP_CHARS = 150;
const EMBED_BATCH = 32;

// Splits text into ~900-character pieces, preferring to cut at a line or sentence end.
export function chunkText(text, size = CHUNK_CHARS, overlap = OVERLAP_CHARS) {
  const clean = text.replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  const chunks = [];
  let start = 0;
  while (start < clean.length) {
    let end = Math.min(start + size, clean.length);
    if (end < clean.length) {
      const cut = Math.max(clean.lastIndexOf('\n', end), clean.lastIndexOf('. ', end));
      if (cut > start + size / 2) end = cut + 1;
    }
    chunks.push(clean.slice(start, end).trim());
    if (end >= clean.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return chunks.filter(Boolean);
}

export function cosine(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na * nb) || 1);
}

export function topMatches(queryVector, chunks, k) {
  return chunks
    .map((chunk) => ({ chunk, score: cosine(queryVector, chunk.embedding) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

// shortcut: every chunk is scored in memory, fine up to tens of thousands of chunks;
// beyond that, move to an Atlas Vector Search index ($vectorSearch) on `embedding`.
let cache = null;
const allChunks = async () => (cache ??= await KnowledgeChunk.find({}, { docName: 1, text: 1, embedding: 1 }).lean());

export async function addDocument(name, text) {
  const pieces = chunkText(text);
  if (pieces.length === 0) throw Object.assign(new Error('The document has no readable text'), { status: 400 });
  const docId = crypto.randomUUID();
  const docs = [];
  for (let i = 0; i < pieces.length; i += EMBED_BATCH) {
    const batch = pieces.slice(i, i + EMBED_BATCH);
    const vectors = await embed(batch);
    batch.forEach((piece, j) => docs.push({ docId, docName: name, index: i + j, text: piece, embedding: vectors[j] }));
  }
  await KnowledgeChunk.insertMany(docs);
  cache = null;
  return { docId, name, chunks: docs.length };
}

export async function removeDocument(docId) {
  await KnowledgeChunk.deleteMany({ docId });
  cache = null;
}

export async function searchKnowledge(query, k = 3) {
  const chunks = await allChunks();
  if (chunks.length === 0) return [];
  const [vector] = await embed([query]);
  return topMatches(vector, chunks, k).map(({ chunk, score }) => ({ source: chunk.docName, score: Number(score.toFixed(3)), text: chunk.text }));
}
