// @ts-expect-error Standalone CLI scripts are JavaScript modules.
import { assertListingPrivacy, hasListingContactData, scrubListingText } from '../scripts/listing-privacy.mjs';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

describe('listing text privacy', () => {
  it.each([
    '0967.703.685',
    '0777666968',
    '+84 912 345 678',
    '090-123-4567',
    '84.912.345.678',
    '0 912 345 678',
    '091 234 567',
    '0123 456 7890',
  ])('detects and removes phone format %s', (phone) => {
    expect(hasListingContactData(phone)).toBe(true);
    expect(scrubListingText(`Nhà 50m². Số ${phone}. Sổ hồng riêng.`)).toBe('Nhà 50m². Sổ hồng riêng.');
  });

  it.each([
    'Liên hệ ngay Huân Nhà Đẹp 0967.703.685 xem căn nhà',
    '🔹Liên Hệ: Đình Phương. 0777666968 hỗ trợ xem nhà',
    'LIEN HE CHINH CHU ANH TUAN',
    'Liên hệ chính chủ anh Tuấn',
    'Zalo 09…',
    'LH: Tuấn',
    'L/H: Tuấn',
    'Gọi để xem nhà',
    'Call now',
    'Hotline',
    'SĐT: riêng',
    'sdt',
    'điện thoại',
    'ĐT: Tuấn',
    'Inbox ngay',
    'Nhắn tin',
    'Tư vấn miễn phí',
    'Hỗ trợ xem nhà',
    'Xem nhà miễn phí',
    'Môi giới',
    'Tìm nhà cứ để em lo',
    'Kiếm tiền là việc của anh chị, tìm nhà cứ để em lo',
    'website',
    'fanpage',
    'youtube',
    'tiktok',
    'facebook',
    'Anh Tuấn hỗ trợ',
    'Chị Hoa giới thiệu',
    'Mr Smith',
    'Ms. Lan',
    'Chính chủ Tuấn bán',
    'CHÍNH CHỦ TUẤN',
    'Chinh chu Tuan',
    'Hiện tại tôi đang quản lý hơn 500 căn nhà phố, tư vấn tận tình, hỗ trợ pháp lý.',
    'Chuyên giỏ hàng chuyển nhượng',
    'Cập nhật giỏ hàng sơ cấp',
    'Nhận ký gửi bán cho thuê',
    'VÀ CÒN NHIỀU BĐS NHÀ & ĐẤT',
    'Xem nhà thực tế – làm việc trực tiếp',
    'Liên hệ. Đình Phương.',
  ])('drops contact or broker sentence: %s', (contact) => {
    expect(scrubListingText(`Nhà có 3 phòng ngủ.\n${contact}\nSổ hồng riêng.`)).toBe(
      'Nhà có 3 phòng ngủ. Sổ hồng riêng.',
    );
  });

  it.each(['broker@example.test', 'https://example.test/contact', 'www.example.test', 'example.vn', '@broker_name'])(
    'removes %s without leaving fragments',
    (contact) => {
      const result = scrubListingText(`Nhà 50m². Thông tin ${contact}. Sổ hồng riêng.`);
      expect(result).toBe('Nhà 50m². Sổ hồng riêng.');
      expect(hasListingContactData(result)).toBe(false);
    },
  );

  it('removes mid-paragraph contact sentences and keeps subsequent property facts', () => {
    expect(
      scrubListingText(
        'Nhà 50m², 3 phòng ngủ. Liên hệ anh Tuấn +84 912 345 678 để xem nhà. Giá 3,5 tỷ. Sổ hồng riêng.',
      ),
    ).toBe('Nhà 50m², 3 phòng ngủ. Giá 3,5 tỷ. Sổ hồng riêng.');
  });

  it('keeps clean property paragraphs, prices, measurements, legal status and locations', () => {
    const clean =
      'Nhà 50,5m², ngang 4.5m, 3 phòng ngủ, 2 WC. DT: 100m² thổ cư. Giá 3,5 tỷ. Sổ hồng riêng, chính chủ sẵn sàng giao dịch. Gần trường học, điện nước đầy đủ tại đường Nguyễn Ảnh Thủ.';
    expect(scrubListingText(clean)).toBe(clean);
    expect(hasListingContactData(clean)).toBe(false);
    expect(scrubListingText('CHÍNH CHỦ BÁN NHÀ 50M².')).toBe('CHÍNH CHỦ BÁN NHÀ 50M².');
  });

  it('normalizes emoji bullets, separators and blank lines without removing property numbers', () => {
    expect(scrubListingText('🏠 Nhà 50m²\n\n🔹 3 phòng ngủ\n-----\n• Sổ hồng riêng')).toBe(
      'Nhà 50m² 3 phòng ngủ Sổ hồng riêng',
    );
  });

  it.each([
    'Nhà 50m² - Liên hệ anh Tuấn 090-123-4567',
    'Nhà 50m² 0967.703.685',
    'Nhà 50m² - Zalo 09…',
    'Nhà 50m² broker@example.test',
    'Nhà 50m² https://example.test',
  ])('keeps the property portion of title %s', (title) => {
    expect(scrubListingText(title, { title: true })).toBe('Nhà 50m²');
  });

  it.each(['name', 'description', 'location', 'quality_notes'])('hard guard rejects a detector hit in %s', (field) => {
    expect(() => assertListingPrivacy([{ row: { [field]: '090-123-4567' } }])).toThrow('dừng nhập');
    expect(() => assertListingPrivacy([{ row: { [field]: 'person@example.test' } }])).toThrow('dừng nhập');
    expect(() => assertListingPrivacy([{ row: { [field]: 'https://example.test' } }])).toThrow('dừng nhập');
  });

  it('CLI exits 1 before writing any preview when an output location contains contact data', () => {
    const dir = mkdtempSync(join(tmpdir(), 'listing-privacy-'));
    const file = join(dir, 'input.json');
    writeFileSync(
      file,
      JSON.stringify({
        '_id.$oid': { 0: '0123456789abcdef01234567' },
        title: { 0: 'Nhà 50m²' },
        description: { 0: 'Nhà 50m², sổ hồng riêng.' },
        type: { 0: 'House' },
        transactionType: { 0: 'ForSale' },
        'location.city': { 0: '090-123-4567' },
      }),
    );
    try {
      let failure: unknown;
      try {
        execFileSync(
          process.execPath,
          [fileURLToPath(new URL('../scripts/import-revoland.mjs', import.meta.url)), file],
          { env: { ...process.env, TEMP: dir, TMP: dir }, stdio: 'pipe' },
        );
      } catch (error) {
        failure = error;
      }
      expect(failure).toMatchObject({ status: 1 });
      expect(existsSync(join(dir, 'import-revoland-preview.json'))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
