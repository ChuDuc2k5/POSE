import '../dist/env.js';
const [{ KnowledgeIndexer }, { EmbeddingService }] = await Promise.all([
  import('../dist/modules/ai/indexing.js'),
  import('../dist/modules/ai/embeddings.js'),
]);
const indexer = new KnowledgeIndexer(new EmbeddingService(), { enabled: false });
try {
  const result = await indexer.reindexAll();
  console.log(`PASS: rebuilt knowledge base; ${result.queued} documents indexed synchronously.`);
} finally {
  await indexer.onApplicationShutdown();
}
