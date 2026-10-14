import { hasPhone } from './privacy';
import { moneyAmounts } from './money';
export const SCHEMA_VERSION = 'needs.v1';
export const propertyTypes = ['Apartment','House','Land','Villa','Office','Shop'];
export const needFields = ['budget_min_vnd','budget_max_vnd','locations','property_types','timeline','purchase_intent','contact_ready','next_step'];
export type Field = { value: unknown; confidence: number; evidence: string };
export type Needs = Partial<Record<'budget_min_vnd'|'budget_max_vnd'|'locations'|'property_types'|'timeline'|'purchase_intent'|'contact_ready'|'next_step', Field>>;
export function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
export function validValue(key: string, value: unknown) {
  if (key==='budget_min_vnd' || key==='budget_max_vnd') return typeof value==='number' && Number.isFinite(value) && value>0 && value<=1e15;
  if (key==='locations' || key==='property_types') return Array.isArray(value) && value.length>0 && value.length<=10 && value.every(v=>typeof v==='string' && v.length>0 && v.length<=120 && (key==='locations' || propertyTypes.includes(v)));
  if (key==='timeline') return ['lt3m','3to6m','gt6m','none'].includes(value as string);
  if (key==='next_step') return ['none','consult','appointment'].includes(value as string);
  return ['purchase_intent','contact_ready'].includes(key) && typeof value==='boolean';
}
function timelineValue(quote:string) {
  if (/năm sau/i.test(quote)) return 'gt6m';
  const time=quote.match(/(\d+(?:[.,]\d+)?)\s*(tháng|tuần|năm)/i);
  if(time){const months=Number(time[1].replace(',','.'))*(time[2].toLowerCase()==='năm' ? 12:time[2].toLowerCase()==='tuần' ? 7/30:1);return months<3 ? 'lt3m':months<=6 ? '3to6m':'gt6m';}
  if (/sắp|tháng tới|tháng sau|tuần tới|tuần sau|ngay/i.test(quote)) return 'lt3m';
  return null;
}
const typeWords=[['Apartment',/căn hộ|chung cư/i],['House',/nhà phố|nhà riêng/i],['Land',/đất(?: nền)?/i],['Villa',/biệt thự/i],['Office',/văn phòng/i],['Shop',/shophouse|mặt bằng/i]] as const;
export function extractNeeds(raw: unknown, source: string, onDrop?:(key:string,field:unknown)=>void): Needs {
  if (!object(raw)) throw new Error('INVALID_NEEDS');
  const result: Needs = {};
  for (const [key, field] of Object.entries(raw)) {
    const drop=()=>onDrop?.(key,field);
    if (!object(field) || Object.keys(field).some(k=>!['value','confidence','evidence'].includes(k)) || !needFields.includes(key) || typeof field.evidence!=='string') {drop();continue;}
    const quote=field.evidence.trim(), index=source.indexOf(quote);
    if (!quote || index<0 || hasPhone(quote)) {drop();continue;}
    const boundaries=[...source.matchAll(/(?<!\d)[.!?](?!\d)|\n/g)].map(m=>m.index!);
    const start=boundaries.filter(i=>i<index).at(-1) ?? -1,end=boundaries.find(i=>i>=index+quote.length) ?? source.length;
    const sentence=source.slice(start+1,end);
    if (/ví dụ|không phải|chưa|giả sử|không muốn|không có|không mua|example|not my|don't|haven't/i.test(sentence)) {drop();continue;}
    let value=field.value;
    if(key==='locations' && typeof value==='string')value=[value];
    if(key==='locations' && (!validValue(key,value) || !(value as string[]).every(location=>quote.toLocaleLowerCase('vi').includes(location.toLocaleLowerCase('vi'))))){drop();continue;}
    if(key==='property_types'){value=typeWords.filter(([,pattern])=>pattern.test(quote)).map(([type])=>type);if(!(value as string[]).length){drop();continue;}}
    if(key==='timeline'){value=timelineValue(quote);if(!value){drop();continue;}}
    if(!validValue(key,value)){drop();continue;}
    if(key.startsWith('budget_') && !moneyAmounts(quote).includes(value as number)){drop();continue;}
    result[key as keyof Needs]={value,confidence:1,evidence:quote};
  }
  if (result.budget_min_vnd && result.budget_max_vnd && Number(result.budget_min_vnd.value)>Number(result.budget_max_vnd.value)) { onDrop?.('budget_min_vnd',result.budget_min_vnd);onDrop?.('budget_max_vnd',result.budget_max_vnd);delete result.budget_min_vnd; delete result.budget_max_vnd; }
  return result;
}
