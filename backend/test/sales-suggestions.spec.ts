import { formerDistrictFromLocation } from '../src/modules/ai/ward-label.js';
import { scoreSalesSuggestions } from '../src/modules/appointments/sales-suggestions.js';

describe('Sales suggestions', () => {
  it('maps a current ward listing to its former district', () => {
    expect(formerDistrictFromLocation('Phường Long Bình, Thành phố Hồ Chí Minh')).toBe('Quận 9');
    expect(formerDistrictFromLocation('Quận 7, Thành phố Hồ Chí Minh')).toBe('Quận 7');
  });
  it('scores primary territory, ownership and load deterministically', () => {
    const result = scoreSalesSuggestions(
      [
        {
          sales_id: 'a',
          name: 'A',
          territories: [{ district: 'Quận 7', is_backup: false }],
          upcoming_appointments: 1,
          open_leads: 2,
          is_current_owner: false,
        },
        {
          sales_id: 'b',
          name: 'B',
          territories: [{ district: 'Quận 7', is_backup: true }],
          upcoming_appointments: 0,
          open_leads: 0,
          is_current_owner: true,
        },
        { sales_id: 'c', name: 'C', territories: [], upcoming_appointments: 0, open_leads: 0, is_current_owner: false },
      ],
      'Quận 7',
      'a',
    );
    expect(result[0]).toMatchObject({ sales_id: 'a', score: 115, recommended: true });
    expect(result[0].reasons).toContain('Đang giữ căn này');
    expect(result[1]).toMatchObject({ sales_id: 'b', score: 100, recommended: false });
    expect(
      scoreSalesSuggestions(
        result.map(({ score: _score, recommended: _recommended, reasons: _reasons, ...candidate }) => candidate),
        'Quận 1',
        null,
      )[0].reasons,
    ).toContain('Chưa có Sales phụ trách khu vực này – gợi ý theo khối lượng việc');
  });
});
