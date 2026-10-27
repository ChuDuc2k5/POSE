import { createHash } from 'node:crypto';
import { hcmWards } from './hcm-wards.js';

/** Descriptions at or below this size stay in one chunk. */
export const CHUNK_SINGLE_MAX = 1200;
/** Target maximum chunk size before sentence overlap. */
export const CHUNK_SIZE = 800;
/** Target overlap, composed of complete sentences whenever possible. */
export const CHUNK_OVERLAP = 150;
/** Bump when chunk text or headers change (cleaning rules, aliases) so every document is re-indexed. */
export const CHUNKER_VERSION = 'chunker.v3-hcm-wards';

const contact =
  /(?:[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}|(?:https?:\/\/|www\.)\S+|(?<![\d+])(?:\+84[ .()-]?[35789](?:[ .()-]?\d){8}|0[35789](?:[ .()-]?\d){8}|\+[1-9](?:[ .()-]?\d){7,14})(?!\d))/giu;
// Unicode-aware word edges: JS \b is ASCII-only, so "chi" used to match "chi\u1ec1u".
const broker =
  /(?<![\p{L}\p{N}])(?:lien\s*he|li\u00ean\s*h\u1ec7|li\u00e3\u00aa\u00a1n|hotline|zalo|moi\s*gioi|m\u00f4i\s*gi\u1edbi|goi|inbox|nhan\s*tin|tu\s*van|anh|chi|mr\.?|ms\.?)(?![\p{L}\p{N}])/iu;
// Bare m/m2, room counts and years are intentionally not money units.
const moneyAmount =
  /(?:\d[\d., ]*\s*(?:ty|t\u1ef7|t\u00e1\u00bb\u00b7|t\u00e1\u00bb\u0089|trieu|tri\u1ec7u|tri\u00e1\u00bb\u0087u|tr\.?|nghin|ngh\u00ecn|k\b|vnd\b|dong|\u0111ong|\u0111\u1ed3ng|\u00c4\u0091\u00c3\u00b2ng|\u0111|\u00c4\u0091|\u20ab)(?:\s*\/\s*(?:thang|th\u00e1ng|nam|n\u0103m))?)/iu;
// Whole words only; unaccented "gia" counts only before a price cue ("th\u1eddi gian", "gia \u0111\u00ecnh",
// "tham gia" are not prices).
const negotiation =
  /(?<!\p{L})(?:gia(?=\s*(?:ban|thue|:|\d))|gi\u00e1|gi\u00c3\u00a1|muc\s*gia|m\u1ee9c\s*gi\u00e1|thuong\s*luong|th\u01b0\u01a1ng\s*l\u01b0\u1ee3ng|th\u00c6\u00b0\u00c6\u00a1ng\s*l\u00c6\u00b0\u1ee3ng)(?!\p{L})/iu;
const price = new RegExp('(?:' + moneyAmount.source + '|' + negotiation.source + ')', 'iu');
const boundary = /[^.!?;\n]+(?:[.!?;]+|\n+|$)/gu;

// Non-global twin for .test(): a /g regex keeps lastIndex between calls and skips matches.
const hasContact = new RegExp(contact.source, 'iu');
/** `curated` text (reviewed FAQ answers) keeps broker/price wording; contact data is always removed. */
export function cleanKnowledgeText(value: string, curated = false) {
  const text = String(value || '')
    .normalize('NFC')
    .replace(/<[^>]*>/gu, ' ')
    .replace(/[\p{Extended_Pictographic}\p{Emoji_Presentation}\uFE0F\u200D]/gu, ' ')
    .replace(
      /^[\s\u2022\u25cf\u25aa\u25ab\u25c6\u25c7\u25ba\u25b6\u27a4\u2192\u2713\u2714\u2605\u2606|=*_\u2013\u2014-]+/gmu,
      ' ',
    );
  if (curated) return text.replace(contact, ' ').replace(/\s+/gu, ' ').trim();
  // Prices are often comma-separated from factual clauses; discard that clause.
  return text
    .split(/(?<=[.!?;])\s+|\n|,/u)
    .filter((part) => !broker.test(part) && !hasContact.test(part) && !price.test(part))
    .join(' ')
    .replace(contact, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function sentences(text: string) {
  const parts =
    text
      .match(boundary)
      ?.map((value) => value.replace(/\s+/gu, ' ').trim())
      .filter(Boolean) || [];
  return parts.length ? parts : [text];
}

export function splitKnowledgeText(text: string, curated = false) {
  const clean = cleanKnowledgeText(text, curated);
  if (!clean) return [];
  if (clean.length <= CHUNK_SINGLE_MAX) return [clean];
  const units = sentences(clean),
    chunks: string[] = [];
  let current: string[] = [];
  const length = (values: string[]) => values.join(' ').length;
  const push = () => {
    if (current.length) chunks.push(current.join(' '));
  };
  for (const unit of units) {
    if (unit.length > CHUNK_SIZE) {
      const words = unit.split(/\s+/u);
      for (const word of words) {
        if (length([...current, word]) > CHUNK_SIZE && current.length) {
          push();
          current = current.slice(-1);
        }
        current.push(word);
      }
      continue;
    }
    if (length([...current, unit]) > CHUNK_SIZE && current.length) {
      push();
      const overlap: string[] = [];
      for (let i = current.length - 1; i >= 0 && length([current[i], ...overlap]) <= CHUNK_OVERLAP; i--)
        overlap.unshift(current[i]);
      current = overlap;
    }
    current.push(unit);
  }
  push();
  return chunks;
}

export type PropertyChunkSource = {
  code: string;
  name: string;
  location: string;
  property_type: string;
  transaction_type: 'Sale' | 'Rent';
  description: string;
  project_name?: string | null;
  amenities?: string | null;
};
export function districtAliases(source: PropertyChunkSource) {
  const text = [source.name, source.description, source.location, source.project_name, source.amenities]
    .filter(Boolean)
    .join(' ');
  const aliases = new Set<string>();
  for (const match of text.matchAll(/\bQ\.?\s*(\d{1,2})\b/giu)) aliases.add(`Qu\u1eadn ${match[1]}`);
  for (const match of text.matchAll(/\bQu\u1eadn\s+(\d{1,2})\b/giu)) aliases.add(`Qu\u1eadn ${match[1]}`);
  const folded = text.normalize('NFC').toLocaleLowerCase('vi');
  const locationFolded = source.location.normalize('NFC').toLocaleLowerCase('vi');
  for (const row of hcmWards) {
    if (folded.includes(row.ward.toLocaleLowerCase('vi')))
      for (const district of row.formerDistricts)
        if (locationFolded.trim() !== 'thủ đức' || district !== 'Thủ Đức') aliases.add(district);
    if (
      locationFolded.trim() !== 'thủ đức' &&
      row.formerDistricts.some((district) => locationFolded.includes(district.toLocaleLowerCase('vi')))
    )
      aliases.add(row.ward);
  }
  if (/\b(?:TP\.?|Th\u00e0nh\s*ph\u1ed1)\s+Th\u1ee7\s*\u0110\u1ee9c\b/iu.test(text))
    aliases.add('Th\u00e0nh ph\u1ed1 Th\u1ee7 \u0110\u1ee9c');
  return [...aliases];
}
export function propertyHeader(source: PropertyChunkSource) {
  const aliases = districtAliases(source);
  return `M\u00e3 ${source.code} \u00b7 ${source.name} \u00b7 ${source.location}${aliases.length ? ` \u00b7 ${aliases.join(' \u00b7 ')}` : ''} \u00b7 ${source.property_type} \u00b7 ${source.transaction_type === 'Rent' ? 'Cho thu\u00ea' : 'B\u00e1n'}`;
}
export function propertyChunks(source: PropertyChunkSource) {
  const content = [source.description, source.project_name, source.amenities].filter(Boolean).join('. ');
  const header = propertyHeader(source);
  return splitKnowledgeText(content).map((chunk, chunk_index) => ({
    chunk_index,
    header,
    content: chunk,
    embedded: `${header}\n${chunk}`,
  }));
}
export function faqChunks(question: string, answer: string) {
  const header = `H\u1ecfi \u0111\u00e1p \u00b7 ${cleanKnowledgeText(question, true)}`;
  return splitKnowledgeText(answer, true).map((content, chunk_index) => ({
    chunk_index,
    header,
    content,
    embedded: `${header}\n${content}`,
  }));
}
export function contentHash(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
