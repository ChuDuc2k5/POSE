import { salesQuery, validateSalesMutation } from '../src/modules/sales/sales.validation.js';
const id = '00000000-0000-4000-8000-000000000001';
const activity = () => ({
  version: 0,
  action: 'activity_create',
  data: {
    request_key: id,
    occurred_at: '2026-01-01T09:00:00+07:00',
    channel: 'Phone',
    content: 'Tư vấn theo nhu cầu',
    feedback: '',
    property_ids: [],
  },
});
describe('Sales input boundaries', () => {
  it('accepts backdated activity and rejects future/local dates', () => {
    expect(validateSalesMutation(activity())).toEqual({});
    for (const occurred_at of ['2026-01-01T09:00', '2099-01-01T09:00:00Z', 'invalid'])
      expect(validateSalesMutation({ ...activity(), data: { ...activity().data, occurred_at } })).toHaveProperty(
        'occurred_at',
      );
  });
  it('rejects injected scores, arbitrary actions and duplicate properties', () => {
    expect(validateSalesMutation({ ...activity(), data: { ...activity().data, lead_score: 100 } })).toHaveProperty(
      'form',
    );
    expect(validateSalesMutation({ ...activity(), action: 'transfer' })).toHaveProperty('action');
    expect(
      validateSalesMutation({ ...activity(), data: { ...activity().data, property_ids: [id, id] } }),
    ).toHaveProperty('property_ids');
    expect(validateSalesMutation({ ...activity(), temperature: 'HOT' })).toHaveProperty('form');
  });
  it('requires revision and reason to edit/cancel, never accepts a replacement author', () => {
    const edit = {
      version: 1,
      action: 'activity_edit',
      reason: 'Khách bổ sung',
      data: { ...activity().data, request_key: undefined, activity_id: id, activity_version: 0 },
    };
    delete edit.data.request_key;
    expect(validateSalesMutation(edit)).toEqual({});
    expect(validateSalesMutation({ ...edit, reason: '' })).toHaveProperty('reason');
    expect(validateSalesMutation({ ...edit, data: { ...edit.data, sales_id: id } })).toHaveProperty('form');
    expect(
      validateSalesMutation({
        version: 1,
        action: 'activity_cancel',
        reason: 'Ghi nhầm',
        data: { activity_id: id, activity_version: 0 },
      }),
    ).toEqual({});
  });
  it('reuses M04 needs and result validation without permitting assignment/score edits', () => {
    expect(
      validateSalesMutation({
        version: 0,
        action: 'result',
        reason: 'Khách xác nhận mua',
        data: { status: 'CONVERTED' },
      }),
    ).toHaveProperty('purchase');
    expect(
      validateSalesMutation({ version: 0, action: 'result', reason: 'Khách tạm hoãn', data: { status: 'LOST' } }),
    ).toEqual({});
    expect(
      validateSalesMutation({
        version: 0,
        action: 'confirm_needs',
        reason: 'Khách xác nhận',
        data: { lead_score: 100 },
      }),
    ).toHaveProperty('form');
  });
  it('validates filters per resource and bounds page sizes', () => {
    expect(salesQuery(new URLSearchParams('lead_id=' + id + '&channel=Phone'), 'activities').fields).toEqual({});
    for (const params of ['pageSize=51', 'channel=Unknown', 'q=a&q=b', 'sales_id=other'])
      expect(Object.keys(salesQuery(new URLSearchParams(params), 'activities').fields).length).toBeGreaterThan(0);
    expect(salesQuery(new URLSearchParams('publication=Hidden'), 'leads').fields).toHaveProperty('form');
    expect(salesQuery(new URLSearchParams('archived=true'), 'leads').filters).toEqual({ archived: 'true' });
  });
});
