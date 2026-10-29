type BedroomText = {
  name?: string | null;
  header?: string | null;
  description?: string | null;
  details?: string | null;
  bedrooms?: number | null;
};

const roomCountPattern = /(?<![\p{L}\d])(\d+)\s*(?:PN|phòng\s*ngủ|phòng)(?![\p{L}\d])/iu;
const studioPattern = /(?<![\p{L}\d])(?:studio|0\s*(?:PN|phòng\s*ngủ|phòng)|1\s*(?:PN|phòng\s*ngủ))(?![\p{L}\d])/iu;

export function bedroomText(item: BedroomText) {
  return [item.name, item.header, item.description, item.details].filter((value) => value != null).join(' ');
}

export function isStudioListing(item: BedroomText) {
  return studioPattern.test([item.name, item.header].filter((value) => value != null).join(' '));
}

export function statedBedroomCount(item: BedroomText) {
  const match = bedroomText(item).match(roomCountPattern);
  return match ? Number(match[1]) : undefined;
}

/** Mirrors the catalogue/RAG bedroom rule: unknown rows remain eligible, but studio text is 0/1 bedroom. */
export function bedroomMatchesFilter(item: BedroomText, requested: number) {
  if (typeof item.bedrooms === 'number') return item.bedrooms === requested;
  if (isStudioListing(item)) return requested <= 1;
  const count = statedBedroomCount(item);
  return count === undefined || count === requested;
}
