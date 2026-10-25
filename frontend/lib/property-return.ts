const allowed=new Set(['q','location','transaction','project','type','minPrice','maxPrice','minArea','maxArea','bedrooms','availability','sort','page','pageSize','snapshot']);
export function propertyReturn(value:unknown):string {
  if(typeof value!=='string'||value.length>2000)return '/properties';
  try{
    const url=new URL(value,'https://terava.local');
    if(url.origin!=='https://terava.local'||url.pathname!=='/properties'||url.hash)return '/properties';
    for(const key of url.searchParams.keys())if(!allowed.has(key)||url.searchParams.getAll(key).length!==1)return '/properties';
    return `/properties${url.search}`;
  }catch{return '/properties';}
}
