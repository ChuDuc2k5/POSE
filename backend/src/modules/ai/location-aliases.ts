const aliasesByArea: Record<string, string[]> = {
  'thủ đức': ['Thủ Đức', 'Quận 2', 'Quận 9'],
  'vũng tàu': [
    'Vũng Tàu', 'Phường Vũng Tàu', 'Tam Thắng', 'Phường Tam Thắng',
    'Rạch Dừa', 'Phường Rạch Dừa', 'Phước Thắng', 'Phường Phước Thắng',
    'Long Sơn', 'Xã Long Sơn', 'Bà Rịa', 'Phường Bà Rịa', 'Long Điền',
    'Thị trấn Long Điền', 'Đất Đỏ', 'Thị trấn Đất Đỏ', 'Xuyên Mộc', 'Châu Đức',
    'Ngãi Giao', 'Long Hải', 'Phước Hải', 'Hồ Tràm', 'Bình Châu', 'Côn Đảo', 'Phú Mỹ',
  ],
  'phú mỹ hưng': [
    'Phú Mỹ Hưng', 'Quận 7', 'Tân Phong', 'Phường Tân Phong', 'Phú Mỹ',
    'Phường Phú Mỹ', 'Tân Thuận', 'Phú Thuận', 'Tân Mỹ',
  ],
};

const normalize = (value: string) => value.normalize('NFC').trim().toLocaleLowerCase('vi');

export function catalogueLocationAliases(value: unknown): string[] {
  if (typeof value !== 'string' || !value.trim()) return [];
  const normalized = normalize(value);
  const key = Object.keys(aliasesByArea).find(area => normalized === area || normalized.includes(area) || area.includes(normalized) || aliasesByArea[area].some(alias => normalize(alias) === normalized));
  return key ? [...new Set(aliasesByArea[key])] : [];
}
