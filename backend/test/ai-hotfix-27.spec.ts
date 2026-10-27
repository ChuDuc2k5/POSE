import { describe, expect, it } from 'vitest';
import { hcmWardCount, hcmWards } from '../src/modules/ai/hcm-wards.js';
import { areaAliases } from '../src/modules/ai/location-aliases.js';
import { inferSearch } from '../src/modules/ai/infer-search.js';
import { formerDistricts } from '../src/modules/ai/ward-label.js';

const formerHcmDistricts = [...new Set(hcmWards.filter(row => row.formerProvince === 'TP.HCM').flatMap(row => row.formerDistricts))];

describe('Hotfix 27 ward data and area aliases', () => {
  it('has all 168 units and the anchored district assignments', () => {
    expect(hcmWardCount).toBe(168);
    expect(hcmWards).toHaveLength(168);
    const expected: Record<string, string[]> = {
      'Quận 1': ['Sài Gòn', 'Tân Định', 'Bến Thành', 'Cầu Ông Lãnh'],
      'Quận 3': ['Bàn Cờ', 'Xuân Hòa', 'Nhiêu Lộc'],
      'Quận 4': ['Xóm Chiếu', 'Khánh Hội', 'Vĩnh Hội'],
      'Quận 5': ['Chợ Quán', 'An Đông', 'Chợ Lớn'],
      'Quận 7': ['Tân Thuận', 'Phú Thuận', 'Tân Mỹ', 'Tân Hưng'],
      'Quận 10': ['Diên Hồng', 'Vườn Lài', 'Hòa Hưng'],
      'Quận 12': ['Đông Hưng Thuận', 'Trung Mỹ Tây', 'Tân Thới Hiệp', 'Thới An', 'An Phú Đông'],
      'Quận 2': ['An Khánh', 'Bình Trưng', 'Cát Lái'],
      'Quận 9': ['Long Bình', 'Long Phước', 'Long Trường', 'Tăng Nhơn Phú', 'Phước Long'],
      'Thủ Đức': ['Hiệp Bình', 'Thủ Đức', 'Tam Bình', 'Linh Xuân'],
      'Quận Gò Vấp': ['Hạnh Thông', 'An Nhơn', 'Gò Vấp', 'An Hội Đông', 'Thông Tây Hội', 'An Hội Tây'],
      'Quận Bình Thạnh': ['Gia Định', 'Bình Thạnh', 'Bình Lợi Trung', 'Thạnh Mỹ Tây', 'Bình Quới'],
    };
    for (const [district, wards] of Object.entries(expected)) {
      expect(hcmWards.filter(row => row.formerDistricts.includes(district)).map(row => row.ward)).toEqual(expect.arrayContaining(wards));
      expect(hcmWards.filter(row => row.formerProvince !== 'TP.HCM').flatMap(row => row.formerDistricts)).not.toContain(district);
    }
  });

  it('matches every former HCMC district without leaking other new wards', () => {
    for (const district of formerHcmDistricts) {
      const aliases = areaAliases(district);
      const own = hcmWards.filter(row => row.formerProvince === 'TP.HCM' && row.formerDistricts.includes(district));
      const other = hcmWards.filter(row => row.formerProvince === 'TP.HCM' && !row.formerDistricts.includes(district));
      expect(aliases).toEqual(expect.arrayContaining(own.map(row => row.ward)));
      const formerNames = new Set(own.flatMap(row => row.formerWards));
      expect(other.some(row => aliases.includes(row.ward) && !formerNames.has(row.ward) && district !== 'Thủ Đức')).toBe(false);
    }
    expect(areaAliases('Quận 9')).toEqual(expect.arrayContaining(['Long Bình', 'Phường Long Bình']));
    expect(areaAliases('Quận 9')).not.toEqual(expect.arrayContaining(['Linh Chiểu', 'Hiệp Bình', 'Thảo Điền', 'Thủ Đức']));
    expect(areaAliases('Quận 1')).not.toEqual(expect.arrayContaining(['Quận 12']));
    expect(areaAliases('Gò Vấp').length).toBeGreaterThan(0);
    expect(areaAliases('Bình Tân').length).toBeGreaterThan(0);
    expect(areaAliases('Hóc Môn').length).toBeGreaterThan(0);
    expect(areaAliases('Phú Mỹ Hưng')).toEqual(expect.arrayContaining(['Tân Mỹ', 'Tân Hưng', 'Tân Phong', 'Phú Mỹ Hưng']));
    expect(areaAliases('Phú Mỹ Hưng')).not.toContain('Phú Mỹ');
    expect(areaAliases('Vũng Tàu')).not.toEqual(expect.arrayContaining(['Phú Mỹ', 'Bình Dương']));
    expect(areaAliases('Thủ Đức')).toEqual(expect.arrayContaining(['Cát Lái', 'Long Bình', 'Hiệp Bình']));
    expect(areaAliases('Phường Thủ Đức')).toEqual(expect.arrayContaining(['Thủ Đức']));
    expect(areaAliases('Phường Thủ Đức')).not.toContain('Cát Lái');
  });

  it('keeps province towns out of the HCMC district filter', () => {
    expect(formerDistricts).toContain('Quận 5');
    expect(formerDistricts).toContain('Quận 10');
    expect(formerDistricts).not.toContain('Thành phố Vũng Tàu');
    expect(formerDistricts).not.toContain('Thành phố Thủ Dầu Một');
  });
});

describe('Hotfix 27 shared inference', () => {
  it('distinguishes generic homes, houses, land and unspecified property wording', () => {
    expect(inferSearch('mua nhà Quận 12 dưới 7 tỷ')).toMatchObject({ types: ['House', 'Apartment'] });
    expect(inferSearch('mua nhà Quận 12 dưới 7 tỷ')).not.toHaveProperty('type');
    expect(inferSearch('mua nhà phố Quận 12')).toMatchObject({ type: 'House' });
    expect(inferSearch('mua chung cư Quận 12')).toMatchObject({ type: 'Apartment' });
    expect(inferSearch('mua nhà đất Quận 12')?.type).toBeUndefined();
    expect(inferSearch('mua nhà đất Quận 12')?.types).toBeUndefined();
    expect(inferSearch('mua bất động sản Quận 12')?.types).toBeUndefined();
    expect(inferSearch('mua BĐS Quận 12')?.types).toBeUndefined();
    expect(inferSearch('mua đất nền Quận 12')?.type).toBe('Land');
    expect(inferSearch('mua căn Quận 12')?.type).toBeUndefined();
    expect(inferSearch('mua căn Quận 12')?.types).toBeUndefined();
    expect(inferSearch('mua căn hộ Quận 12')?.type).toBe('Apartment');
  });
});
