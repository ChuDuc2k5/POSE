import { inquiryInput, searchParameters } from '../src/common/discovery.js';
import { propertyReturn } from '../../frontend/lib/property-return.js';
const input={property_id:null,name:'Minh Anh',phone:'0912345678',country:'VN',channel:'Email',preferred_time:'Buổi chiều',message:'Tôi muốn tìm căn hộ hai phòng ngủ.',consent:{contact:true,call:false,ai:false,transcript:false,recording:false},request_key:'fe000000-0000-4000-8000-000000000001'};
describe('M03 search, consent and guest input contracts',()=>{
  it('accepts optional phone verification without fabricating evidence',()=>{
    const result=inquiryInput(input);expect(result.fields).toEqual({});expect(result.data.phone).toBe('+84912345678');expect(result.data.consent?.call).toBe(false);
  });
  it('requires a guest email only when Email is the selected contact channel',()=>{
    expect(inquiryInput(input,true).fields.email).toBeDefined();
    expect(inquiryInput({...input,email:' Guest@Example.test '},true).fields).toEqual({});
    expect(inquiryInput({...input,email:' Guest@Example.test '},true).data).toMatchObject({email:'guest@example.test'});
    expect(inquiryInput({...input,channel:'Phone',email:'',consent:{...input.consent,call:true}},true).fields).toEqual({});
  });
  it.each(['user_id','lead_id','phone_verified','browser_session_hash','source'])('rejects forged %s',key=>{
    expect(inquiryInput({...input,email:'guest@example.test',[key]:'forged'},true).fields.form).toBeDefined();
  });
  it('preserves independent consent and rejects a phone channel without call consent',()=>{
    expect(inquiryInput({...input,channel:'Phone'}).fields.channel).toBeDefined();
    expect(inquiryInput({...input,consent:{...input.consent,contact:false}}).fields.consent).toBeDefined();
    expect(inquiryInput({...input,consent:{...input.consent,recording:'true'}}).fields.consent).toBeDefined();
  });
  it.each(['minPrice=9&maxPrice=1','minArea=80&maxArea=20','pageSize=51','page=0','sort=unknown','publication=Hidden','q=x&q=y','bedrooms=1.5'])('rejects invalid search %s',query=>{
    expect(Object.keys(searchParameters(new URLSearchParams(query)).fields).length).toBeGreaterThan(0);
  });
  it('allows valid combined filters',()=>{
    expect(searchParameters(new URLSearchParams('transaction=Rent&minPrice=100&bedrooms=2&sort=priceAsc&page=2')).fields).toEqual({});
  });
  it('keeps only local property search return locations',()=>{
    expect(propertyReturn('/properties?transaction=Rent&page=2')).toBe('/properties?transaction=Rent&page=2');
    for(const value of ['https://evil.example','//evil.example','/admin','/properties?next=https://evil.example','/properties#secret',undefined])expect(propertyReturn(value)).toBe('/properties');
  });
});
