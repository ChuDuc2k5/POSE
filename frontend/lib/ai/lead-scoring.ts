export const RULE_VERSION='BR-04.v1';
export const dimensions=['budget','area_type','timeline','contact','next_step'] as const;
export type Dimension=typeof dimensions[number];
export type ScoreInput={ intent: boolean; budget?: {value:'none'|'partial'|'match';evidence:string}; area_type?:{value:'none'|'one'|'both';evidence:string}; timeline?:{value:'none'|'gt6m'|'3to6m'|'lt3m';evidence:string}; contact?:{value:'none'|'verified'|'ready';evidence:string}; next_step?:{value:'none'|'consult'|'appointment';evidence:string} };
const points={budget:{none:0,partial:15,match:30},area_type:{none:0,one:12,both:25},timeline:{none:0,gt6m:0,'3to6m':10,lt3m:20},contact:{none:0,verified:8,ready:15},next_step:{none:0,consult:5,appointment:10}};
export function classifyScore(score:number,evidenceDimensions:number,intent:boolean) {
  return !Number.isInteger(score) || score<0 || score>100 || evidenceDimensions<3 || !intent ? 'Unrated':score>=80 ? 'Hot':score>=50 ? 'Warm':'Cold';
}
export function scoreLead(input: ScoreInput) {
  const unknown: Dimension[]=[];
  const breakdown=Object.fromEntries(dimensions.map(key=>{
    const field=input[key],table=points[key] as Record<string,number>;
    if (!field?.evidence.trim() || !Object.hasOwn(table,field.value)) { unknown.push(key); return [key,{points:0,value:null,evidence:null}]; }
    return [key,{points:table[field.value],value:field.value,evidence:field.evidence}];
  })) as Record<Dimension,{points:number;value:string|null;evidence:string|null}>;
  const score=dimensions.reduce((sum,key)=>sum+breakdown[key].points,0);
  const classification=classifyScore(score,5-unknown.length,input.intent===true);
  return {score,classification,breakdown,unknown,rule_version:RULE_VERSION,intent:input.intent===true};
}
export function scoreNeeds(needs:Record<string,{value:unknown;evidence?:string}>,properties:{price:number|null;location:string;property_type:string;availability:string}[],verified:boolean) {
  properties=properties.filter(p=>p.availability==='Available');
  const input:ScoreInput={intent:needs.purchase_intent?.value===true};
  const quote=(key:string)=>needs[key]?.evidence || '';
  const min=needs.budget_min_vnd,max=needs.budget_max_vnd;
  const prices=properties.flatMap(p=>p.price===null ? []:[p.price]);
  if ((min || max) && prices.length) {
    const low=min ? Number(min.value):0,high=max ? Number(max.value):Infinity;
    input.budget={value:prices.some(p=>p>=low && p<=high) ? 'match':Math.max(...prices)>=low && Math.min(...prices)<=high ? 'partial':'none',evidence:[quote('budget_min_vnd'),quote('budget_max_vnd')].filter(Boolean).join(' / ')};
  }
  if(properties.length && (needs.locations || needs.property_types)) {
    const locations=needs.locations?.value as string[]|undefined,types=needs.property_types?.value as string[]|undefined;
    const matches=properties.map(p=>[locations?.some(v=>p.location.toLowerCase().includes(v.toLowerCase())) || false,types?.includes(p.property_type) || false]);
    input.area_type={value:matches.some(m=>m[0]&&m[1]) ? 'both':matches.some(m=>m[0]||m[1]) ? 'one':'none',evidence:[quote('locations'),quote('property_types')].filter(Boolean).join(' / ')};
  }
  if(needs.timeline)input.timeline={value:needs.timeline.value as NonNullable<ScoreInput['timeline']>['value'],evidence:quote('timeline')};
  input.contact={value:verified ? needs.contact_ready?.value===true ? 'ready':'verified':'none',evidence:verified ? quote('contact_ready') || 'Số tài khoản đã xác minh':'Tài khoản chưa có số đã xác minh'};
  if(needs.next_step)input.next_step={value:needs.next_step.value as NonNullable<ScoreInput['next_step']>['value'],evidence:quote('next_step')};
  return scoreLead(input);
}
