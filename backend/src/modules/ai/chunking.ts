import { createHash } from 'node:crypto';

/** Descriptions at or below this size stay in one chunk. */
export const CHUNK_SINGLE_MAX = 1200;
/** Target maximum chunk size before sentence overlap. */
export const CHUNK_SIZE = 800;
/** Target overlap, composed of complete sentences whenever possible. */
export const CHUNK_OVERLAP = 150;

const contact = /(?:[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}|(?:https?:\/\/|www\.)\S+|(?<![\d+])(?:\+84[ .()-]?[35789](?:[ .()-]?\d){8}|0[35789](?:[ .()-]?\d){8}|\+[1-9](?:[ .()-]?\d){7,14})(?!\d))/giu;
const broker = /\b(?:li[eê]n\s*h[eệ]|hotline|zalo|m[oô]i\s*gi[oớ]i|g[oọ]i|inbox|nh[aắ]n\s*tin|t[uư]\s*v[aấ]n|anh|ch[iị]|mr\.?|ms\.?)\b/iu;
const price = /(?:gi[aá]|m[uứ]c\s*gi[aá]|ch[iỉ]\s*(?:c[oò]n)?|ng[aâ]n\s*s[aá]ch)[^.!?\n]*(?:\d[\d., ]*\s*(?:t[yỷỉ]|tri[eệ]u|vnd|đ[oồ]ng|đ)|th[oỏ]a\s*thu[aậ]n)[^.!?\n]*[.!?]?/giu;
const boundary = /[^.!?;\n]+(?:[.!?;]+|\n+|$)/gu;

export function cleanKnowledgeText(value: string) {
  const text = String(value || '').normalize('NFC').replace(/<[^>]*>/gu, ' ').replace(/[\p{Extended_Pictographic}\p{Emoji_Presentation}\uFE0F\u200D]/gu, ' ')
    .replace(/^[\s•●▪▫◆◇►▶➤→✓✔★☆|=*_–—-]+/gmu, '').replace(price, ' ');
  return text.split(/\n|(?<=[.!?;])\s+/u).filter(part => !broker.test(part) && !contact.test(part)).join(' ')
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
export function propertyHeader(source: PropertyChunkSource) {
  return `Mã ${source.code} · ${source.name} · ${source.location} · ${source.property_type} · ${source.transaction_type === 'Rent' ? 'Cho thuê' : 'Bán'}`;
}
export function propertyChunks(source: PropertyChunkSource) {
  const content = [source.description, source.project_name, source.amenities].filter(Boolean).join('. ');
  const header = propertyHeader(source);
  return splitKnowledgeText(content).map((chunk, chunk_index) => ({ chunk_index, header, content: chunk, embedded: `${header}\n${chunk}` }));
}
export function faqChunks(question:string, answer:string) {
  const header=`Hỏi đáp · ${cleanKnowledgeText(question)}`;
  return splitKnowledgeText(answer).map((content,chunk_index)=>({chunk_index,header,content,embedded:`${header}\n${content}`}));
}
export function contentHash(value:unknown){return createHash('sha256').update(JSON.stringify(value)).digest('hex');}
