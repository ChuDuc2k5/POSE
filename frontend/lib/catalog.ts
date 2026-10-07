export const catalogKinds = ['projects', 'subdivisions', 'properties', 'media'] as const;
export type CatalogKind = typeof catalogKinds[number];
export const publicationLabels = { Draft: 'Bản nháp', Published: 'Đã công bố', Hidden: 'Đang ẩn', Archived: 'Lưu trữ' };
export const availabilityLabels = { Available: 'Đang mở bán', Reserved: 'Đã giữ chỗ', Sold: 'Đã bán', Unavailable: 'Chưa mở bán' };
export const propertyTypeLabels = { Apartment: 'Căn hộ', House: 'Nhà phố', Land: 'Đất nền', Villa: 'Biệt thự', Office: 'Văn phòng', Shop: 'Shophouse' };
export type CatalogItem = {
  id: string; code: string; name: string; location: string; description: string;
  amenities?: string; archived?: boolean; project_id?: string; subdivision_id?: string | null;
  property_type?: keyof typeof propertyTypeLabels; area?: number; bedrooms?: number | null; price?: number | null;
  currency?: string; publication?: keyof typeof publicationLabels; availability?: keyof typeof availabilityLabels;
  version: number; updated_at: string;
};
export type PropertyMedia = {
  id: string; property_id: string; name: string; media_type: 'Image' | 'Document'; visibility: 'Public' | 'Internal';
  visible: boolean; removed: boolean; sort_order: number; size_bytes: number; version: number;
};
export type CatalogHistory = { id: string; action: string; reason: string; actor_id: string; created_at: string; before_data: Record<string, unknown> | null; after_data: Record<string, unknown> };
export const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isCatalogKind(value: string): value is CatalogKind { return (catalogKinds as readonly string[]).includes(value); }
export function priceLabel(price: number | null | undefined) {
  return price == null ? 'Liên hệ' : `${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(price)} ₫`;
}

export function validateCatalog(kind: CatalogKind, input: Record<string, unknown>): Record<string, string> {
  const errors: Record<string, string> = {};
  const allowed = kind === 'media' ? ['name','visibility','visible','sort_order','removed','version','reason'] :
    ['code','name','location','description','version','reason', ...(kind === 'properties' ? ['project_id','subdivision_id','property_type','area','bedrooms','price','publication','availability'] : ['amenities','archived', ...(kind === 'subdivisions' ? ['project_id'] : [])])];
  if (Object.keys(input).some(key => !allowed.includes(key))) errors.form = 'Dữ liệu chứa trường không được phép.';
  if (!Number.isSafeInteger(input.version) || (input.version as number) < 0) errors.version = 'Phiên bản không hợp lệ. Vui lòng tải lại dữ liệu.';
  const text = (key: string, min: number, max: number) => {
    if (typeof input[key] !== 'string' || (input[key] as string).trim().length < min || (input[key] as string).length > max) errors[key] = `Nhập từ ${min} đến ${max} ký tự.`;
  };
  text('name', kind === 'media' ? 1 : 2, 160);
  if (input.reason !== undefined && (typeof input.reason !== 'string' || input.reason.length > 1000)) errors.reason = 'Lý do tối đa 1.000 ký tự.';
  if (kind === 'media') {
    if (!['Public','Internal'].includes(input.visibility as string)) errors.visibility = 'Chọn phạm vi hiển thị hợp lệ.';
    if (typeof input.visible !== 'boolean' || typeof input.removed !== 'boolean') errors.visible = 'Trạng thái hiển thị không hợp lệ.';
    if (!Number.isInteger(input.sort_order) || (input.sort_order as number) < 0 || (input.sort_order as number) > 10000) errors.sort_order = 'Thứ tự từ 0 đến 10.000.';
    return errors;
  }
  if (typeof input.code !== 'string' || !/^[A-Z0-9][A-Z0-9_-]{1,39}$/i.test(input.code.trim())) errors.code = 'Mã gồm 2–40 chữ Latin, số, dấu gạch ngang hoặc gạch dưới.';
  text('location', 2, 300); text('description', 0, 10000);
  if (kind !== 'projects' && (typeof input.project_id !== 'string' || !uuidPattern.test(input.project_id))) errors.project_id = 'Chọn một dự án.';
  if (kind !== 'properties') {
    text('amenities', 0, 3000);
    if (typeof input.archived !== 'boolean') errors.archived = 'Trạng thái không hợp lệ.';
    return errors;
  }
  if (input.subdivision_id !== null && (typeof input.subdivision_id !== 'string' || !uuidPattern.test(input.subdivision_id))) errors.subdivision_id = 'Phân khu không hợp lệ.';
  if (!Object.hasOwn(propertyTypeLabels, input.property_type as string)) errors.property_type = 'Chọn loại bất động sản.';
  if (typeof input.area !== 'number' || !Number.isFinite(input.area) || input.area <= 0 || input.area > 1e9) errors.area = 'Diện tích phải lớn hơn 0 và không vượt quá 1 tỷ m².';
  if (input.price !== null && (typeof input.price !== 'number' || !Number.isFinite(input.price) || input.price <= 0 || input.price > 1e15)) errors.price = 'Giá phải lớn hơn 0. Để trống nếu chưa công bố giá.';
  if (input.bedrooms !== null && (!Number.isInteger(input.bedrooms) || (input.bedrooms as number) < 0 || (input.bedrooms as number) > 100)) errors.bedrooms = 'Số phòng ngủ từ 0 đến 100 hoặc để trống.';
  if (!Object.hasOwn(publicationLabels, input.publication as string)) errors.publication = 'Trạng thái công bố không hợp lệ.';
  if (!Object.hasOwn(availabilityLabels, input.availability as string)) errors.availability = 'Tình trạng mở bán không hợp lệ.';
  if (input.publication === 'Published' && (typeof input.description !== 'string' || input.description.trim().length < 20)) errors.description = 'Để công bố, mô tả sản phẩm cần ít nhất 20 ký tự.';
  return errors;
}
