import { uuidPattern } from '../../common/catalog.js';
export const leadStatuses = ['NEW', 'CONTACTED', 'QUALIFIED', 'FOLLOW_UP', 'CONVERTED', 'LOST'] as const;
const actions = ['profile', 'status', 'archive', 'accept', 'assign', 'resolve_extraction'];
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const id = (value: unknown) => typeof value === 'string' && uuidPattern.test(value);
const positive = (value: unknown) => value === null || typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 1e15;
export function validateLeadMutation(input: Record<string, unknown>) {
    const fields: Record<string, string> = {};
    if (Object.keys(input).some(k => !['version', 'action', 'data', 'reason'].includes(k)))
        fields.form = 'Dữ liệu chứa trường không được phép.';
    if (!Number.isSafeInteger(input.version) || Number(input.version) < 0)
        fields.version = 'Tải lại hồ sơ trước khi lưu.';
    if (typeof input.action !== 'string' || !actions.includes(input.action))
        fields.action = 'Thao tác không hợp lệ.';
    if (!object(input.data)) {
        fields.form = 'Thông tin cập nhật không hợp lệ.';
        return fields;
    }
    if (input.action !== 'accept' && (typeof input.reason !== 'string' || input.reason.trim().length < 3 || input.reason.length > 1000))
        fields.reason = 'Nhập lý do từ 3 đến 1.000 ký tự.';
    const d = input.data;
    const allowed: Record<string, string[]> = {
        profile: ['locations', 'property_types', 'budget_min', 'budget_max', 'buying_purpose', 'expected_timeline', 'notes', 'management'],
        status: ['status', 'property_id', 'purchased_at'], archive: ['archived'], accept: [],
        assign: ['sales_id', 'property_id'], resolve_extraction: ['extraction_id', 'accept'],
    };
    if (Object.keys(d).some(k => !(allowed[String(input.action)] || []).includes(k)))
        fields.form = 'Chỉ cập nhật các trường của thao tác đã chọn.';
    if (input.action === 'profile') {
        if (!Array.isArray(d.locations) || d.locations.length > 10 || d.locations.some(v => typeof v !== 'string' || !v.trim() || v.length > 200))
            fields.locations = 'Nhập tối đa 10 khu vực, mỗi khu vực không quá 200 ký tự.';
        if (!Array.isArray(d.property_types) || d.property_types.length > 10 || d.property_types.some(v => !['Apartment', 'House', 'Land', 'Villa', 'Office', 'Shop'].includes(v)))
            fields.property_types = 'Chọn loại bất động sản hợp lệ.';
        if (!positive(d.budget_min) || !positive(d.budget_max) || d.budget_min !== null && d.budget_max !== null && Number(d.budget_min) > Number(d.budget_max))
            fields.budget = 'Kiểm tra khoảng ngân sách; để trống nếu chưa xác định.';
        if (typeof d.buying_purpose !== 'string' || d.buying_purpose.length > 100)
            fields.buying_purpose = 'Nhập tối đa 100 ký tự.';
        if (typeof d.notes !== 'string' || d.notes.length > 5000)
            fields.notes = 'Ghi chú tối đa 5.000 ký tự.';
        if (d.expected_timeline !== null && !['lt3m', '3to6m', 'gt6m', 'none'].includes(String(d.expected_timeline)))
            fields.expected_timeline = 'Chọn thời gian hợp lệ.';
        if (!object(d.management))
            fields.management = 'Tiêu chí không hợp lệ.';
        else {
            const m = d.management;
            if (Object.keys(m).some(k => !['transaction_type', 'bedrooms', 'bedrooms_required', 'area_min', 'area_max', 'area_required', 'selected_property_id'].includes(k)))
                fields.management = 'Tiêu chí chứa trường không được phép.';
            if (m.transaction_type !== undefined && !['Sale', 'Rent'].includes(String(m.transaction_type)))
                fields.management = 'Chọn mua hoặc thuê.';
            for (const key of ['bedrooms_required', 'area_required'])
                if (m[key] !== undefined && typeof m[key] !== 'boolean')
                    fields.management = 'Điều kiện bắt buộc không hợp lệ.';
            for (const key of ['bedrooms', 'area_min', 'area_max']) {
                const v = m[key];
                if (v !== undefined && v !== null && (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1e9))
                    fields.management = 'Diện tích/số phòng không hợp lệ.';
            }
            if (m.bedrooms !== null && m.bedrooms !== undefined && (!Number.isInteger(m.bedrooms) || Number(m.bedrooms) > 100))
                fields.management = 'Số phòng phải là số nguyên từ 0 đến 100.';
            if (m.area_min != null && m.area_max != null && Number(m.area_min) > Number(m.area_max))
                fields.management = 'Khoảng diện tích không hợp lệ.';
            if (m.bedrooms_required && m.bedrooms == null || m.area_required && m.area_min == null && m.area_max == null)
                fields.management = 'Điền tiêu chí được đánh dấu bắt buộc.';
            if (m.selected_property_id != null && !id(m.selected_property_id))
                fields.management = 'Bất động sản đã chọn không hợp lệ.';
        }
    }
    if (input.action === 'status') {
        if (!(leadStatuses as readonly string[]).includes(String(d.status)))
            fields.status = 'Trạng thái không hợp lệ.';
        if (d.status === 'CONVERTED' && (!id(d.property_id) || typeof d.purchased_at !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d.purchased_at)))
            fields.purchase = 'Chọn BĐS đã mua và ngày mua.';
    }
    if (input.action === 'archive' && typeof d.archived !== 'boolean')
        fields.archived = 'Trạng thái lưu trữ không hợp lệ.';
    if (input.action === 'assign' && (!id(d.sales_id) || d.property_id != null && !id(d.property_id)))
        fields.sales_id = 'Chọn nhân viên hợp lệ.';
    if (input.action === 'resolve_extraction' && (!id(d.extraction_id) || typeof d.accept !== 'boolean'))
        fields.extraction_id = 'Thông tin cần kiểm tra không hợp lệ.';
    return fields;
}
export function leadListQuery(params: URLSearchParams) {
    const fields: Record<string, string> = {};
    const filters: Record<string, string> = {};
    const allowed = ['q', 'status', 'temperature', 'assignment', 'archived', 'sales_id', 'source', 'page', 'pageSize'];
    for (const [k, v] of params) {
        if (!allowed.includes(k) || params.getAll(k).length > 1)
            fields.form = 'Bộ lọc không hợp lệ.';
        if (allowed.includes(k) && !['page', 'pageSize'].includes(k) && v)
            filters[k] = v.trim();
    }
    const page = Number(params.get('page') || 1), pageSize = Number(params.get('pageSize') || 12);
    if (!Number.isSafeInteger(page) || page < 1 || page > 10000 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 50)
        fields.page = 'Trang không hợp lệ.';
    if ((filters.q || '').length > 120)
        fields.q = 'Tìm tối đa 120 ký tự.';
    if (filters.status && !(leadStatuses as readonly string[]).includes(filters.status))
        fields.status = 'Trạng thái không hợp lệ.';
    if (filters.temperature && !['HOT', 'WARM', 'COLD', 'UNRATED'].includes(filters.temperature))
        fields.temperature = 'Mức tiềm năng không hợp lệ.';
    if (filters.assignment && !['assigned', 'unassigned'].includes(filters.assignment))
        fields.assignment = 'Bộ lọc phân công không hợp lệ.';
    if (filters.archived && !['true', 'false'].includes(filters.archived))
        fields.archived = 'Bộ lọc lưu trữ không hợp lệ.';
    if (filters.sales_id && !id(filters.sales_id))
        fields.sales_id = 'Nhân viên không hợp lệ.';
    if (filters.source && !['Inquiry', 'WebChat', 'Call', 'Manual', 'Import'].includes(filters.source))
        fields.source = 'Nguồn không hợp lệ.';
    return { filters, page, pageSize, fields };
}
