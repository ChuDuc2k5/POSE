import { validateLeadMutation, leadListQuery } from '../src/modules/leads/leads.validation.js';
import { leadDatabaseError } from '../src/modules/leads/leads.handlers.js';

const uuid = '00000000-0000-4000-8000-000000000001';
describe('M04 request boundaries', () => {
  it('rejects attempts to write scores, identities or arbitrary needs', () => {
    for (const data of [{ lead_score: 100 }, { temperature: 'HOT' }, { customer_id: uuid }, { needs: { confirmed_by: uuid } }]) {
      expect(validateLeadMutation({ action: 'profile', version: 0, reason: 'Cập nhật', data }).form).toBeDefined();
    }
    expect(validateLeadMutation({ action: 'accept', version: 0, data: { actor_id: uuid } }).form).toBeDefined();
  });
  it('keeps unknown budget nullable and validates priority vs mandatory criteria', () => {
    const data = { locations: ['Thủ Đức'], property_types: ['Apartment'], budget_min: null, budget_max: null,
      buying_purpose: '', expected_timeline: null, notes: '', management: {} };
    expect(validateLeadMutation({ action: 'profile', version: 2, reason: 'Khách xác nhận', data })).toEqual({});
    expect(validateLeadMutation({ action: 'profile', version: 2, reason: 'Khách xác nhận', data: { ...data, budget_min: 4e9, budget_max: 3e9 } }).budget).toBeDefined();
    expect(validateLeadMutation({ action: 'profile', version: 2, reason: 'Khách xác nhận', data: { ...data, management: { bedrooms_required: true } } }).management).toBeDefined();
  });
  it('requires purchase evidence and a reason without imposing a status sequence', () => {
    expect(validateLeadMutation({ action: 'status', version: 3, data: { status: 'CONVERTED' }, reason: 'Khách mua nhà' }).purchase).toBeDefined();
    expect(validateLeadMutation({ action: 'status', version: 3, data: { status: 'CONVERTED', property_id: uuid, purchased_at: '2026-10-01' }, reason: 'Khách mua nhà' })).toEqual({});
    expect(validateLeadMutation({ action: 'status', version: 3, data: { status: 'LOST' }, reason: '' }).reason).toBeDefined();
    expect(validateLeadMutation({ action: 'status', version: 3, data: { status: 'FOLLOW_UP' }, reason: 'Hẹn trao đổi lại' })).toEqual({});
  });
  it('bounds list requests and rejects duplicate or forged filter keys', () => {
    expect(leadListQuery(new URLSearchParams('pageSize=51')).fields.page).toBeDefined();
    expect(leadListQuery(new URLSearchParams('status=NEW&status=LOST')).fields.form).toBeDefined();
    expect(leadListQuery(new URLSearchParams('role=Admin')).fields.form).toBeDefined();
    expect(leadListQuery(new URLSearchParams('temperature=UNRATED&assignment=unassigned')).fields).toEqual({});
  });
  it('rejects removed seller transfer and approval actions', () => {
    for (const action of ['request_transfer', 'approve_transfer', 'reject_transfer']) {
      expect(validateLeadMutation({ action, version: 0, data: {}, reason: 'Thay đổi người phụ trách' }).action).toBeDefined();
    }
  });
  it('does not expose database details in API errors', async () => {
    expect((await leadDatabaseError({ code: '42501', message: 'internal table secret' }).json()).message).not.toContain('secret');
    expect(leadDatabaseError({ code: 'PGRST202' }).status).toBe(503);
    expect(leadDatabaseError({ code: '40001' }).status).toBe(409);
  });
});
