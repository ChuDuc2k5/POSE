import { Injectable } from '@nestjs/common';
import { complete } from './llm.js';
import { outputReason, outputDiagnostic, evidenceReason, injection, toolAllowed } from './guard.js';
import { extractNeeds } from './extraction.js';
import { scoreNeeds } from './lead-scoring.js';
import { stripPhones, hasPhone } from './privacy.js';
import { moneyAmounts } from './money.js';
@Injectable()
export class AiLlmService {
  complete = complete;
}
@Injectable()
export class AiGuardService {
  outputReason = outputReason;
  outputDiagnostic = outputDiagnostic;
  evidenceReason = evidenceReason;
  injection = injection;
  toolAllowed = toolAllowed;
}
@Injectable()
export class AiExtractionService {
  extractNeeds = extractNeeds;
}
@Injectable()
export class AiScoringService {
  scoreNeeds = scoreNeeds;
}
@Injectable()
export class AiPrivacyService {
  stripPhones = stripPhones;
  hasPhone = hasPhone;
}
@Injectable()
export class AiMoneyService {
  moneyAmounts = moneyAmounts;
}
