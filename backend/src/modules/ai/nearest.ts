export function lowestPriced<T extends { price?: number | null }>(items: T[], limit = 3) {
  return [...items]
    .filter((item) => typeof item.price === 'number' && Number.isFinite(item.price))
    .sort((left, right) => (left.price as number) - (right.price as number))
    .slice(0, limit);
}

export function nearestRelaxationStages(filters: Record<string, unknown>, prioritizeSecondary = false) {
  const omit = (keys: string[]) => Object.fromEntries(Object.entries(filters).filter(([key]) => !keys.includes(key)));
  const stages: { filters: Record<string, unknown>; reason: string }[] = [];
  if (prioritizeSecondary && filters.bedrooms !== undefined)
    stages.push({ filters: omit(['bedrooms']), reason: 'Lệch tiêu chí: số phòng ngủ' });
  if (prioritizeSecondary && (filters.minArea !== undefined || filters.maxArea !== undefined))
    stages.push({ filters: omit(['minArea', 'maxArea']), reason: 'Lệch tiêu chí: diện tích' });
  if (filters.minPrice !== undefined || filters.maxPrice !== undefined)
    stages.push({ filters: omit(['minPrice', 'maxPrice', 'maxPriceExclusive']), reason: 'Ngoài ngân sách đã nêu' });
  if (!prioritizeSecondary && (filters.minArea !== undefined || filters.maxArea !== undefined))
    stages.push({ filters: omit(['minArea', 'maxArea']), reason: 'Nới diện tích đã nêu' });
  if (filters.location !== undefined || filters.locations !== undefined)
    stages.push({ filters: omit(['location', 'locations', 'location_aliases']), reason: 'Khác khu vực đã nêu' });
  const finalFilters = Object.fromEntries(
    Object.entries(filters).filter(([key]) => key === 'transaction_type' || key === 'type' || key === 'types'),
  );
  stages.push({ filters: finalFilters, reason: 'Nới ngân sách, diện tích, phòng ngủ và khu vực' });
  return stages;
}

export function nearestReasonForReply(reason: string) {
  return reason === 'Ngoài ngân sách đã nêu' ? 'giá vượt ngân sách đã nêu' : reason.toLocaleLowerCase('vi');
}
