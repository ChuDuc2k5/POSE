import { salesInput, salesListInput } from '../src/common/sales-validation.js';
const create={name:'Nguyễn Sales',email:' SALES@EXAMPLE.TEST ',phone:'0912345678',password:'strong-password-123',confirmPassword:'strong-password-123',request_key:'fa110000-0000-4000-8000-000000000001'};
describe('M11 Sales request validation',()=>{
 it('normalizes internal staff contact details',()=>{expect(salesInput(create,'create')).toMatchObject({fields:{},email:'sales@example.test',phone:'+84912345678'});});
 it.each(['role','app_metadata','active','user_id'])('rejects forged %s on create',field=>{expect(salesInput({...create,[field]:'Admin'},'create').fields.form).toBeDefined();});
 it('requires a valid request key and a matching initial password',()=>{expect(salesInput({...create,request_key:'bad'},'create').fields.form).toBeDefined();expect(salesInput({...create,confirmPassword:'different'},'create').fields.confirmPassword).toBeDefined();expect(salesInput({...create,password:'short',confirmPassword:'short'},'create').fields.password).toBeDefined();});
 it('requires both concurrency versions and a reason for profile updates',()=>{expect(salesInput({name:'Sales',phone:'',version:0,profile_version:0,reason:'Cập nhật'},'update').fields).toEqual({});expect(salesInput({name:'Sales',phone:'',version:0},'update').fields.form).toBeDefined();});
 it('does not accept email or role changes through profile updates',()=>{expect(salesInput({name:'Sales',phone:'',version:0,profile_version:0,reason:'Cập nhật',email:'other@example.test'},'update').fields.form).toBeDefined();});
 it.each(['page=0','pageSize=51','status=Admin','q=x&q=y','role=Sales'])('rejects invalid filter %s',query=>{expect(salesListInput(new URLSearchParams(query)).invalid).toBe(true);});
 it('accepts search and active state together',()=>{expect(salesListInput(new URLSearchParams('q=Sales&status=active&page=2')).invalid).toBe(false);});
});
