import { Module } from '@nestjs/common';
import { AiController, AdminAiController, AdminUsageController, AdminAiDashboardController } from './ai.controller.js';
import { AiService } from './ai.service.js';
import {
  AiLlmService,
  AiGuardService,
  AiExtractionService,
  AiScoringService,
  AiPrivacyService,
  AiMoneyService,
} from './ai-logic.services.js';
import { QueueModule } from '../queue/queue.module.js';
import { EmbeddingService } from './embeddings.js';
import { RetrievalService } from './retrieval.js';
import { KnowledgeIndexer } from './indexing.js';
@Module({
  imports: [QueueModule],
  controllers: [AiController, AdminAiController, AdminUsageController, AdminAiDashboardController],
  providers: [
    AiService,
    AiLlmService,
    AiGuardService,
    AiExtractionService,
    AiScoringService,
    AiPrivacyService,
    AiMoneyService,
    EmbeddingService,
    RetrievalService,
    KnowledgeIndexer,
  ],
  exports: [RetrievalService, KnowledgeIndexer],
})
export class AiModule {}
