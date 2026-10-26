import { reportQuery, reportToday } from '../src/modules/reports/reports.validation.js';
import { initialReportFilters, reportParams, reportRange, reportRangeError, resolvedReportFilters } from '../../frontend/lib/reports.js';
describe('Lead report date and filter contract', () => {
  const today = '2026-10-26';
  it('uses Vietnam date boundaries for defaults and presets', () => {
    expect(reportToday(new Date('2026-01-01T16:59:59Z'))).toBe('2026-01-01');
    expect(reportToday(new Date('2026-01-01T17:00:00Z'))).toBe('2026-01-02');
    expect(reportQuery(new URLSearchParams(), today)).toEqual({ filters: { date_from: '2026-10-01', date_to: today, archived: 'all' }, fields: {} });
    expect(reportRange('previous_month', '2024-03-01')).toEqual({ date_from: '2024-02-01', date_to: '2024-02-29' });
    expect(reportRange('last7', '2026-01-03')).toEqual({ date_from: '2025-12-28', date_to: '2026-01-03' });
  });
  it.each(['date_from=2026-10-01', 'date_from=&date_to=', 'date_from=2025-02-29&date_to=2025-03-01', 'date_from=2026-10-27&date_to=2026-10-27', 'date_from=2026-10-02&date_to=2026-10-01', 'date_from=2000-01-01&date_to=2026-10-01'])('rejects incomplete, normalized or unbounded date ranges: %s', query => {
    expect(reportQuery(new URLSearchParams(query), today).fields).toHaveProperty('date');
  });
  it.each(['q=anything', 'status=UNKNOWN', 'temperature=UNKNOWN', 'archived=unknown', 'sales_id=other', 'status=NEW&status=LOST', 'lead_score=100', 'date_from=2026-10-01&date_from=2026-10-02&date_to=2026-10-26'])('rejects unknown fields or invalid selections: %s', query => {
    expect(Object.keys(reportQuery(new URLSearchParams(query), today).fields).length).toBeGreaterThan(0);
  });
  it('keeps all archived data by default and does not send another Sales filter for Sales', () => {
    const initial = initialReportFilters(today);
    expect(initial.archived).toBe('all');
    const f = { ...initial, sales_id: '00000000-0000-4000-8000-000000000001' };
    expect(reportParams(f, 'Sales').has('sales_id')).toBe(false);
    expect(reportParams(f, 'Admin').get('sales_id')).toBe(f.sales_id);
    expect(reportRangeError('2024-02-29', '2024-03-01', today)).toBe('');
    expect(reportRangeError('2025-02-29', '2025-03-01', today)).not.toBe('');
  });
  it('updates relative presets across Vietnam midnight while retaining explicit historical ranges', () => {
    const month = initialReportFilters('2026-10-31');
    expect(resolvedReportFilters(month, '2026-11-01')).toMatchObject({ date_from: '2026-11-01', date_to: '2026-11-01' });
    const custom = { ...month, period: 'custom' as const };
    expect(resolvedReportFilters(custom, '2026-11-01')).toBe(custom);
  });
});
