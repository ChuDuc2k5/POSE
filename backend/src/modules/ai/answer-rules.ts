export type CriteriaLineInput = {
  searchPerformed: boolean;
  propertyId?: string | null;
  adviceOnly: boolean;
  cards: number;
  criteria: string[];
  transactionOnly: boolean;
};

export function showCriteriaLine(input: CriteriaLineInput): boolean {
  return input.searchPerformed && !input.propertyId && !input.adviceOnly && input.cards > 0 && input.criteria.length > 0 && !input.transactionOnly;
}

export function answerCriteriaLine(criteria: string[]): string {
  return `Tiêu chí: ${criteria.join(', ')}.\n`;
}
