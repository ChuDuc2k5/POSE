import { describe, expect, it } from 'vitest';
import { hcmWards } from '../src/modules/ai/hcm-wards.js';
import { districtAliases, propertyChunks } from '../src/modules/ai/chunking.js';
import { clarificationFor } from '../src/modules/ai/history-aware.js';

describe('post-2025 HCMC ward mapping', () => {
  it('contains the required ward facts and reports valid multi-district rows', () => {
    expect(hcmWards.length).toBe(102);
    for (const [ward, district] of [['Tân Mỹ', 'Quận 7'], ['Tân Hưng', 'Quận 7'], ['Phú Thuận', 'Quận 7'], ['Tân Thuận', 'Quận 7'], ['Sài Gòn', 'Quận 1'], ['Bến Thành', 'Quận 1'], ['Tân Định', 'Quận 1'], ['Bàn Cờ', 'Quận 3'], ['Xuân Hòa', 'Quận 3'], ['Nhiêu Lộc', 'Quận 3'], ['An Khánh', 'Quận 2'], ['Bình Trưng', 'Quận 2'], ['Cát Lái', 'Quận 2'], ['Long Phước', 'Quận 9'], ['Long Trường', 'Quận 9'], ['Phước Long', 'Quận 9'], ['Linh Xuân', 'Thủ Đức'], ['Tân Thới Hiệp', 'Quận 12'], ['Trung Mỹ Tây', 'Quận 12'], ['Gia Định', 'Quận Bình Thạnh'], ['Bình Thạnh', 'Quận Bình Thạnh'], ['Bảy Hiền', 'Quận Tân Bình'], ['Hòa Bình', 'Quận 11'], ['Phú Thọ', 'Quận 11']]) {
      expect(hcmWards.find(row => row.ward.normalize('NFC') === ward)?.formerDistricts).toContain(district);
    }
    expect(hcmWards.filter(row => row.formerDistricts.length > 1).map(row => row.ward)).toEqual(expect.arrayContaining(['Tân Nhựt', 'Bình Hưng', 'Bắc Tân Uyên']));
  });
  it('adds aliases in both directions for indexed listing headers', () => {
    expect(districtAliases({ code: 'x', name: 'Căn hộ', location: 'Phường Tân Mỹ, TP.HCM', property_type: 'Apartment', transaction_type: 'Sale', description: '', project_name: null, amenities: null })).toContain('Quận 7');
    expect(propertyChunks({ code: 'x', name: 'Căn hộ', location: 'Quận 7', property_type: 'Apartment', transaction_type: 'Sale', description: 'Ban công thoáng', project_name: null, amenities: null })[0].header).toContain('Tân Mỹ');
  });
  it('asks for the old location before a locationless follow-up search', () => {
    const result = clarificationFor('tôi muốn thuê căn hộ giá 10 - 15 triệu', [{ role: 'user', content: 'Mua căn hộ Quận 7' }]);
    expect(result).toEqual({ needed: true, question: 'Bạn muốn thuê ở Quận 7 như trước hay khu vực khác?', options: ['Quận 7', 'Khu vực khác', 'Không giới hạn khu vực'] });
  });
});

import { withFormerDistrict } from '../src/modules/ai/ward-label.js';
describe('former district label', () => {
  it('labels new wards with their former district and leaves district addresses alone', () => {
    expect(withFormerDistrict('Phường Tân Mỹ, Thành phố Hồ Chí Minh')).toBe('Phường Tân Mỹ (Quận 7 cũ), Thành phố Hồ Chí Minh');
    expect(withFormerDistrict('Phường Tân Mỹ, Thành phố Hồ Chí Minh'.normalize('NFD'))).toBe('Phường Tân Mỹ (Quận 7 cũ), Thành phố Hồ Chí Minh');
    expect(withFormerDistrict('Quận 7, TP. Hồ Chí Minh')).toBe('Quận 7, TP. Hồ Chí Minh');
    expect(withFormerDistrict('Phường Tân Hưng Thuận, TP.HCM')).not.toContain('Quận 7');
  });
});
