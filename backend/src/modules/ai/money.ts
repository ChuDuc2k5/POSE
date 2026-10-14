import { stripPhones } from './privacy.ts';
export function moneyAmounts(text:string):number[] {
  const amounts:number[]=[];
  const pattern=/(?<![a-z\d_])(\d{1,3}(?:[., ]\d{3})+(?:[,.]\d{1,2})?|\d+(?:[,.]\d{1,2})?)\s*(tỷ|tỉ|triệu|nghìn|ngàn|VND|đồng|đ)?(?![a-z\d])/gi;
  const words:Record<string,number>={'một':1,'hai':2,'ba':3,'bốn':4,'năm':5,'sáu':6,'bảy':7,'tám':8,'chín':9,'mười':10};
  const normalized=stripPhones(text).replace(/[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}/gi,'').replace(/(một|hai|ba|bốn|năm|sáu|bảy|tám|chín|mười)\s+(tỷ|tỉ|triệu|nghìn|ngàn|đồng)/gi,(_,word:string,unit:string)=>`${words[word.toLowerCase()]} ${unit}`);
  for(const match of normalized.matchAll(pattern)){
    const raw=match[1],unit=match[2]?.toLowerCase();
    if(!unit && !/[., ]\d{3}/.test(raw) && raw.length<7)continue;
    const grouped=/^\d{1,3}(?:[., ]\d{3})+$/.test(raw);
    const decimalGroups=raw.match(/^(\d{1,3}(?:[., ]\d{3})+)([,.]\d{1,2})$/);
    const number=Number(grouped ? raw.replace(/[., ]/g,''):decimalGroups ? decimalGroups[1].replace(/[., ]/g,'')+decimalGroups[2].replace(',','.'):raw.replace(/ /g,'').replace(',','.'));
    const multiplier=unit==='tỷ' || unit==='tỉ' ? 1e9:unit==='triệu' ? 1e6:unit==='nghìn' || unit==='ngàn' ? 1e3:1;
    if(Number.isFinite(number))amounts.push(Math.round(number*multiplier*100)/100);
  }
  return amounts;
}
