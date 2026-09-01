export type Sale = {
  id: string;
  customerName: string;
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
export const dateLabel = (date: string | null | undefined) => date ? new Intl.DateTimeFormat('fa-IR', { month: 'long', day: 'numeric', year: 'numeric' }).format(new Date(`${date.slice(0, 10)}T12:00:00`)) : 'ثبت نشده';
export const daysUntil = (date: string) => Math.ceil((new Date(`${date.slice(0, 10)}T12:00:00`).getTime() - Date.now()) / 86400000);