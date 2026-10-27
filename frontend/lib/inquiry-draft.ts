const storageKey = 'terava-inquiry-draft';
const lifetime = 30 * 60 * 1000;

type InquiryDraft = { name: string; phone: string; message: string; createdAt: number };

export function saveInquiryDraft(draft: InquiryDraft) {
  try {
    sessionStorage.setItem(storageKey, JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}

export function readInquiryDraft(): InquiryDraft | null {
  try {
    const raw = sessionStorage.getItem(storageKey);
    if (!raw) return null;
    const draft = JSON.parse(raw);
    if (
      !draft ||
      typeof draft.name !== 'string' ||
      typeof draft.phone !== 'string' ||
      typeof draft.message !== 'string' ||
      typeof draft.createdAt !== 'number' ||
      Date.now() - draft.createdAt > lifetime ||
      draft.createdAt > Date.now()
    ) {
      clearInquiryDraft();
      return null;
    }
    return {
      name: draft.name.slice(0, 80),
      phone: draft.phone.slice(0, 20),
      message: draft.message.slice(0, 3000),
      createdAt: draft.createdAt,
    };
  } catch {
    return null;
  }
}

export function clearInquiryDraft() {
  try {
    sessionStorage.removeItem(storageKey);
  } catch {
    /* Storage may be disabled. */
  }
}
