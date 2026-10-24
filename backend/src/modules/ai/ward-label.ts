import { hcmWards } from './hcm-wards.js';

/**
 * "Phường Tân Mỹ, Thành phố Hồ Chí Minh" -> "Phường Tân Mỹ (Quận 7 cũ), Thành phố Hồ Chí Minh".
 * Customers still use the pre-2025 districts; this keeps answers and model context readable.
 */
export function withFormerDistrict(location: string) {
  const text = location.normalize('NFC');
  if (/(?:quận|huyện)\s/iu.test(text)) return text;
  for (const row of hcmWards) {
    const ward = row.ward.normalize('NFC').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = text.match(new RegExp(`(?:phường|xã)\\s+${ward}(?=\\s*(?:,|$))`, 'iu'));
    if (match && match.index !== undefined) {
      const end = match.index + match[0].length;
      return `${text.slice(0, end)} (${row.formerDistricts.join(', ')} cũ)${text.slice(end)}`;
    }
  }
  return text;
}
