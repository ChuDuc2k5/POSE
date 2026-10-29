import { vi } from 'vitest';
// @ts-expect-error Standalone CLI scripts are JavaScript modules.
import { dedupeRevoland, prepareRevoland, summarizeRevoland, transposeColumns } from '../scripts/import-revoland.mjs';
// @ts-expect-error Standalone CLI scripts are JavaScript modules.
import { importListingImage } from '../scripts/listing-media.mjs';
import sharp from 'sharp';

type RecordRow = Record<string, unknown>;
const now = '2026-10-15T00:00:00.000Z';
function fixture(overrides: RecordRow[] = [{}]) {
  const input: Record<string, Record<string, unknown>> = {};
  overrides.forEach((override, index) => {
    const record = {
      '_id.$oid': `${(index + 1).toString(16).padStart(16, '0')}abcdef12`,
      title: `NHÀ ĐẸP ${index}`,
      description: ' Đoạn đầu.  Giữ nguyên đoạn cuối chưa kết thúc ',
      type: 'House',
      transactionType: 'ForSale',
      'location.ward': 'Phường A',
      'location.city': 'TP. Hồ Chí Minh',
      'propertyDetails.landArea': 50,
      'propertyDetails.bedrooms': 2,
      'priceDetails.salePrice': 2000000000,
      ...override,
    };
    for (const [key, value] of Object.entries(record)) (input[key] ??= {})[index] = value;
  });
  return input;
}

describe('Revoland import', () => {
  it('scrubs embedded contact data from titles and descriptions before building rows', () => {
    const prepared = prepareRevoland(
      fixture([
        {
          title: 'NHÀ 50M² - Liên hệ 090-123-4567',
          description: 'Nhà 50m², 3 phòng ngủ. Liên hệ anh Tuấn 0967.703.685. Sổ hồng riêng.',
        },
      ]),
      now,
    );
    expect(prepared[0].row.name).toBe('Nhà 50m2');
    expect(prepared[0].row.description).toBe('Nhà 50m², 3 phòng ngủ. Sổ hồng riêng. Nguồn: dữ liệu Revoland.');
    expect(summarizeRevoland(prepared)).toMatchObject({ rowsChangedByScrubbing: 1, rowsWithDetectorHits: 0 });
  });

  it('prepares an array using only the allowed flat columns', () => {
    const rows = prepareRevoland(
      [
        {
          _id: { $oid: '000000000000000000000001' },
          title: 'Nhà đẹp',
          description: 'Mô tả',
          type: 'House',
          transactionType: 'ForSale',
          location: { ward: 'Ward A', city: 'HCMC', address: '1 Main' },
          propertyDetails: { landArea: 40 },
          priceDetails: { salePrice: 100 },
          contactPhone: '0900000000',
          status: 'ARCHIVED',
          adminNote: 'private',
        },
      ],
      now,
    );
    expect(rows[0].row).toMatchObject({ source_external_id: '000000000000000000000001', area: 40, price: 100 });
    expect(JSON.stringify(rows)).not.toContain('0900000000');
  });

  it('transposes sparse column indices and skips only deleted rows', () => {
    const input = fixture([{}, { isDeleted: true }, { isDeleted: false }]);
    input['propertyDetails.usableArea'] = { 2: 80 };
    expect(transposeColumns(input)).toHaveLength(3);
    expect(transposeColumns(input)[2]['propertyDetails.usableArea']).toBe(80);
    expect(prepareRevoland(input, now)).toHaveLength(2);
  });

  it.each([
    ['House', 'House'],
    ['Townhouse', 'House'],
    ['Motel', 'House'],
    ['Apartment', 'Apartment'],
    ['MiniServiceApartment', 'Apartment'],
    ['LandPlot', 'Land'],
    ['Factory', 'Shop'],
    ['Warehouse', 'Shop'],
    ['Other', 'House'],
    ['SocialHousing', 'Apartment'],
    ['ProjectLand', 'Land'],
    ['Office', 'Office'],
  ])('maps %s to %s', (type, expected) => {
    const [{ row }] = prepareRevoland(fixture([{ type }]), now);
    expect(row.property_type).toBe(expected);
    expect(row.quality_notes.includes('Loại gốc: Other')).toBe(type === 'Other');
  });

  it('appends orientation and furnished text', () => {
    const [{ row }] = prepareRevoland(
      fixture([{ 'propertyDetails.apartmentOrientation': 'SouthEast', 'propertyDetails.furnished': true }]),
      now,
    );
    expect(row.description).toContain('Hướng Đông Nam.');
    expect(row.description).toContain('Có nội thất.');
  });

  it.each([
    ['a', { source_external_id: 'same' }, { source_external_id: 'same', code: 'OLD-A' }],
    ['b', { name: 'Same Title', source_external_id: 'new' }, { name: 'same title', code: 'OLD-B' }],
    [
      'c',
      {
        name: 'Nhà hẻm 61 Trần Đồng',
        description: 'Nhà 1 trệt 1 lầu hẻm 61 Trần Đồng sổ hồng riêng',
        transaction_type: 'Sale',
        price: 100,
        area: 50.04,
        location: 'Ward A, City',
        source_external_id: 'new',
      },
      {
        name: 'NHÀ 1 TRỆT 1 LẦU HẺM 61 TRẦN ĐỒNG',
        description: 'Nhà 1 trệt 1 lầu hẻm 61 Trần Đồng sổ hồng riêng',
        transaction_type: 'Sale',
        price: 100,
        area: 50.01,
        location: 'Ward A, City',
        code: 'OLD-C',
      },
    ],
  ])('deduplicates existing rule %s', (reason, row, existing) => {
    const result = dedupeRevoland([{ row } as any], [existing]);
    expect(result.counts[reason as 'a' | 'b' | 'c']).toBe(1);
    expect(result.skipped[0]).toMatchObject({ reason, matchedCode: existing.code });
  });

  it('keeps different units of one project that share price, area and ward', () => {
    const base = {
      transaction_type: 'Rent',
      price: 9000000,
      area: 61,
      location: 'Phường Long Bình, Thành phố Hồ Chí Minh',
    };
    const first = {
      ...base,
      name: 'Mã căn: BS tầng 16',
      description: 'Mã căn: BS tầng 16 Loại căn: 2PN2WC Loại hđ: 1 năm Nội thất bếp rèm',
      source_external_id: 'one',
    };
    const second = {
      ...base,
      name: 'Origami S10 tầng 26',
      description: 'Mã căn: Origami S10 tầng 26 Loại căn: 2PN2WC Loại hđ: 1 năm Nội thất bếp rèm',
      source_external_id: 'two',
    };
    expect(
      dedupeRevoland(
        [{ row: first } as any, { row: second } as any],
        [
          {
            ...base,
            name: 'RB S3 tầng 33',
            description: 'Mã căn: RB S3 tầng 33 Loại căn: 2PN1WC Loại hđ: 1 năm',
            code: 'OLD',
          },
        ],
      ).kept,
    ).toHaveLength(2);
  });

  it('deduplicates earlier records in the input under rule d', () => {
    const row = {
      name: 'Same Title',
      source_external_id: 'new',
      transaction_type: 'Sale',
      price: 100,
      area: 50,
      location: 'Ward A, City',
    };
    const result = dedupeRevoland([{ row } as any, { row: { ...row, source_external_id: 'later' } }], []);
    expect(result.kept).toHaveLength(1);
    expect(result.counts.d).toBe(1);
    expect(result.skipped[0]).toMatchObject({ oid: 'later', reason: 'd' });
  });

  it('uses the correct sale/rent price and supports extended numeric values', () => {
    const prepared = prepareRevoland(
      fixture([
        { 'priceDetails.salePrice': null, 'priceDetails.salePrice.$numberLong': '3500000000' },
        { transactionType: 'ForRent', 'priceDetails.rentalPrice': 12000000 },
        { transactionType: 'ForRent', 'priceDetails.rentalPrice': { $numberLong: '15000000' } },
      ]),
      now,
    );
    expect(prepared[0].row).toMatchObject({ price: 3500000000, transaction_type: 'Sale', price_period: 'Total' });
    expect(prepared[1]).toMatchObject({
      project: 'REVOLAND-THUE',
      row: { price: 12000000, transaction_type: 'Rent', price_period: 'Month' },
    });
    expect(prepared[2].row.price).toBe(15000000);
  });

  it('falls back through positive areas and publishes only with area and price', () => {
    const rows = prepareRevoland(
      fixture([
        { 'propertyDetails.landArea': 0, 'propertyDetails.usableArea': 65, 'propertyDetails.buildingArea': 80 },
        { 'propertyDetails.landArea': -1, 'propertyDetails.usableArea': 0, 'propertyDetails.buildingArea': 80 },
        { 'propertyDetails.landArea': null },
        { 'priceDetails.salePrice': 0, 'propertyDetails.bedrooms': 0 },
        { 'priceDetails.salePrice': -10 },
      ]),
      now,
    );
    expect(rows[0].row).toMatchObject({ area: 65, publication: 'Published' });
    expect(rows[1].row).toMatchObject({ area: 80, publication: 'Published' });
    expect(rows[2].row).toMatchObject({ area: null, publication: 'Draft' });
    expect(rows[2].row.quality_notes).toContain('Thiếu diện tích');
    expect(rows[3].row).toMatchObject({ price: null, bedrooms: null, publication: 'Draft' });
    expect(rows[3].row.quality_notes).toContain('giá');
    expect(rows[4].row).toMatchObject({ price: null, publication: 'Draft' });
  });

  it('never accesses forbidden columns or carries their names or values into output', () => {
    const forbidden = [
      'contactName',
      'contactPhone',
      'contactEmail',
      'ownerId',
      'salerId',
      'managerId',
      'updatedById',
      'companyId',
      'adminCompanyId',
      'teamId',
      'adminNote',
      'salerNote',
      'privateNote',
      'transactionHistory',
      'ownerId.$oid',
      'unknownId.$oid',
      'location.v2.wardId.$oid',
    ];
    const input = fixture();
    for (const key of forbidden)
      Object.defineProperty(input, key, {
        enumerable: true,
        get() {
          throw new Error(`Forbidden access: ${key}`);
        },
      });
    const output = JSON.stringify({ transposed: transposeColumns(input), prepared: prepareRevoland(input, now) });
    for (const key of forbidden) expect(output).not.toContain(key);
    const populated = fixture([Object.fromEntries(forbidden.map((key) => [key, 'PRIVATE_SENTINEL']))]);
    expect(JSON.stringify(prepareRevoland(populated, now))).not.toContain('PRIVATE_SENTINEL');
  });

  it('preserves description text and appends only true, known amenities and positive details', () => {
    const [{ row }] = prepareRevoland(
      fixture([
        {
          'amenities.parking': true,
          'amenities.cctv': true,
          'amenities.securitySystem': true,
          'amenities.gym': false,
          'amenities.elevator': 'true',
          'amenities.unknown': true,
          'propertyDetails.bathrooms': 3,
          'propertyDetails.numberOfFloors': 2,
        },
      ]),
      now,
    );
    expect(row.description).toBe(
      'Đoạn đầu. Giữ nguyên đoạn cuối chưa kết thúc Tiện ích: chỗ đậu xe, an ninh/camera. 3 phòng tắm. 2 tầng. Nguồn: dữ liệu Revoland.',
    );
    expect(row.name).toBe('Nhà Đẹp 0');
    expect(
      prepareRevoland(fixture([{ description: 'x'.repeat(11000), title: 'x'.repeat(200) }]), now)[0].row.description,
    ).toHaveLength(10000);
    expect(prepareRevoland(fixture([{ title: 'x'.repeat(200) }]), now)[0].row.name).toHaveLength(160);
  });

  it('keeps duplicate titles as distinct stable source identities with review notes', () => {
    const input = fixture([{ title: 'Cùng tiêu đề' }, { title: ' Cùng   tiêu đề ' }]);
    const rows = prepareRevoland(input, now);
    expect(rows).toHaveLength(2);
    expect(rows[0].row.code).toBe('RVL-0000000000000001');
    expect(rows[1].row.code).not.toBe(rows[0].row.code);
    expect(rows[0].row.code).toBe(prepareRevoland(input, now)[0].row.code);
    for (const { row } of rows) expect(row.quality_notes).toContain('Tiêu đề trùng với tin khác');
  });

  it('maps provenance, dates, location fallbacks and image limits', () => {
    const rows = prepareRevoland(
      fixture([
        { 'publishedAt.$date': '2026-01-01T03:16:53.744Z', images: Array(8).fill('https://example.test/image.jpg') },
        { 'location.ward': '', 'location.city': '', 'location.address': '123 Đường A', 'submittedAt.$date': now },
        { 'location.ward': null, 'publishedAt.$date': 'bad date' },
        { 'location.ward': '', 'location.address': '123 Đường A' },
      ]),
      now,
    );
    expect(rows[0].row).toMatchObject({
      source_website: 'revoland',
      source_url: null,
      scraped_at: '2026-01-01T03:16:53.744Z',
      data_quality: 'NeedsReview',
      availability: 'Available',
    });
    expect(rows[0].image_urls).toHaveLength(5);
    expect(rows[1].row).toMatchObject({ location: '123 Đường A', scraped_at: now });
    expect(rows[2].row).toMatchObject({ location: 'TP. Hồ Chí Minh', scraped_at: now });
    expect(rows[3].row.location).toBe('123 Đường A, TP. Hồ Chí Minh');
    expect(summarizeRevoland(rows)).toMatchObject({
      total: 4,
      published: 4,
      draft: 0,
      byType: { House: 4 },
      byTransaction: { Sale: 4 },
      imagesPlanned: 5,
    });
  });

  it('uses the shared WebP upload, metadata, version and history flow with a fake transport', async () => {
    const source = await sharp({ create: { width: 4, height: 3, channels: 3, background: '#fff' } })
      .png()
      .toBuffer();
    const transport = vi
      .fn()
      .mockResolvedValueOnce(new Response(source, { headers: { 'Content-Type': 'image/png' } }))
      .mockResolvedValueOnce(new Response(''));
    const rest = vi
      .fn()
      .mockResolvedValueOnce([{ id: 'media' }])
      .mockResolvedValueOnce([{ version: 4 }])
      .mockResolvedValue(null);
    vi.stubGlobal('fetch', transport);
    try {
      await importListingImage({
        imageUrl: 'https://example.test/image.png',
        product: { id: 'product' },
        objectKey: 'product/revoland-0.webp',
        index: 0,
        sourceWebsite: 'revoland',
        visibility: 'Internal',
        url: 'https://example.test',
        headers: {},
        rest,
        actorId: 'admin',
      });
      const content = transport.mock.calls[1][1].body as Buffer;
      expect((await sharp(content).metadata()).format).toBe('webp');
      expect(transport.mock.calls[1][0]).toContain('/storage/v1/object/property-files/product/revoland-0.webp');
      expect(JSON.parse(rest.mock.calls[0][1].body)[0]).toMatchObject({
        visibility: 'Internal',
        mime_type: 'image/webp',
        size_bytes: content.length,
        sort_order: 0,
      });
      expect(JSON.parse(rest.mock.calls[2][1].body).version).toBe(5);
      expect(JSON.parse(rest.mock.calls[3][1].body)[0]).toMatchObject({
        actor_id: 'admin',
        action: 'media_imported',
        source: 'Import',
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it.each([
    [new Response('', { status: 503, headers: { 'Content-Type': 'image/jpeg' } }), 'HTTP 503'],
    [new Response('not an image', { headers: { 'Content-Type': 'text/html' } }), 'máy chủ không trả về ảnh'],
  ])('reports failed downloads without metadata or history writes', async (response, message) => {
    const rest = vi.fn();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
    try {
      await expect(importListingImage({ imageUrl: 'https://example.test/image', rest })).rejects.toThrow(message);
      expect(rest).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
