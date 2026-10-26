export const SALES_SUGGESTION_SCORES = {
  primaryTerritory: 100,
  backupTerritory: 60,
  currentOwner: 40,
  propertyKeeper: 20,
  upcomingAppointment: 3,
  openLead: 1,
} as const;

export type TerritoryFact = { district: string; is_backup: boolean };
export type SalesSuggestionFact = {
  sales_id: string;
  name: string;
  territories: TerritoryFact[];
  upcoming_appointments: number;
  open_leads: number;
  is_current_owner: boolean;
};
export type ScoredSalesSuggestion = SalesSuggestionFact & { score: number; recommended: boolean; reasons: string[] };

export function scoreSalesSuggestions(candidates: SalesSuggestionFact[], area: string | null, propertyKeeperId: string | null) {
  const scored = candidates.map(candidate => {
    const primary = candidate.territories.some(t => t.district === area && !t.is_backup);
    const backup = !primary && candidate.territories.some(t => t.district === area && t.is_backup);
    const reasons: string[] = [];
    if (primary) reasons.push(`Phụ trách ${area}`);
    else if (backup) reasons.push(`Hỗ trợ ${area}`);
    if (candidate.is_current_owner) reasons.push('Đang phụ trách Lead này');
    if (propertyKeeperId === candidate.sales_id) reasons.push('Đang giữ căn này');
    if (candidate.upcoming_appointments > 0) reasons.push(`${candidate.upcoming_appointments} lịch hẹn trong 14 ngày tới`);
    const score = (primary ? SALES_SUGGESTION_SCORES.primaryTerritory : backup ? SALES_SUGGESTION_SCORES.backupTerritory : 0)
      + (candidate.is_current_owner ? SALES_SUGGESTION_SCORES.currentOwner : 0)
      + (propertyKeeperId === candidate.sales_id ? SALES_SUGGESTION_SCORES.propertyKeeper : 0)
      - candidate.upcoming_appointments * SALES_SUGGESTION_SCORES.upcomingAppointment
      - candidate.open_leads * SALES_SUGGESTION_SCORES.openLead;
    return { ...candidate, score, recommended: false, reasons };
  }).sort((a, b) => b.score - a.score || Number(b.is_current_owner) - Number(a.is_current_owner) || a.name.localeCompare(b.name, 'vi') || a.sales_id.localeCompare(b.sales_id));
  if (scored.length && !scored.some(item => item.reasons.some(reason => reason.startsWith('Phụ trách') || reason.startsWith('Hỗ trợ')))) {
    scored[0].reasons.push('Chưa có Sales phụ trách khu vực này – gợi ý theo khối lượng việc');
  }
  return scored.slice(0, 5).map((item, index) => ({ ...item, recommended: index === 0 }));
}
