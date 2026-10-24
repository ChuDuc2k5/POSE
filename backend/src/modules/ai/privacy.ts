export const phonePattern=/(?<![\d+])(?:\+84[ .()-]?[35789](?:[ .()-]?\d){8}|0[35789](?:[ .()-]?\d){8}|\+[1-9](?:[ .()-]?\d){7,14})(?!\d)/g;
export function stripPhones(text:string) {
  return text.replace(phonePattern,(phone:string,offset:number)=>{
    const after=text.slice(offset+phone.length);
    const thousands=/^\+?\d{1,3}(?:[ .]\d{3})+$/.test(phone);
    const vnInternational=/^\+84[35789]\d{8}$/.test(phone.replace(/[ .()-]/g,''));
    return /^\s*(?:VND|đồng|đ|tỷ|tỉ|triệu)(?![a-z])/i.test(after) || thousands && !vnInternational ? phone:'[đã ẩn số liên hệ]';
  });
}
export function hasPhone(text:string){return stripPhones(text)!==text;}
export function maskEmail(text:string){return text.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,'[email đã ẩn]');}
export function questionPreview(text:string){return maskEmail(stripPhones(text)).replace(/\s+/g,' ').trim().slice(0,160);}
