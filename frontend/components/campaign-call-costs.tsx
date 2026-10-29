type Cost = {
  call_id: string;
  estimated_vnd: number | null;
  actual: number | null;
  currency: string | null;
  fx_rate: number | null;
  fx_source: string | null;
  unknown: boolean;
};
export function CampaignCallCosts({ items = [] }: { items?: Cost[] }) {
  if (!items.length) return null;
  return (
    <section>
      <h3>Chi phí từng cuộc gọi</h3>
      {items.map((c) => (
        <p key={c.call_id}>
          <a href={`/admin/calls/${c.call_id}`}>{c.call_id.slice(0, 8)}</a> · Ước lượng:{' '}
          {c.estimated_vnd ?? 'Chưa biết'} VND · Thực tế: {c.actual ?? 'Chưa biết'} {c.currency || ''} · Tỷ giá:{' '}
          {c.fx_rate ?? 'Chưa có'} ({c.fx_source || 'Chưa có nguồn'}){c.unknown ? ' · Cần đối soát' : ''}
        </p>
      ))}
    </section>
  );
}
