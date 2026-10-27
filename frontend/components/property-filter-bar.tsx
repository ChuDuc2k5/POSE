'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import {
  Building2,
  House,
  LandPlot,
  Castle,
  BriefcaseBusiness,
  Store,
  LayoutGrid,
  ChevronDown,
  Check,
  Search,
  SlidersHorizontal,
  X,
  RotateCcw,
} from 'lucide-react';
import { availabilityLabels } from '@/lib/catalog';

export const filterNames = [
  'q',
  'location',
  'transaction',
  'project',
  'type',
  'minPrice',
  'maxPrice',
  'minArea',
  'maxArea',
  'bedrooms',
  'availability',
  'sort',
] as const;
export type PropertyFilters = Record<string, string>;
type Panel = 'transaction' | 'price' | 'bedrooms' | 'type' | 'more';
const titles = { transaction: 'Mua bán', price: 'Mức giá', bedrooms: 'Số phòng', type: 'Loại hình', more: 'Bộ lọc' };
const types = [
  ['', 'Tất cả', LayoutGrid],
  ['Apartment', 'Căn hộ', Building2],
  ['House', 'Nhà riêng', House],
  ['Land', 'Đất nền', LandPlot],
  ['Villa', 'Biệt thự', Castle],
  ['Office', 'Văn phòng', BriefcaseBusiness],
  ['Shop', 'Mặt bằng kinh doanh', Store],
] as const;
const transactionLabels: Record<string, string> = { '': 'Tất cả', Sale: 'Mua bán', Rent: 'Cho thuê' };
const saleRanges = [
  ['Dưới 1 tỷ', 0, 1e9],
  ['1–3 tỷ', 1e9, 3e9],
  ['3–5 tỷ', 3e9, 5e9],
  ['5–10 tỷ', 5e9, 10e9],
  ['10–20 tỷ', 10e9, 20e9],
  ['Trên 20 tỷ', 20e9, null],
] as const;
const rentRanges = [
  ['Dưới 5tr', 0, 5e6],
  ['5–10tr', 5e6, 10e6],
  ['10–15tr', 10e6, 15e6],
  ['15–20tr', 15e6, 20e6],
  ['20–30tr', 20e6, 30e6],
  ['Trên 30tr', 30e6, null],
] as const;
const areaRanges = [
  ['Dưới 50m²', 0, 50],
  ['50–100m²', 50, 100],
  ['100–200m²', 100, 200],
  ['200–500m²', 200, 500],
  ['500–1000m²', 500, 1000],
  ['Trên 1000m²', 1000, null],
] as const;
function rangeLabel(filters: PropertyFilters, kind: 'Price' | 'Area') {
  const min = filters[`min${kind}`],
    max = filters[`max${kind}`];
  const ranges = kind === 'Area' ? areaRanges : filters.transaction === 'Rent' ? rentRanges : saleRanges;
  const preset = ranges.find(([, lo, hi]) => min === String(lo) && max === (hi === null ? '' : String(hi)));
  if (preset) return preset[0];
  const format = (value: string) =>
    kind === 'Area'
      ? `${Number(value).toLocaleString('vi-VN')} m²`
      : Number(value) >= 1e9
        ? `${Number(value) / 1e9} tỷ`
        : `${Number(value).toLocaleString('vi-VN')} ₫`;
  return min && max ? `${format(min)} – ${format(max)}` : min ? `Từ ${format(min)}` : max ? `Đến ${format(max)}` : '';
}
function RangeFields({
  kind,
  draft,
  onChange,
}: {
  kind: 'Price' | 'Area';
  draft: PropertyFilters;
  onChange: (value: PropertyFilters) => void;
}) {
  const minKey = `min${kind}`,
    maxKey = `max${kind}`,
    rent = draft.transaction === 'Rent';
  const unit = kind === 'Area' ? 'm²' : rent ? 'VND/tháng' : 'VND';
  const ceiling = kind === 'Area' ? 2000 : rent ? 5e7 : 3e10,
    step = kind === 'Area' ? 1 : rent ? 1e5 : 1e8;
  const min = Number(draft[minKey] || 0),
    max = Number(draft[maxKey] || ceiling);
  const ranges = kind === 'Area' ? areaRanges : rent ? rentRanges : saleRanges;
  return (
    <fieldset className="search-range">
      <legend>{kind === 'Area' ? 'Diện tích' : 'Khoảng giá'}</legend>
      <div className="filter-pair">
        {[
          [minKey, 'Tối thiểu'],
          [maxKey, 'Tối đa'],
        ].map(([key, label]) => (
          <label key={key}>
            {label}
            <span className="search-unit-input">
              <input
                name={key}
                type="number"
                min="0"
                max={kind === 'Area' ? 1e9 : 1e15}
                step="any"
                value={draft[key]}
                onChange={(e) => onChange({ ...draft, [key]: e.target.value })}
                placeholder="Không giới hạn"
              />
              <small>{unit}</small>
            </span>
          </label>
        ))}
      </div>
      <div
        className="search-range-sliders"
        role="group"
        aria-label={`Thanh trượt ${kind === 'Area' ? 'diện tích' : 'giá'}`}
      >
        <input
          type="range"
          aria-label={`${kind === 'Area' ? 'Diện tích' : 'Giá'} tối thiểu`}
          min="0"
          max={ceiling}
          step={step}
          value={Math.min(min, ceiling)}
          onChange={(e) => onChange({ ...draft, [minKey]: String(Math.min(Number(e.target.value), max)) })}
        />
        <input
          type="range"
          aria-label={`${kind === 'Area' ? 'Diện tích' : 'Giá'} tối đa`}
          min="0"
          max={ceiling}
          step={step}
          value={Math.min(max, ceiling)}
          onChange={(e) => onChange({ ...draft, [maxKey]: String(Math.max(Number(e.target.value), min)) })}
        />
      </div>
      <div className="search-quick-chips">
        {ranges.map(([label, lo, hi]) => (
          <button
            type="button"
            key={label}
            aria-pressed={draft[minKey] === String(lo) && draft[maxKey] === (hi === null ? '' : String(hi))}
            onClick={() => onChange({ ...draft, [minKey]: String(lo), [maxKey]: hi === null ? '' : String(hi) })}
          >
            {label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}
export function PropertyFilterBar({
  filters,
  projects,
  projectError,
  fields,
  onApply,
}: {
  filters: PropertyFilters;
  projects: { id: string; name: string }[];
  projectError: boolean;
  fields: Record<string, string>;
  onApply: (value: PropertyFilters) => void;
}) {
  const [open, setOpen] = useState<Panel | null>(null),
    [draft, setDraft] = useState(filters),
    [keyword, setKeyword] = useState(filters.q),
    [position, setPosition] = useState<CSSProperties>({});
  const panel = useRef<HTMLDivElement>(null),
    trigger = useRef<HTMLButtonElement | null>(null),
    closing = useRef(false);
  useEffect(() => {
    if (!open) return;
    const element = panel.current;
    const focusable = () =>
      Array.from(element?.querySelectorAll<HTMLElement>('button,input,select,[tabindex="0"]') || []).filter(
        (item) => !item.hasAttribute('disabled'),
      );
    focusable()[0]?.focus();
    const close = () => {
      closing.current = true;
      setOpen(null);
      trigger.current?.focus();
    };
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      }
      if (event.key === 'Tab') {
        const list = focusable(),
          index = list.indexOf(document.activeElement as HTMLElement);
        if (event.shiftKey && index <= 0) {
          event.preventDefault();
          list.at(-1)?.focus();
        } else if (!event.shiftKey && (index === list.length - 1 || index < 0)) {
          event.preventDefault();
          list[0]?.focus();
        }
      }
    };
    const focus = (event: FocusEvent) => {
      if (!closing.current && !element?.contains(event.target as Node)) focusable()[0]?.focus();
    };
    document.addEventListener('keydown', keyboard);
    document.addEventListener('focusin', focus);
    return () => {
      document.removeEventListener('keydown', keyboard);
      document.removeEventListener('focusin', focus);
    };
  }, [open]);
  function close() {
    closing.current = true;
    setOpen(null);
    trigger.current?.focus();
  }
  function show(value: Panel, button: HTMLButtonElement) {
    const rect = button.getBoundingClientRect(),
      top = Math.max(16, Math.min(rect.bottom + 10, window.innerHeight - 460));
    closing.current = false;
    trigger.current = button;
    setPosition({
      left: Math.max(16, Math.min(rect.left, window.innerWidth - 440)),
      top,
      maxHeight: window.innerHeight - top - 16,
    });
    setDraft(filters);
    setOpen(value);
  }
  function apply(value = draft) {
    onApply(value);
    close();
  }
  const moreCount = ['minArea', 'maxArea', 'project', 'availability', 'location'].filter(
    (key) => !!filters[key],
  ).length;
  const labels = {
    transaction: filters.transaction ? transactionLabels[filters.transaction] : titles.transaction,
    price: rangeLabel(filters, 'Price') || titles.price,
    bedrooms: filters.bedrooms ? `${filters.bedrooms}+ PN` : titles.bedrooms,
    type: filters.type ? types.find(([value]) => value === filters.type)?.[1] || titles.type : titles.type,
    more: moreCount ? `Bộ lọc (${moreCount})` : titles.more,
  };
  const active = {
    transaction: !!filters.transaction,
    price: !!(filters.minPrice || filters.maxPrice),
    bedrooms: !!filters.bedrooms,
    type: !!filters.type,
    more: !!moreCount,
  };
  const invalid =
    Number(draft.minPrice || 0) > Number(draft.maxPrice || Infinity) ||
    Number(draft.minArea || 0) > Number(draft.maxArea || Infinity) ||
    ['minPrice', 'maxPrice', 'minArea', 'maxArea'].some(
      (key) => draft[key] && (Number(draft[key]) < 0 || Number(draft[key]) > (key.includes('Price') ? 1e15 : 1e9)),
    );
  return (
    <>
      <div className="search-filter-scroll">
        <div className="search-filter-bar">
          <form
            className="search-keyword"
            onSubmit={(e) => {
              e.preventDefault();
              onApply({ ...filters, q: keyword.trim() });
            }}
          >
            <Search size={18} />
            <input
              name="q"
              aria-label="Từ khóa hoặc khu vực"
              maxLength={120}
              placeholder="Từ khóa / khu vực"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
            />
            <button aria-label="Tìm kiếm" type="submit">
              <Search size={17} />
            </button>
          </form>
          {(Object.keys(titles) as Panel[]).map((key) => (
            <button
              key={key}
              id={`filter-${key}`}
              type="button"
              className={`search-filter-trigger ${active[key] ? 'is-active' : ''}`}
              aria-haspopup="dialog"
              aria-expanded={open === key}
              aria-controls={open === key ? 'search-filter-panel' : undefined}
              onClick={(e) => show(key, e.currentTarget)}
            >
              {key === 'more' && <SlidersHorizontal size={16} />}
              <span>{labels[key]}</span>
              <ChevronDown size={14} />
            </button>
          ))}
          <button
            className="search-filter-reset"
            type="button"
            onClick={() => {
              setKeyword('');
              onApply(Object.fromEntries(filterNames.map((key) => [key, ''])));
            }}
          >
            <RotateCcw size={15} />
            Xóa bộ lọc
          </button>
        </div>
      </div>
      {Object.keys(fields).length > 0 && (
        <p role="alert" className="discovery-field-error">
          {Object.values(fields).join(' ')}
        </p>
      )}
      {open &&
        createPortal(
          <div
            className="search-popover-backdrop"
            onPointerDown={(e) => {
              if (e.target === e.currentTarget) close();
            }}
          >
            <div
              ref={panel}
              id="search-filter-panel"
              className="search-filter-panel"
              style={position}
              role="dialog"
              aria-modal="true"
              aria-labelledby="search-filter-title"
            >
              <header>
                <h2 id="search-filter-title">{titles[open]}</h2>
                <button type="button" aria-label="Đóng bộ lọc" onClick={close}>
                  <X size={19} />
                </button>
              </header>
              <div className="search-filter-content">
                {open === 'transaction' ? (
                  <div className="search-transaction-options">
                    {['Sale', 'Rent', ''].map((value) => (
                      <button
                        key={value}
                        type="button"
                        aria-pressed={filters.transaction === value}
                        onClick={() =>
                          apply({
                            ...filters,
                            transaction: value,
                            ...(filters.transaction !== value ? { minPrice: '', maxPrice: '' } : {}),
                          })
                        }
                      >
                        {transactionLabels[value]}
                        {filters.transaction === value && <Check size={18} />}
                      </button>
                    ))}
                  </div>
                ) : open === 'price' ? (
                  <RangeFields kind="Price" draft={draft} onChange={setDraft} />
                ) : open === 'bedrooms' ? (
                  <fieldset className="search-range">
                    <legend>Số phòng ngủ</legend>
                    <div className="search-bedrooms">
                      {['', '1', '2', '3', '4', '5'].map((value) => (
                        <button
                          key={value}
                          type="button"
                          aria-pressed={draft.bedrooms === value}
                          onClick={() => setDraft({ ...draft, bedrooms: value })}
                        >
                          {value ? `${value}+` : 'Tất cả'}
                        </button>
                      ))}
                    </div>
                  </fieldset>
                ) : open === 'type' ? (
                  <div className="search-type-grid">
                    {types.map(([value, label, Icon]) => (
                      <button
                        type="button"
                        key={value}
                        aria-pressed={draft.type === value}
                        onClick={() => setDraft({ ...draft, type: value })}
                      >
                        <Icon size={24} />
                        <span>{label}</span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <>
                    <RangeFields kind="Area" draft={draft} onChange={setDraft} />
                    <label>
                      Khu vực
                      <input
                        name="location"
                        maxLength={120}
                        placeholder="Thành phố, quận hoặc địa chỉ"
                        value={draft.location}
                        onChange={(e) => setDraft({ ...draft, location: e.target.value })}
                      />
                    </label>
                    <label>
                      Dự án
                      <select
                        name="project"
                        value={draft.project}
                        onChange={(e) => setDraft({ ...draft, project: e.target.value })}
                      >
                        <option value="">Tất cả dự án</option>
                        {projects.map((project) => (
                          <option key={project.id} value={project.id}>
                            {project.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    {projectError && (
                      <p className="discovery-field-error">Chưa thể tải dự án. Bạn vẫn có thể dùng các bộ lọc khác.</p>
                    )}
                    <label>
                      Tình trạng
                      <select
                        name="availability"
                        value={draft.availability}
                        onChange={(e) => setDraft({ ...draft, availability: e.target.value })}
                      >
                        <option value="">Tất cả tình trạng</option>
                        {Object.entries(availabilityLabels).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </>
                )}
              </div>
              {open !== 'transaction' && (
                <footer>
                  {open === 'more' && (
                    <button
                      type="button"
                      className="text-link"
                      onClick={() => {
                        setKeyword('');
                        apply(Object.fromEntries(filterNames.map((key) => [key, ''])));
                      }}
                    >
                      Xóa bộ lọc
                    </button>
                  )}
                  <button type="button" className="button primary" disabled={invalid} onClick={() => apply()}>
                    Áp dụng
                  </button>
                  {invalid && (
                    <p role="alert" className="discovery-field-error">
                      Kiểm tra giới hạn và thứ tự khoảng giá, diện tích.
                    </p>
                  )}
                </footer>
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
