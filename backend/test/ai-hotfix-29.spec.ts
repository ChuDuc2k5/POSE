import { describe, expect, it } from 'vitest';
import { hcmWards } from '../src/modules/ai/hcm-wards.js';
import { areaAliases, withAreaAliases } from '../src/modules/ai/location-aliases.js';

const normalize = (value: string) => value.normalize('NFC').toLocaleLowerCase('vi');
const formerDistricts = [...new Set(hcmWards.flatMap(row => row.formerDistricts))];

describe('Hotfix 29 alias attachment', () => {
  it.each([
    { location: 'G\u00f2 V\u1ea5p', type: 'House' },
    { locations: ['Th\u1ee7 \u0110\u1ee9c'], types: ['Apartment', 'House'] },
  ])('attaches aliases without dropping inferred type fields: %o', filters => {
    const location = filters.location || filters.locations?.[0] || '';
    const result = withAreaAliases(filters);
    expect(result.location_aliases).toEqual(expect.arrayContaining(areaAliases(location)));
    expect(result).toMatchObject(filters);
  });
});

describe('Hotfix 29 area aliases', () => {
  it('does not use colliding former ward names bare', () => {
    expect(areaAliases('Thủ Đức')).not.toContain('Tân Phú');
    expect(areaAliases('Quận 9')).not.toContain('Tân Phú');
  });

  it('uses all district wards for an unprefixed district and only one ward for an explicit ward', () => {
    expect(areaAliases('Gò Vấp')).toEqual(expect.arrayContaining(['An Hội Tây', 'Hạnh Thông']));
    expect(areaAliases('phường Gò Vấp')).not.toContain('An Hội Tây');
    expect(areaAliases('phường Gò Vấp')).toContain('Gò Vấp');
  });

  it.each(formerDistricts)('does not leak a current or other-district former ward into %s', district => {
    const isOwnDistrict = (row: typeof hcmWards[number]) => district === 'Thủ Đức'
      ? row.formerDistricts.some(value => ['Quận 2', 'Quận 9', 'Thủ Đức'].includes(value))
      : row.formerDistricts.includes(district);
    const own = hcmWards.filter(isOwnDistrict);
    const aliases = areaAliases(district).map(normalize);
    const currentOther = hcmWards
      .filter(row => !isOwnDistrict(row))
      .map(row => normalize(row.ward));
    const formerOther = hcmWards
      .filter(row => !isOwnDistrict(row))
      .flatMap(row => row.formerWards)
      .filter(name => !/^\d+$/u.test(name.trim()))
      .map(normalize);
    for (const name of [...currentOther, ...formerOther]) {
      const isOwnWard = own.some(row => normalize(row.ward) === name);
      if (!isOwnWard) expect(aliases).not.toContain(name);
    }
  });

  it('keeps legacy district aliases for project areas', () => {
    expect(areaAliases('Phú Mỹ Hưng')).toContain('Quận 7');
  });
});
