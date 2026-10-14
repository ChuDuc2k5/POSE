import { Module } from '@nestjs/common';
import { AiController } from './ai.controller.js';
import { AiService } from './ai.service.js';
import { AiLlmService, AiGuardService, AiExtractionService, AiScoringService, AiPrivacyService, AiMoneyService } from './ai-logic.services.js';
@Module({ controllers: [AiController], providers: [AiService, AiLlmService, AiGuardService, AiExtractionService, AiScoringService, AiPrivacyService, AiMoneyService] })
export class AiModule {}
