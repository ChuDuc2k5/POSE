import '../dist/src/env.js';
const [{KnowledgeIndexer},{EmbeddingService}]=await Promise.all([import('../dist/src/modules/ai/indexing.js'),import('../dist/src/modules/ai/embeddings.js')]);
const indexer=new KnowledgeIndexer(new EmbeddingService(),{enabled:false});
try{const result=await indexer.reindexAll();console.log(`PASS: rebuilt knowledge base; ${result.queued} documents indexed synchronously.`);}finally{await indexer.onApplicationShutdown();}
