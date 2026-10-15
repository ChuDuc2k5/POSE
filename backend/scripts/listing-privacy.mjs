const phone = /(?<!\d)(?:\+?84(?:[ \t\u00a0.()-]*\d){7,9}|0(?:[ \t\u00a0.()-]*\d){8,10})(?![ \t\u00a0.()-]*\d)/gu;
const email = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/gu;
const url = /(?:https?:\/\/|www\.)[^\s<>]+|(?<![\p{L}\p{N}@])(?:[\p{L}\p{N}-]+\.)+(?:com|vn|net|org|io|me|co|tv|info|biz)(?:\/[^\s<>]*)?(?![\p{L}\p{N}])/giu;
const handle = /@[\p{L}\p{N}_][\p{L}\p{N}_.-]*/gu;
const detectors = [phone, email, url, handle];
const fold = text => text.normalize('NFD').replace(/\p{M}/gu, '').replace(/[đĐ]/gu, 'd').toLowerCase();
const solicitation = /\b(?:lien\s*he|l\s*[/.]?\s*h|goi|call|zalo|hotline|sdt|dien\s*thoai|inbox|nhan\s*tin|tu\s*van|ho\s*tro\s*xem\s*nha|xem\s*nha\s*(?:mien\s*phi|thuc\s*te)|moi\s*gioi|em\s*lo|anh\s*chi|website|fanpage|youtube|tiktok|facebook|cam\s*ket\s*thong\s*tin|ho\s*tro\s*phap\s*ly|(?:toi|em)\s*dang\s*quan\s*ly|chuyen\s*gio\s*hang|cap\s*nhat\s*gio\s*hang|nhan\s*ky\s*gui|va\s*con\s*nhieu\s*bds|cac\s*bds\s*deu|hang\s*that\s*gia\s*that|uu\s*tien\s*khach\s*quyet|vi\s*sao\s*ndt)\b/iu;
// DT is also the common abbreviation for diện tích; only ĐT is a phone label.
const telephoneLabel = /(?:^|[^\p{L}])đt\s*:/iu;
const addressedName = /(?:^|[^\p{L}])(?:[Aa][Nn][Hh]|[Cc][Hh][ịiỊI]|[Mm][RrSs]\.?)\s*[:-]?\s+\p{Lu}[\p{L}]*/u;
const namedOwner = /\bchinh\s*chu\s+(?:anh|chi|ong|ba|mr|ms)\b/iu;
const directOwnerName = /[Cc][Hh][iíIÍ][Nn][Hh]\s+[Cc][Hh][uủUỦ]\s*[:-]?\s+(\p{Lu}[\p{L}]*)/u;
const ownerPropertyWords = new Set(['ban', 'gui', 'can', 'cho', 'san', 'so', 'phap', 'gia', 'nha', 'dat', 'thue', 'dang', 'da', 'co', 'gap', 'khong', 'thuan']);
const whitespace = text => text.replace(/\s+/gu, ' ').trim();
const sentenceBreak = /\n|(?<!\b[Mm][RrSs]\.)(?<=[.!?;])\s+|(?<=[.!?])(?=\p{Lu})/u;

export function hasListingContactData(value) {
  const text = String(value ?? '');
  return detectors.some(pattern => new RegExp(pattern).test(text));
}

function ownerNameMatch(text) {
  const match = directOwnerName.exec(text);
  return match && !ownerPropertyWords.has(fold(match[1])) ? match : null;
}

function isSolicitation(text) {
  return solicitation.test(fold(text)) || telephoneLabel.test(text) || addressedName.test(text) || namedOwner.test(fold(text)) || Boolean(ownerNameMatch(text));
}

function normalizeBullets(text) {
  return text.replace(/[\p{Extended_Pictographic}\p{Emoji_Presentation}\uFE0F\u200D]/gu, '')
    .replace(/^[\s•●▪▫◆◇►▶➤→✓✔★☆+|=–—-]+/gu, '')
    .replace(/\s*[|=*_–—-]{3,}\s*/gu, ' ')
    .trim();
}

export function scrubListingText(value, { title = false } = {}) {
  const text = String(value ?? '').normalize('NFC').replace(/\r\n?/gu, '\n');
  if (title) {
    // A title often puts the contact suffix after otherwise useful property facts.
    let safe = text;
    for (const pattern of detectors) safe = safe.replace(new RegExp(pattern), ' ');
    const markers = [solicitation.exec(fold(safe)), telephoneLabel.exec(safe), addressedName.exec(safe), namedOwner.exec(fold(safe)), ownerNameMatch(safe)].filter(Boolean);
    if (markers.length) safe = safe.slice(0, Math.min(...markers.map(marker => marker.index)));
    safe = safe.split(sentenceBreak).filter(part => !isSolicitation(part)).join(' ');
    return whitespace(normalizeBullets(safe).replace(/[\s,;:|–—-]+$/gu, ''));
  }
  // Protect dotted/spaced phones and URLs before sentence segmentation, so no fragment leaks.
  const tokens = [];
  let protectedText = text;
  for (const pattern of detectors) protectedText = protectedText.replace(new RegExp(pattern), match => {
    const token = `\uE000${tokens.length}\uE001`;
    const punctuation = match.match(/[.!?;,]+$/u)?.[0] ?? '';
    tokens.push(match.slice(0, match.length - punctuation.length));
    return token + punctuation;
  });
  const restore = part => part.replace(/\uE000(\d+)\uE001/gu, (_, index) => tokens[Number(index)]);
  const lines = protectedText.split('\n').map(normalizeBullets).filter(line => {
    const restored = restore(line);
    // A contact-led line may include the poster's bare name in a later sentence.
    return solicitation.exec(fold(restored))?.index !== 0 && telephoneLabel.exec(restored)?.index !== 0
      && addressedName.exec(restored)?.index !== 0 && namedOwner.exec(fold(restored))?.index !== 0
      && ownerNameMatch(restored)?.index !== 0;
  });
  const sentences = lines.flatMap(line => line.split(sentenceBreak));
  const kept = sentences.map(restore).map(normalizeBullets)
    .filter(part => part && !isSolicitation(part) && !hasListingContactData(part));
  let safe = kept.join(' ');
  for (const pattern of detectors) safe = safe.replace(new RegExp(pattern), ' ');
  return whitespace(safe);
}

export function assertListingPrivacy(prepared) {
  for (const [index, { row }] of prepared.entries()) {
    // Source identifiers and planned media URLs are not listing prose.
    if (['name', 'description', 'location', 'quality_notes'].some(key => hasListingContactData(row[key]))) {
      throw new Error(`Dữ liệu liên hệ còn trong tin thứ ${index + 1}; dừng nhập trước khi ghi dữ liệu.`);
    }
  }
}
