import { hasPhone } from './privacy';
import { moneyAmounts } from './money';
export const SCHEMA_VERSION = 'needs.v1';
export const propertyTypes = ['Apartment','House','Land','Villa','Office','Shop'];
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
export function extractNeeds(raw: unknown, source: string): Needs {
  if (!object(raw)) throw new Error('INVALID_NEEDS');
  const result: Needs = {};
  for (const [key, field] of Object.entries(raw)) {
    if (!object(field) || Object.keys(field).some(k=>!['value','confidence','evidence'].includes(k)) || !validValue(key,field.value) || typeof field.confidence!=='number' || !Number.isFinite(field.confidence) || field.confidence<0 || field.confidence>1 || typeof field.evidence!=='string') throw new Error('INVALID_NEEDS');
    const quote=field.evidence.trim(), index=source.indexOf(quote);
    if (!quote || index<0 || hasPhone(quote)) continue;
    const boundaries=[...source.matchAll(/(?<!\d)[.!?](?!\d)|\n/g)].map(m=>m.index!);
    const start=boundaries.filter(i=>i<index).at(-1) ?? -1,end=boundaries.find(i=>i>=index+quote.length) ?? source.length;
    const sentence=source.slice(start+1,end);
    if (/ví dụ|không phải|chưa|giả sử|không muốn|không có|không mua|example|not my|don't|haven't/i.test(sentence)) continue;
    if (key.startsWith('budget_')) {
      if (!moneyAmounts(quote).includes(field.value as number)) continue;
    }
    result[key as keyof Needs]={value:field.value,confidence:field.confidence,evidence:quote};
  }
  if (result.budget_min_vnd && result.budget_max_vnd && Number(result.budget_min_vnd.value)>Number(result.budget_max_vnd.value)) { delete result.budget_min_vnd; delete result.budget_max_vnd; }
  return result;
}
