import { Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { QueueStatus, queueConnection } from '../queue/queue.module.js';
import { systemClient } from '../supabase/supabase.service.js';
import { contentHash, faqChunks, propertyChunks, type PropertyChunkSource, CHUNKER_VERSION } from './chunking.js';
import { EmbeddingService } from './embeddings.js';

type Source = {
  document_id: string;
  source_type: 'Property' | 'Faq';
  source_id: string | null;
  published: boolean;
  source_updated_at: string;
  content_hash: string | null;
  embed_model: string | null;
  code?: string;
  name?: string;
  location?: string;
  property_type?: string;
  transaction_type?: 'Sale' | 'Rent';
  description?: string;
  project_name?: string;
  amenities?: string;
  question?: string;
  answer?: string;
};
export const KB_SWEEP_MS = 300000;
export function indexNeedsEmbedding(
  source: { content_hash: string | null; embed_model: string | null },
  hash: string,
  model: string | null,
) {
  return source.content_hash !== hash || source.embed_model !== model;
}
@Injectable()
export class KnowledgeIndexer implements OnModuleInit, OnApplicationShutdown {
  private queue?: Queue;
  private worker?: Worker;
  private timer?: NodeJS.Timeout;
  private running = false;
  private readonly logger = new Logger('KnowledgeIndexer');
  constructor(
    private readonly embeddings: EmbeddingService,
    private readonly queues: QueueStatus,
  ) {}
  async onModuleInit() {
    if (this.queues.enabled) {
      const name = process.env.KB_QUEUE_NAME || 'kb-index';
      try {
        this.queue = new Queue(name, {
          connection: { ...queueConnection, maxRetriesPerRequest: 0, connectTimeout: 500, retryStrategy: () => null },
        });
        this.worker = new Worker(name, (job) => this.indexDocument(String(job.data.documentId)), {
          connection: { ...queueConnection, maxRetriesPerRequest: null },
          concurrency: 2,
        });
      } catch {
        this.logger.warn('Redis chưa khả dụng; lập chỉ mục chạy đồng bộ.');
        await this.queue?.close();
        this.queue = undefined;
      }
    }
    this.timer = setInterval(() => void this.sweep().catch((error) => this.logger.error(error)), KB_SWEEP_MS);
    this.timer.unref();
  }
  async sweep(all = false) {
    if (this.running) return { queued: 0 };
    this.running = true;
    try {
      const response = await systemClient().rpc('pose_system_kb_sweep', {
        p_all: all,
        p_embed_model: this.embeddings.config()?.model || null,
      });
      if (response.error) throw new Error(response.error.message);
      const ids = (response.data || []).map((row: { document_id: string }) => row.document_id);
      if (this.queue) {
        for (const id of ids)
          await this.queue.add(
            'index',
            { documentId: id },
            { jobId: `kb-${id}`, removeOnComplete: 50, removeOnFail: 50 },
          );
      } else for (const id of ids) await this.indexDocument(id);
      return { queued: ids.length, synchronous: !this.queue };
    } finally {
      this.running = false;
    }
  }
  async reindexAll() {
    return this.sweep(true);
  }
  async indexDocument(documentId: string) {
    const response = await systemClient().rpc('pose_system_kb_source', { p_document: documentId });
    if (response.error) throw new Error(response.error.message);
    const source = response.data as Source | null;
    if (!source) return { status: 'missing' };
    if (!source.published) {
      const removed = await systemClient().rpc('pose_system_kb_remove_chunks', { p_document: documentId });
      if (removed.error) throw new Error(removed.error.message);
      if (source.source_id) await systemClient().rpc('pose_system_remove_similar', { p_property: source.source_id });
      return { status: 'removed' };
    }
    const raw =
      source.source_type === 'Property'
        ? { description: source.description, project_name: source.project_name, amenities: source.amenities }
        : { question: source.question, answer: source.answer };
    const hash = contentHash({ raw, chunker: CHUNKER_VERSION }),
      config = this.embeddings.config(),
      model = config?.model || null;
    if (!indexNeedsEmbedding(source, hash, model)) return { status: 'unchanged' };
    const chunks =
      source.source_type === 'Property'
        ? propertyChunks(source as Source & PropertyChunkSource)
        : faqChunks(source.question || '', source.answer || '');
    const embedded =
      config && chunks.length ? await this.embeddings.embed(chunks.map((chunk) => chunk.embedded)) : null;
    const payload = chunks.map((chunk, index) => ({
      chunk_index: chunk.chunk_index,
      header: chunk.header,
      content: chunk.content,
      embedding: embedded?.vectors[index] || null,
    }));
    const stored = await systemClient().rpc('pose_system_kb_store_chunks', {
      p_document: documentId,
      p_hash: hash,
      p_source_updated_at: source.source_updated_at,
      p_embed_model: embedded?.model || null,
      p_chunks: payload,
    });
    if (stored.error) throw new Error(stored.error.message);
    if (source.source_id) {
      const similar = await systemClient().rpc('pose_system_recompute_similar', {
        p_property: source.source_id,
        p_embed_model: embedded?.model || null,
      });
      if (similar.error) throw new Error(similar.error.message);
    }
    return { status: 'indexed', chunks: chunks.length, model: embedded?.model || null };
  }
  async onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
    await this.worker?.close();
    await this.queue?.close();
  }
}
