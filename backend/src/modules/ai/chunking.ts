import { createHash } from 'node:crypto';

/** Descriptions at or below this size stay in one chunk. */
export const CHUNK_SINGLE_MAX = 1200;
/** Target maximum chunk size before sentence overlap. */
export const CHUNK_SIZE = 800;
/** Target overlap, composed of complete sentences whenever possible. */
export const CHUNK_OVERLAP = 150;

const contact = /(?:[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}|(?:https?:\/\/|www\.)\S+|(?<![\d+])(?:\+84[ .()-]?[35789](?:[ .()-]?\d){8}|0[35789](?:[ .()-]?\d){8}|\+[1-9](?:[ .()-]?\d){7,14})(?!\d))/giu;
const broker = /\b(?:lien\s*he|li\u00ean\s*h\u1ec7|li\u00e3\u00aa\u00a1n|hotline|zalo|moi\s*gioi|m\u00f4i\s*gi\u1edbi|goi|inbox|nhan\s*tin|tu\s*van|anh|chi|mr\.?|ms\.?)\b/iu;
// Bare m/m2, room counts and years are intentionally not money units.
const moneyAmount = /(?:\d[\d., ]*\s*(?:ty|t\u1ef7|t\u00e1\u00bb\u00b7|t\u00e1\u00bb\u0089|trieu|tri\u1ec7u|tri\u00e1\u00bb\u0087u|tr\.?|nghin|ngh\u00ecn|k\b|vnd\b|dong|\u0111ong|\u0111\u1ed3ng|\u00c4\u0091\u00c3\u00b2ng|\u0111|\u00c4\u0091|\u20ab)(?:\s*\/\s*(?:thang|th\u00e1ng|nam|n\u0103m))?)/iu;
const negotiation = /(?:gia|gi\u00e1|gi\u00c3\u00a1|muc\s*gia|m\u1ee9c\s*gi\u00e1|thuong\s*luong|th\u01b0\u01a1ng\s*l\u01b0\u1ee3ng|th\u00c6\u00b0\u00c6\u00a1ng\s*l\u00c6\u00b0\u1ee3ng)/iu;
const price = new RegExp('(?:' + moneyAmount.source + '|' + negotiation.source + ')', 'iu');
const boundary = /[^.!?;\n]+(?:[.!?;]+|\n+|$)/gu;

export function cleanKnowledgeText(value: string) {
  const text = String(value || '').normalize('NFC').replace(/<[^>]*>/gu, ' ').replace(/[\p{Extended_Pictographic}\p{Emoji_Presentation}\uFE0F\u200D]/gu, ' ')
    .replace(/^[\s\u2022\u25cf\u25aa\u25ab\u25c6\u25c7\u25ba\u25b6\u27a4\u2192\u2713\u2714\u2605\u2606|=*_\u2013\u2014-]+/gmu, ' ');
  // Prices are often comma-separated from factual clauses; discard that clause.
  return text.split(/(?<=[.!?;])\s+|\n|,/u).filter(part => !broker.test(part) && !contact.test(part) && !price.test(part)).join(' ')
    .replace(contact, ' ').replace(/\s+/gu, ' ').trim();
}

function sentences(text: string) {
  const parts = text.match(boundary)?.map(value => value.replace(/\s+/gu, ' ').trim()).filter(Boolean) || [];
  return parts.length ? parts : [text];
}

export function splitKnowledgeText(text: string) {
  const clean = cleanKnowledgeText(text);
  if (!clean) return [];
  if (clean.length <= CHUNK_SINGLE_MAX) return [clean];
  const units = sentences(clean), chunks: string[] = [];
  let current: string[] = [];
  const length = (values: string[]) => values.join(' ').length;
  const push = () => { if (current.length) chunks.push(current.join(' ')); };
  for (const unit of units) {
    if (unit.length > CHUNK_SIZE) {
      const words = unit.split(/\s+/u);
      for (const word of words) {
        if (length([...current, word]) > CHUNK_SIZE && current.length) { push(); current = current.slice(-1); }
        current.push(word);
      }
      continue;
    }
    if (length([...current, unit]) > CHUNK_SIZE && current.length) {
      push();
      const overlap: string[] = [];
      for (let i = current.length - 1; i >= 0 && length([current[i], ...overlap]) <= CHUNK_OVERLAP; i--) overlap.unshift(current[i]);
      current = overlap;
    }
    current.push(unit);
  }
  push();
  return chunks;
}

export type PropertyChunkSource = { code:string; name:string; location:string; property_type:string; transaction_type:'Sale'|'Rent'; description:string; project_name?:string|null; amenities?:string|null };
export function propertyHeader(source: PropertyChunkSource) { return `M\u00e3 ${source.code} \u00b7 ${source.name} \u00b7 ${source.location} \u00b7 ${source.property_type} \u00b7 ${source.transaction_type === 'Rent' ? 'Cho thu\u00ea' : 'B\u00e1n'}`; }
export function propertyChunks(source: PropertyChunkSource) { const content = [source.description, source.project_name, source.amenities].filter(Boolean).join('. '); const header = propertyHeader(source); return splitKnowledgeText(content).map((chunk, chunk_index) => ({ chunk_index, header, content: chunk, embedded: `${header}\n${chunk}` })); }
export function faqChunks(question:string, answer:string) { const header=`H\u1ecfi \u0111\u00e1p \u00b7 ${cleanKnowledgeText(question)}`; return splitKnowledgeText(answer).map((content,chunk_index)=>({chunk_index,header,content,embedded:`${header}\n${content}`})); }
export function contentHash(value:unknown){return createHash('sha256').update(JSON.stringify(value)).digest('hex');}
