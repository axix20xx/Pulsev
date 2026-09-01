export type Sale = {
  id: string;
  customerName: string;
  resellerName?: string;
  serviceName: string;
  panel: string;
  amount: number;
  date: string;
  paid: boolean;
  status: 'Completed' | 'Pending' | 'Refunded';
};

export type Service = {
  id: string;
  customerId?: string;
  customerName: string;
  username: string;
  plan: string;
  panel: string;
  status: 'Active' | 'Expiring' | 'Expired' | 'Disabled';
  expiresAt: string;
  usedGb: number;
  limitGb: number;
  note: string;
  subscriptionUrl?: string | null;
  awgReady?: boolean;
  awgConfigUrl?: string | null;
  panelUsages?: { panelKey: string; usedGb: number; rawUsedGb: number; offsetGb: number; lastUpdated: string | null }[];
  awgUsage?: { rxGb: number; txGb: number; rawTotalGb: number; usedGb: number; offsetGb: number; lastUpdated: string | null } | null;
};

export type Customer = {
  id: string;
  name: string;
  phone: string;
  email: string;
  activeServices: number;
  totalSpend: number;
  lastPurchase: string;
};

export type Panel = { name: string; location: string; status: 'Online' | 'Degraded' | 'Offline'; latency: number };
export type Activity = { id: string; type: string; title: string; detail: string; time: string };

export const initialSales: Sale[] = [
  { id: 'S-1048', customerName: 'مینا احمدی', serviceName: 'آسمان پرو', panel: 'پنل تهران ۰۱', amount: 245000, date: '2025-02-21', paid: true, status: 'Completed' },
  { id: 'S-1047', customerName: 'امیر رضایی', serviceName: 'جریان', panel: 'پنل شیراز ۰۲', amount: 165000, date: '2025-02-20', paid: true, status: 'Completed' },
  { id: 'S-1046', customerName: 'سارا کریمی', serviceName: 'آسمان پرو', panel: 'پنل تهران ۰۱', amount: 245000, date: '2025-02-20', paid: false, status: 'Pending' },
  { id: 'S-1045', customerName: 'نوید مرادی', serviceName: 'یادداشت', panel: 'پنل تبریز ۰۳', amount: 110000, date: '2025-02-19', paid: true, status: 'Completed' },
  { id: 'S-1044', customerName: 'الهام نادری', serviceName: 'آسمان پرو', panel: 'پنل شیراز ۰۲', amount: 225000, date: '2025-02-18', paid: true, status: 'Completed' },
  { id: 'S-1043', customerName: 'میلاد توکلی', serviceName: 'جریان', panel: 'پنل تهران ۰۱', amount: 165000, date: '2025-02-17', paid: true, status: 'Completed' },
  { id: 'S-1042', customerName: 'نرگس صادقی', serviceName: 'یادداشت', panel: 'پنل تبریز ۰۳', amount: 110000, date: '2025-02-16', paid: false, status: 'Pending' },
];

export const initialServices: Service[] = [
  { id: 'SV-218', customerId: 'C-01', customerName: 'مینا احمدی', username: 'mina.ahmadi', plan: 'آسمان پرو', panel: 'پنل تهران ۰۱', status: 'Active', expiresAt: '2025-03-21', usedGb: 18.4, limitGb: 40, note: 'یادآوری تمدید در سکوت ارسال شود.' },
  { id: 'SV-217', customerId: 'C-02', customerName: 'امیر رضایی', username: 'amir.rezaei', plan: 'جریان', panel: 'پنل شیراز ۰۲', status: 'Expiring', expiresAt: '2025-03-05', usedGb: 9.8, limitGb: 25, note: '' },
  { id: 'SV-216', customerId: 'C-03', customerName: 'سارا کریمی', username: 'sara.k', plan: 'آسمان پرو', panel: 'پنل تهران ۰۱', status: 'Active', expiresAt: '2025-03-27', usedGb: 31.7, limitGb: 40, note: 'دستگاه دوم در بهمن اضافه شد.' },
  { id: 'SV-215', customerId: 'C-04', customerName: 'نوید مرادی', username: 'navid.m', plan: 'یادداشت', panel: 'پنل تبریز ۰۳', status: 'Expired', expiresAt: '2025-02-10', usedGb: 6.1, limitGb: 15, note: 'برای فعال‌سازی منتظر تأیید است.' },
  { id: 'SV-214', customerId: 'C-05', customerName: 'الهام نادری', username: 'elham.n', plan: 'آسمان پرو', panel: 'پنل شیراز ۰۲', status: 'Active', expiresAt: '2025-03-18', usedGb: 12.2, limitGb: 40, note: '' },
  { id: 'SV-213', customerId: 'C-06', customerName: 'میلاد توکلی', username: 'milad.t', plan: 'جریان', panel: 'پنل تهران ۰۱', status: 'Disabled', expiresAt: '2025-04-01', usedGb: 0, limitGb: 25, note: 'به درخواست مشتری موقتاً متوقف شده است.' },
];

export const initialCustomers: Customer[] = [
  { id: 'C-01', name: 'مینا احمدی', phone: '۰۹۱۲ ۴۱۵ ۰۱۸۴', email: 'mina.ahmadi@example.ir', activeServices: 1, totalSpend: 1480000, lastPurchase: '2025-02-21' },
  { id: 'C-02', name: 'امیر رضایی', phone: '۰۹۱۰ ۵۱۰ ۰۱۲۲', email: 'amir.rezaei@example.ir', activeServices: 1, totalSpend: 960000, lastPurchase: '2025-02-20' },
  { id: 'C-03', name: 'سارا کریمی', phone: '۰۹۳۵ ۶۲۸ ۰۱۶۷', email: 'sara.karimi@example.ir', activeServices: 1, totalSpend: 1200000, lastPurchase: '2025-02-20' },
  { id: 'C-04', name: 'نوید مرادی', phone: '۰۹۱۹ ۴۱۵ ۰۱۴۳', email: 'navid.m@example.ir', activeServices: 0, totalSpend: 540000, lastPurchase: '2025-02-19' },
  { id: 'C-05', name: 'الهام نادری', phone: '۰۹۱۱ ۶۵۰ ۰۱۱۶', email: 'elham.n@example.ir', activeServices: 1, totalSpend: 1180000, lastPurchase: '2025-02-18' },
  { id: 'C-06', name: 'میلاد توکلی', phone: '۰۹۳۶ ۴۱۵ ۰۱۹۸', email: 'milad.t@example.ir', activeServices: 0, totalSpend: 720000, lastPurchase: '2025-02-17' },
  { id: 'C-07', name: 'نرگس صادقی', phone: '۰۹۱۲ ۴۰۸ ۰۱۳۸', email: 'narges.s@example.ir', activeServices: 0, totalSpend: 380000, lastPurchase: '2025-02-16' },
];

export const panels: Panel[] = [
  { name: 'پنل تهران 01', location: 'تهران، ایران', status: 'Online', latency: 42 },
  { name: 'پنل شیراز 02', location: 'شیراز، ایران', status: 'Online', latency: 68 },
  { name: 'پنل تبریز 03', location: 'تبریز، ایران', status: 'Degraded', latency: 124 },
];

export const activities: Activity[] = [
  { id: 'a1', type: 'sale', title: 'پرداخت دریافت شد', detail: 'مینا احمدی · آسمان پرو', time: '۱۲ دقیقه پیش' },
  { id: 'a2', type: 'renewal', title: 'تمدید نزدیک است', detail: 'امیر رضایی · جریان · ۱۵ اسفند', time: '۱ ساعت پیش' },
  { id: 'a3', type: 'service', title: 'سرویس متوقف شد', detail: 'میلاد توکلی · جریان', time: '۳ ساعت پیش' },
  { id: 'a4', type: 'sale', title: 'پرداخت دریافت شد', detail: 'نوید مرادی · یادداشت', time: 'دیروز' },
];

export const statusLabel = (value: string) => ({ Active: 'فعال', Expiring: 'نزدیک به انقضا', Expired: 'منقضی', Disabled: 'غیرفعال', Paid: 'پرداخت‌شده', Pending: 'در انتظار', Completed: 'تکمیل‌شده', Refunded: 'برگشت‌خورده', Online: 'آنلاین', Degraded: 'با اختلال', Offline: 'قطع' }[value] ?? value);
export const money = (amount: number) => `${new Intl.NumberFormat('fa-IR').format(Math.round(amount))} تومان`;
const tehranDate = (date: string | Date) => new Date(typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) ? `${date}T12:00:00+03:30` : date);
export const dateLabel = (date: string | null | undefined) => date ? new Intl.DateTimeFormat('fa-IR-u-ca-persian', { timeZone: 'Asia/Tehran', month: 'long', day: 'numeric', year: 'numeric' }).format(tehranDate(date)) : 'ثبت نشده';
export const dateTimeLabel = (date: string | null | undefined) => date ? new Intl.DateTimeFormat('fa-IR-u-ca-persian', { timeZone: 'Asia/Tehran', dateStyle: 'medium', timeStyle: 'short' }).format(tehranDate(date)) : 'ثبت نشده';
export const todayLabel = () => new Intl.DateTimeFormat('fa-IR-u-ca-persian', { timeZone: 'Asia/Tehran', dateStyle: 'full' }).format(new Date());
export const daysUntil = (date: string) => Math.ceil((tehranDate(date).getTime() - Date.now()) / 86400000);

const toLatinDigits = (value: string) => value.replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit))).replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)));
const toPersianDigits = (value: string) => value.replace(/\d/g, (digit) => '۰۱۲۳۴۵۶۷۸۹'[Number(digit)]);
const dateParts = (date: Date, calendar = 'gregory') => new Intl.DateTimeFormat(`en-US-u-ca-${calendar}-nu-latn`, { timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date).reduce<Record<string, string>>((parts, part) => { if (part.type !== 'literal') parts[part.type] = part.value; return parts; }, {});
export const isoToday = () => { const parts = dateParts(new Date()); return `${parts.year}-${parts.month}-${parts.day}`; };
export const isoDaysFromToday = (offset: number) => { const parts = dateParts(new Date(Date.now() + offset * 86400000)); return `${parts.year}-${parts.month}-${parts.day}`; };
export const jalaliInputValue = (iso: string) => { if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return ''; const parts = dateParts(tehranDate(iso), 'persian'); return toPersianDigits(`${parts.year}/${parts.month}/${parts.day}`); };

function jalaliToGregorian(jy: number, jm: number, jd: number): string | null {
  if (jy < 1200 || jy > 1600 || jm < 1 || jm > 12 || jd < 1 || jd > (jm <= 6 ? 31 : jm <= 11 ? 30 : 30)) return null;
  const adjustedYear = jy + 1595;
  let days = -355668 + 365 * adjustedYear + Math.floor(adjustedYear / 33) * 8 + Math.floor(((adjustedYear % 33) + 3) / 4) + jd + (jm < 7 ? (jm - 1) * 31 : (jm - 7) * 30 + 186);
  let gy = 400 * Math.floor(days / 146097);
  days %= 146097;
  if (days > 36524) { gy += 100 * Math.floor(--days / 36524); days %= 36524; if (days >= 365) days++; }
  gy += 4 * Math.floor(days / 1461);
  days %= 1461;
  if (days > 365) { gy += Math.floor((days - 1) / 365); days = (days - 1) % 365; }
  const monthDays = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const leap = gy % 4 === 0 && (gy % 100 !== 0 || gy % 400 === 0);
  if (leap) monthDays[2] = 29;
  let gm = 1;
  while (gm <= 12 && days >= monthDays[gm]) days -= monthDays[gm++];
  if (gm > 12) return null;
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${gy}-${pad(gm)}-${pad(days + 1)}`;
}
export const jalaliInputToIso = (value: string) => { const normalized = toLatinDigits(value).trim().replace(/[.-]/g, '/'); const match = normalized.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/); return match ? jalaliToGregorian(Number(match[1]), Number(match[2]), Number(match[3])) : null; };
export const isoStartOfPersianMonth = () => { const parts = dateParts(new Date(), 'persian'); return jalaliToGregorian(Number(parts.year), Number(parts.month), 1) ?? isoToday(); };