/** Normalize importer prefixes and field-heavy raw listing titles. */
export function displayListingName(value: string | null | undefined): string {
  const input=String(value || '').trim();
  const prefix=['M',String.fromCodePoint(0x00e3),' căn:'].join('');
  if(input.toLocaleLowerCase('vi').startsWith(prefix.toLocaleLowerCase('vi'))) return input.slice(prefix.length).trim();
  return input || ['C',String.fromCodePoint(0x0103),'n h',String.fromCodePoint(0x1ed9),' ',String.fromCodePoint(0x0111),'ang c',String.fromCodePoint(0x1ead),'p nh',String.fromCodePoint(0x1ead),'t'].join('');
}
export function shortListingName(value: string | null | undefined): string {
  const raw=displayListingName(value);
  const folded=[...raw.normalize('NFD')].filter(char=>{const code=char.codePointAt(0) || 0; return code<0x300 || code>0x36f;}).join('').replace(String.fromCodePoint(0x0111),'d').toLocaleLowerCase('vi');
  const markers=['loai can:','loai hd:','noi that:','gia thue:','gia ban:','dien tich:'];
  const typeStart=folded.indexOf('loai can:');
  if (typeStart<0 || !markers.some(marker=>folded.includes(marker))) return raw;
  const type=folded.slice(typeStart+'loai can:'.length).split(/loai hd:|noi that:|gia thue:|gia ban:|dien tich:/u)[0].trim();
  const lead=folded.slice(0,typeStart).replace(/^bs\s+/u,'').trim();
  return ['Can ho', type, lead ? `- ${lead}` : ''].filter(Boolean).join(' ').trim();
}
