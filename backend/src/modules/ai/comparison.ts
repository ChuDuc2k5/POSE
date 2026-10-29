import { priceLabel } from './money.js';
import { shortListingName } from './display.js';

export type ComparisonEvidence = {
  number?: number;
  name?: string;
  price?: number | null;
  area?: number | null;
  bedrooms?: number | null;
  location?: string | null;
  description?: string | null;
  transaction_type?: 'Sale' | 'Rent';
  price_period?: 'Total' | 'Month';
};

export function cardComparisonReply(items: ComparisonEvidence[]) {
  if (items.length < 2) return null;
  const rows = items.slice(0, 2).map((item, index) => {
    const number = item.number ?? index + 1;
    const price = priceLabel(item.price, item.transaction_type === 'Rent' || item.price_period === 'Month');
    const area = typeof item.area === 'number' ? `${item.area} m²` : 'chưa có dữ liệu';
    const bedrooms =
      typeof item.bedrooms === 'number'
        ? item.bedrooms === 0
          ? 'studio'
          : `${item.bedrooms} phòng ngủ`
        : 'chưa có dữ liệu';
    const pricePerM2 =
      typeof item.price === 'number' && typeof item.area === 'number' && item.area > 0
        ? priceLabel(Math.round(item.price / item.area / 1e6) * 1e6, false)
        : 'chưa có dữ liệu';
    const description = String(item.description || '').trim();
    const legalMatch = description.match(/[^.!?\n]*(?:sổ hồng|sổ đỏ|pháp lý|sẵn sổ)[^.!?\n]*/iu);
    const legal =
      legalMatch?.[0]?.trim().replace(/^\p{Lu}/u, (letter) => letter.toLocaleLowerCase('vi')) || 'chưa có dữ liệu';
    const notable = description ? description.split(/[.!?]/u)[0].slice(0, 120) : 'chưa có dữ liệu';
    return `[${number}] ${shortListingName(item.name)}: Giá ${price}; Diện tích ${area}; Phòng ngủ ${bedrooms}; Giá/m² ${pricePerM2}; Vị trí ${item.location || 'chưa có dữ liệu'}; Pháp lý ${legal}; Điểm nổi bật ${notable}.`;
  });
  const first = items[0];
  const second = items[1];
  const differences =
    typeof first.price === 'number' &&
    typeof first.area === 'number' &&
    typeof second.price === 'number' &&
    typeof second.area === 'number' &&
    first.area > 0 &&
    second.area > 0
      ? `Giá/m² của căn [${first.number ?? 1}] ${priceLabel(Math.round(first.price / first.area / 1e6) * 1e6)} và căn [${second.number ?? 2}] ${priceLabel(Math.round(second.price / second.area / 1e6) * 1e6)}; diện tích lần lượt ${first.area} m² và ${second.area} m².`
      : 'Khác biệt chính nằm ở giá, diện tích hoặc vị trí; một số dữ liệu chưa có trong tin đăng.';
  return `So sánh hai căn theo đúng số thứ tự:\n${rows.join('\n')}\nKhác biệt chính: ${differences}`;
}
