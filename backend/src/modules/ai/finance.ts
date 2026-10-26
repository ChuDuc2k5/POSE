import { moneyAmounts } from './money.js';

export type LoanPayment = {
  monthlyPayment: number;
  totalInterest: number;
  monthlyRate: number;
  payments: number;
};

export type RateChange = LoanPayment & {
  balanceAfterChange: number;
  newMonthlyPayment: number;
  paymentDifference: number;
};

export type FinanceEvidence = {
  note: string;
  amounts: number[];
  ranges: [number, number][];
  ratios: number[];
};

const monthlyRate = (annualRate: number) => annualRate / 100 / 12;
const numberWords: Record<string, number> = { một: 1, hai: 2, ba: 3, bốn: 4, năm: 5, sáu: 6, bảy: 7, tám: 8, chín: 9, mười: 10 };
const smallNumber = (value: string) => Number.isFinite(Number(value)) ? Number(value) : numberWords[value.toLocaleLowerCase('vi')] || 0;

export function annuityPayment(principal: number, annualRate: number, years: number): LoanPayment {
  if (!(principal > 0) || !(annualRate >= 0) || !(years > 0)) throw new Error('INVALID_LOAN_INPUT');
  const payments = Math.round(years * 12);
  const rate = monthlyRate(annualRate);
  const monthlyPayment = rate === 0
    ? principal / payments
    : principal * rate / (1 - (1 + rate) ** -payments);
  return { monthlyPayment, totalInterest: monthlyPayment * payments - principal, monthlyRate: rate, payments };
}

export function remainingBalance(principal: number, annualRate: number, years: number, paidMonths: number): number {
  const loan = annuityPayment(principal, annualRate, years);
  const months = Math.max(0, Math.min(loan.payments, Math.round(paidMonths)));
  if (months === loan.payments) return 0;
  if (loan.monthlyRate === 0) return Math.max(0, principal - loan.monthlyPayment * months);
  const balance = principal * (1 + loan.monthlyRate) ** months
    - loan.monthlyPayment * (((1 + loan.monthlyRate) ** months - 1) / loan.monthlyRate);
  return Math.max(0, balance);
}

export function rateChangePayment(
  principal: number,
  initialAnnualRate: number,
  newAnnualRate: number,
  years: number,
  changedAfterYears: number,
): RateChange {
  const initial = annuityPayment(principal, initialAnnualRate, years);
  const paidMonths = Math.round(changedAfterYears * 12);
  const balanceAfterChange = remainingBalance(principal, initialAnnualRate, years, paidMonths);
  const remainingYears = Math.max(0, years - changedAfterYears);
  const next = remainingYears ? annuityPayment(balanceAfterChange, newAnnualRate, remainingYears) : { monthlyPayment: 0, totalInterest: 0, monthlyRate: 0, payments: 0 };
  return {
    ...initial,
    balanceAfterChange,
    newMonthlyPayment: next.monthlyPayment,
    paymentDifference: next.monthlyPayment - initial.monthlyPayment,
  };
}

export function grossRentalYield(monthlyRent: number, price: number): number {
  if (!(monthlyRent >= 0) || !(price > 0)) throw new Error('INVALID_YIELD_INPUT');
  return monthlyRent * 12 / price;
}

export function safeMonthlyPayment(income: number, ratio = 0.4): number {
  if (!(income >= 0) || !(ratio > 0 && ratio <= 1)) throw new Error('INVALID_AFFORDABILITY_INPUT');
  return income * ratio;
}

const money = (value: number, digits = 1) => `${(value / 1_000_000).toLocaleString('vi-VN', { maximumFractionDigits: digits })} triệu đồng`;
const percent = (value: number, digits = 1) => `${(value * 100).toLocaleString('vi-VN', { maximumFractionDigits: digits })}%`;
const typicalLoanRateRange = '8–10%/năm';

function amountsWithUnit(text: string, unit: 'month' | 'year' = 'year') {
  const pattern = unit === 'month'
    ? /([\d.,]+)\s*(triệu|tr|tỷ|tỉ|ty)\s*(?:đồng\s*)?(?:\/\s*tháng|mỗi\s*tháng|hàng\s*tháng)/giu
    : /([\d.,]+)\s*(triệu|tr|tỷ|tỉ|ty)(?![\p{L}])/giu;
  return [...text.matchAll(pattern)].map(match => moneyAmounts(match[0])[0]).filter((value): value is number => typeof value === 'number');
}

function formatLoanScenario(text: string): string | null {
  const rates = [...text.matchAll(/(\d+(?:[.,]\d+)?)\s*%/gu)].map(match => Number(match[1].replace(',', '.')));
  const years = [...text.matchAll(/(\d+|một|hai|ba|bốn|năm|sáu|bảy|tám|chín|mười)\s*năm/giu)].map(match => smallNumber(match[1]));
  const change = text.match(/(?:sau|sau khoảng)\s+(\d+|một|hai|ba|bốn|năm|sáu|bảy|tám|chín|mười)\s*năm/iu);
  const principal = moneyAmounts(text).find(value => value >= 1_000_000_000);
  if (!principal || rates.length < 2 || years.length < 1 || !change) return null;
  const result = rateChangePayment(principal, rates[0], rates[1], years[0], smallNumber(change[1]));
  return `Tính theo dư nợ giảm dần, trả đều, khoản vay ${money(principal, 0)}, kỳ hạn ${years[0]} năm: mức trả ban đầu khoảng ${money(result.monthlyPayment)} mỗi tháng; sau ${change[1]} năm dư nợ còn khoảng ${money(result.balanceAfterChange)} và với lãi suất ${rates[1]}% mức trả mới khoảng ${money(result.newMonthlyPayment)}, chênh khoảng ${money(result.paymentDifference)} mỗi tháng. Đây là ước tính, giả định trả đúng hạn và lãi suất áp dụng cho phần thời hạn còn lại.`;
}

function formatAffordability(text: string): string | null {
  const incomeMatch = text.match(/thu\s*nhập[^\d]{0,20}([\d.,]+\s*(?:triệu|tr|tỷ|tỉ|ty))/iu);
  const cashMatch = text.match(/(?:có|sẵn|tự có|tiền mặt|vốn)[^\d]{0,20}([\d.,]+\s*(?:triệu|tr|tỷ|tỉ|ty))/iu);
  const priceMatch = text.match(/(?:căn|nhà|giá|mua)[^\d]{0,30}([\d.,]+\s*(?:tỷ|tỉ|ty|triệu|tr))/iu);
  if (!incomeMatch || !cashMatch || !priceMatch) return null;
  const income = moneyAmounts(incomeMatch[1])[0];
  const cash = moneyAmounts(cashMatch[1])[0];
  const price = moneyAmounts(priceMatch[1])[0];
  if (!income || !cash || !price || price <= cash) return null;
  const loan = price - cash;
  const low = annuityPayment(loan, 8, 20).monthlyPayment;
  const high = annuityPayment(loan, 10, 20).monthlyPayment;
  const safe = safeMonthlyPayment(income);
  return `Khả năng chi trả: giá ${money(price, 0)} trừ tiền có sẵn ${money(cash, 0)} cần vay khoảng ${money(loan, 0)}. Với ${typicalLoanRateRange} trong 20 năm, khoản trả đều khoảng ${money(low)}–${money(high)} mỗi tháng; quy tắc tham khảo phổ biến là tiền trả nợ không quá 40% thu nhập, tức khoảng ${money(safe)} với thu nhập ${money(income, 0)}/tháng. Vì vậy khoản vay này không an toàn với mức thu nhập đã nêu; nên chọn ngân sách có khoản trả trong mức tham khảo và nhờ chuyên viên/ngân hàng lập bảng cụ thể.`;
}

function formatYield(text: string, listingPrice?: number, marketNote?: string): string | null {
  const monthly = amountsWithUnit(text, 'month');
  const prices = amountsWithUnit(text, 'year').filter(value => value >= 500_000_000);
  if (monthly.length && prices.length >= 2) {
    const yields = prices.slice(0, monthly.length).map((price, index) => grossRentalYield(monthly[index], price));
    const note = `Lợi suất cho thuê gộp theo công thức tiền thuê × 12 / giá mua là ${yields.map(value => percent(value, 1)).join(' và ')}. Đây chưa trừ thời gian trống, phí quản lý, sửa chữa, thuế hoặc chi phí vay.`;
    return /(?:chi\s+phí\s+vay|chi\s+phí\s+vốn|lãi\s+suất|vay)/iu.test(text)
      ? `${note} Nếu khoản vay áp dụng lãi suất tham khảo khoảng ${typicalLoanRateRange}, các mức lợi suất gộp này thấp hơn mức lãi suất đó; đây chỉ là so sánh sơ bộ, chưa tính các chi phí khác.`
      : note;
  }
  if (listingPrice && marketNote) {
    const median = marketNote.match(/phổ biến khoảng\s+([^.]*)/iu)?.[1];
    const rent = median ? moneyAmounts(median)[0] : undefined;
    if (rent) return `Theo giá thuê phổ biến trong dữ liệu khu vực và giá căn đang xem, lợi suất cho thuê gộp khoảng ${percent(grossRentalYield(rent, listingPrice), 1)} (tiền thuê × 12 / giá mua). Đây là ước tính trước thời gian trống và các chi phí.`;
  }
  return null;
}

const yieldQuestionPattern = /(?:cho\s+thuê|lợi\s+suất|doanh\s+thu|sinh\s+lời|đầu\s+tư\s+cho\s+thuê|cho\s+thue|loi\s+suat|doanh\s+thu|sinh\s+loi|dau\s+tu\s+cho\s+thue)/iu;

function extractFinanceEvidence(note: string): FinanceEvidence {
  const amounts = moneyAmounts(note);
  const ranges: [number, number][] = [];
  for (const match of note.matchAll(/([\d.,]+\s*(?:tỷ|tỉ|triệu|tr))\s*(?:–|-|—)\s*([\d.,]+\s*(?:tỷ|tỉ|triệu|tr))/giu)) {
    const values = moneyAmounts(`${match[1]} - ${match[2]}`);
    if (values.length >= 2) ranges.push([values[0], values[1]]);
  }
  if (!ranges.length) for (const match of note.matchAll(/(\d[\d.,]*\s*\p{L}+)\s*\p{Pd}\s*(\d[\d.,]*\s*\p{L}+)/gu)) {
    const values = moneyAmounts(`${match[1]} - ${match[2]}`);
    if (values.length >= 2) ranges.push([values[0], values[1]]);
  }
  const ratios = [...note.matchAll(/(\d+(?:[.,]\d+)?)\s*%/gu)].map(match => Number(match[1].replace(',', '.')) / 100).filter(Number.isFinite);
  return { note, amounts: [...new Set(amounts)], ranges, ratios };
}

export function financeEvidenceForQuestion(text: string, listingPrice?: number, marketNote?: string): FinanceEvidence | null {
  const note = formatLoanScenario(text) || formatAffordability(text) || (yieldQuestionPattern.test(text) ? formatYield(text, listingPrice, marketNote) : null);
  return note ? extractFinanceEvidence(note) : null;
}

export function financeNoteForQuestion(text: string, listingPrice?: number, marketNote?: string): string | null {
  return financeEvidenceForQuestion(text, listingPrice, marketNote)?.note || null;
}
