export function lowestPriced<T extends { price?: number | null }>(items: T[], limit = 3) {
  return [...items]
    .filter(item => typeof item.price === 'number' && Number.isFinite(item.price))
    .sort((left, right) => (left.price as number) - (right.price as number))
    .slice(0, limit);
}
