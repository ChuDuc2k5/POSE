import { appointmentQuery, validateAppointment } from '../src/modules/appointments/appointments.validation.js';
import {
  appointmentDate,
  appointmentInstant,
  appointmentLocal,
  appointmentOverdue,
  appointmentParams,
  appointmentStatusLabels,
  appointmentDisplayStatusLabels,
  initialAppointmentFilters,
  type Appointment,
} from '../../frontend/lib/appointments.js';
const id = '00000000-0000-4000-8000-000000000001';
const data = {
  lead_id: id,
  request_key: id,
  title: 'Tư vấn nhu cầu',
  starts_at: '2027-01-01T09:00:00+07:00',
  ends_at: '2027-01-01T10:00:00+07:00',
  channel: 'Phone',
  location: '',
  notes: '',
  property_id: null,
};
describe('Appointment input boundary', () => {
  it('accepts manual create without caller-controlled Sales or status', () => {
    expect(validateAppointment({ data }, true)).toEqual({});
    expect(validateAppointment({ data: { ...data, sales_id: id } }, true)).toHaveProperty('form');
    expect(validateAppointment({ data: { ...data, status: 'COMPLETED' } }, true)).toHaveProperty('form');
    expect(validateAppointment({ data, version: 1 }, true)).toHaveProperty('action');
  });
  it('rejects invalid calendar dates, missing offsets and reversed slots', () => {
    for (const start of ['2027-02-30T09:00:00+07:00', '2027-01-01T09:00:00', 'infinity'])
      expect(validateAppointment({ data: { ...data, starts_at: start } }, true)).toHaveProperty('time');
    expect(validateAppointment({ data: { ...data, ends_at: data.starts_at } }, true)).toHaveProperty('time');
  });
  it('requires the location or a safe meeting link for the channel', () => {
    expect(validateAppointment({ data: { ...data, channel: 'InPerson' } }, true)).toHaveProperty('location');
    expect(
      validateAppointment({ data: { ...data, channel: 'Online', location: 'javascript:alert(1)' } }, true),
    ).toHaveProperty('location');
    expect(
      validateAppointment({ data: { ...data, channel: 'Online', location: 'https://meet.example.test/room' } }, true),
    ).toEqual({});
  });
  it('requires reasons for reschedules/cancellation and rejects stale versions', () => {
    expect(validateAppointment({ action: 'cancel', version: 0, data: {}, reason: 'Khách đổi kế hoạch' })).toEqual({});
    expect(validateAppointment({ action: 'cancel', version: 0, data: {} })).toHaveProperty('reason');
    expect(
      validateAppointment({
        action: 'reschedule',
        version: 0,
        data: { starts_at: data.starts_at, ends_at: data.ends_at },
        reason: '',
      }),
    ).toHaveProperty('reason');
    expect(validateAppointment({ action: 'cancel', version: -1, data: {}, reason: 'Hủy lịch' })).toHaveProperty(
      'version',
    );
  });
  it('requires completion results and limits administrative corrections to appointment fields', () => {
    expect(validateAppointment({ action: 'complete', version: 0, data: { result: '' } })).toHaveProperty('result');
    expect(
      validateAppointment({ action: 'complete', version: 0, data: { result: 'Khách muốn xem thêm', lead_score: 100 } }),
    ).toHaveProperty('form');
    const { lead_id: _lead, request_key: _key, ...full } = data;
    expect(
      validateAppointment({
        action: 'correct',
        version: 1,
        reason: 'Sửa kết quả ghi nhầm',
        data: { ...full, status: 'COMPLETED', result: 'Đã tư vấn', cancel_reason: '' },
      }),
    ).toEqual({});
    expect(
      validateAppointment({
        action: 'correct',
        version: 1,
        reason: 'Sửa lại',
        data: { ...full, status: 'SCHEDULED', result: 'Đã tư vấn', cancel_reason: '' },
      }),
    ).toHaveProperty('result');
  });
  it('validates list, date and lookup filters strictly', () => {
    const query = (q: string, lookup = false) => appointmentQuery(new URLSearchParams(q), lookup);
    expect(query('date_from=2027-01-01&date_to=2027-01-31&status=SCHEDULED').fields).toEqual({});
    expect(query('date_from=2027-02-30').fields).toHaveProperty('date_from');
    expect(query('date_from=2027-02-01&date_to=2027-01-01').fields).toHaveProperty('date');
    for (const q of ['status=NO_SHOW', 'pageSize=1000', 'status=SCHEDULED&status=CANCELLED', 'source=AI'])
      expect(Object.keys(query(q).fields).length).toBeGreaterThan(0);
    expect(query('kind=properties', true).fields).toHaveProperty('kind');
    expect(query('kind=properties&lead_id=' + id, true).fields).toEqual({});
  });
});
describe('Vietnam appointment times and scope', () => {
  it('uses Vietnam wall time regardless of browser/server timezone', () => {
    expect(appointmentInstant('2027-01-01T00:00')).toBe('2026-12-31T17:00:00.000Z');
    expect(appointmentLocal('2026-12-31T17:00:00Z')).toBe('2027-01-01T00:00');
    expect(() => appointmentInstant('2027-02-30T09:00')).toThrow();
  });
  it('does not send other Sales scope from a persisted filter', () => {
    const f = { ...initialAppointmentFilters('2027-01-01'), sales_id: id };
    expect(appointmentParams(f, 'Sales').has('sales_id')).toBe(false);
    expect(appointmentParams(f, 'Admin').get('sales_id')).toBe(id);
  });
  it('marks only scheduled appointments overdue, without changing status', () => {
    const ap = { status: 'SCHEDULED', ends_at: '2027-01-01T10:00:00+07:00' } as Appointment;
    const now = Date.parse('2027-01-01T11:00:00+07:00');
    expect(appointmentOverdue(ap, now)).toBe(true);
    expect(appointmentOverdue({ ...ap, status: 'COMPLETED' }, now)).toBe(false);
    expect(ap.status).toBe('SCHEDULED');
  });
  it('displays missing legacy times safely and keeps old statuses out of editable choices', () => {
    expect(appointmentDate(null)).toBe('Chưa có giờ kết thúc');
    expect(appointmentLocal(null)).toBe('');
    expect(appointmentOverdue({ status: 'SCHEDULED', ends_at: null } as Appointment)).toBe(false);
    expect(Object.keys(appointmentStatusLabels)).toEqual(['SCHEDULED', 'COMPLETED', 'CANCELLED']);
    expect(appointmentDisplayStatusLabels.NO_SHOW).toContain('lịch cũ');
    expect(appointmentDisplayStatusLabels.CONFIRMED).toContain('lịch cũ');
  });
});
