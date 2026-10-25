import { priceLabel, validateCatalog, validateCatalogLifecycle } from '../src/common/catalog.js';

const project={code:'PRJ-01',name:'Dự án kiểm thử',location:'Hồ Chí Minh',description:'',amenities:'',archived:false,version:0};
const property={code:'P-01',name:'Căn hộ kiểm thử',location:'Hồ Chí Minh',description:'Mô tả căn hộ có đủ thông tin công bố.',version:0,project_id:'fc100000-0000-4000-8000-000000000001',subdivision_id:null,property_type:'Apartment',area:80,bedrooms:2,price:null,publication:'Draft',availability:'Unavailable'};

describe('M02 input contracts',()=>{
  it('allows valid projects, subdivisions and products with an unknown price',()=>{
    expect(validateCatalog('projects',project)).toEqual({});
    expect(validateCatalog('subdivisions',{...project,project_id:property.project_id})).toEqual({});
    expect(validateCatalog('properties',property)).toEqual({});
    expect(priceLabel(null)).toBe('Liên hệ');
  });
  it.each(['created_by','deleted_at','deleted_by','actor_id','id'])('rejects client-controlled %s',field=>{
    expect(validateCatalog('properties',{...property,[field]:'forged'}).form).toBeDefined();
  });
  it.each([0,-1,Infinity,NaN,'80'])('rejects invalid area %s',area=>{
    expect(validateCatalog('properties',{...property,area}).area).toBeDefined();
  });
  it.each([0,-1,Infinity,'100'])('rejects invalid price %s',price=>{
    expect(validateCatalog('properties',{...property,price}).price).toBeDefined();
  });
  it('requires publication content and preserves independent sale availability',()=>{
    expect(validateCatalog('properties',{...property,publication:'Published',description:'ngắn'}).description).toBeDefined();
    expect(validateCatalog('properties',{...property,publication:'Published',availability:'Sold'})).toEqual({});
  });
  it('requires explicit integer versions and a meaningful lifecycle reason',()=>{
    expect(validateCatalogLifecycle({version:1,reason:'Xóa bài trùng'})).toEqual({});
    for(const version of [undefined,null,-1,1.5,'1']) expect(validateCatalogLifecycle({version,reason:'Khôi phục'}).version).toBeDefined();
    for(const reason of ['', '  ', 'ab', 'a'.repeat(1001), null]) expect(validateCatalogLifecycle({version:0,reason}).reason).toBeDefined();
    expect(validateCatalogLifecycle({version:0,reason:'Khôi phục',created_by:'forged'}).form).toBeDefined();
  });
});
