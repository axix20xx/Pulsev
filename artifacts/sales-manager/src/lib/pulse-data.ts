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
  { id: 'S-1048', customerName: 'Maya Chen', serviceName: 'Orbit Pro', panel: 'Northstar 01', amount: 24, date: '2025-02-21', paid: true, status: 'Completed' },
  { id: 'S-1047', customerName: 'Jon Bell', serviceName: 'Streamline', panel: 'Harbor 02', amount: 16, date: '2025-02-20', paid: true, status: 'Completed' },
  { id: 'S-1046', customerName: 'Priya Nair', serviceName: 'Orbit Pro', panel: 'Northstar 01', amount: 24, date: '2025-02-20', paid: false, status: 'Pending' },
  { id: 'S-1045', customerName: 'Theo Martins', serviceName: 'Field Notes', panel: 'Cedar 03', amount: 10, date: '2025-02-19', paid: true, status: 'Completed' },
  { id: 'S-1044', customerName: 'Sofia Alvarez', serviceName: 'Orbit Pro', panel: 'Harbor 02', amount: 22, date: '2025-02-18', paid: true, status: 'Completed' },
  { id: 'S-1043', customerName: 'Elias Grant', serviceName: 'Streamline', panel: 'Northstar 01', amount: 16, date: '2025-02-17', paid: true, status: 'Completed' },
  { id: 'S-1042', customerName: 'Nora Okafor', serviceName: 'Field Notes', panel: 'Cedar 03', amount: 10, date: '2025-02-16', paid: false, status: 'Pending' },
];

export const initialServices: Service[] = [
  { id: 'SV-218', customerName: 'Maya Chen', username: 'maya.chen', plan: 'Orbit Pro', panel: 'Northstar 01', status: 'Active', expiresAt: '2025-03-21', usedGb: 18.4, limitGb: 40, note: 'Prefers a quiet renewal reminder.' },
  { id: 'SV-217', customerName: 'Jon Bell', username: 'jonbell', plan: 'Streamline', panel: 'Harbor 02', status: 'Expiring', expiresAt: '2025-03-05', usedGb: 9.8, limitGb: 25, note: '' },
  { id: 'SV-216', customerName: 'Priya Nair', username: 'priya.n', plan: 'Orbit Pro', panel: 'Northstar 01', status: 'Active', expiresAt: '2025-03-27', usedGb: 31.7, limitGb: 40, note: 'Second device added in January.' },
  { id: 'SV-215', customerName: 'Theo Martins', username: 'theom', plan: 'Field Notes', panel: 'Cedar 03', status: 'Expired', expiresAt: '2025-02-10', usedGb: 6.1, limitGb: 15, note: 'Awaiting confirmation before reactivation.' },
  { id: 'SV-214', customerName: 'Sofia Alvarez', username: 'sofia.alv', plan: 'Orbit Pro', panel: 'Harbor 02', status: 'Active', expiresAt: '2025-03-18', usedGb: 12.2, limitGb: 40, note: '' },
  { id: 'SV-213', customerName: 'Elias Grant', username: 'egrant', plan: 'Streamline', panel: 'Northstar 01', status: 'Disabled', expiresAt: '2025-04-01', usedGb: 0, limitGb: 25, note: 'Temporarily paused by customer.' },
];

export const initialCustomers: Customer[] = [
  { id: 'C-01', name: 'Maya Chen', phone: '+1 415 555 0184', email: 'maya.chen@email.com', activeServices: 2, totalSpend: 148, lastPurchase: '2025-02-21' },
  { id: 'C-02', name: 'Jon Bell', phone: '+1 510 555 0122', email: 'jon.bell@email.com', activeServices: 1, totalSpend: 96, lastPurchase: '2025-02-20' },
  { id: 'C-03', name: 'Priya Nair', phone: '+1 628 555 0167', email: 'priya.nair@email.com', activeServices: 1, totalSpend: 120, lastPurchase: '2025-02-20' },
  { id: 'C-04', name: 'Theo Martins', phone: '+1 415 555 0143', email: 'theo.m@email.com', activeServices: 1, totalSpend: 54, lastPurchase: '2025-02-19' },
  { id: 'C-05', name: 'Sofia Alvarez', phone: '+1 650 555 0116', email: 'sofia.a@email.com', activeServices: 1, totalSpend: 118, lastPurchase: '2025-02-18' },
  { id: 'C-06', name: 'Elias Grant', phone: '+1 415 555 0198', email: 'elias.g@email.com', activeServices: 1, totalSpend: 72, lastPurchase: '2025-02-17' },
  { id: 'C-07', name: 'Nora Okafor', phone: '+1 408 555 0138', email: 'nora.o@email.com', activeServices: 0, totalSpend: 38, lastPurchase: '2025-02-16' },
];

export const panels: Panel[] = [
  { name: 'Northstar 01', location: 'Helsinki, FI', status: 'Online', latency: 42 },
  { name: 'Harbor 02', location: 'Newark, US', status: 'Online', latency: 68 },
  { name: 'Cedar 03', location: 'Toronto, CA', status: 'Degraded', latency: 124 },
];

export const activities: Activity[] = [
  { id: 'a1', type: 'sale', title: 'Payment received', detail: 'Maya Chen · Orbit Pro', time: '12 min ago' },
  { id: 'a2', type: 'renewal', title: 'Renewal due soon', detail: 'Jon Bell · Streamline · Mar 05', time: '1 hr ago' },
  { id: 'a3', type: 'service', title: 'Service paused', detail: 'Elias Grant · Streamline', time: '3 hrs ago' },
  { id: 'a4', type: 'sale', title: 'Payment received', detail: 'Theo Martins · Field Notes', time: 'Yesterday' },
];

export const money = (amount: number) => `$${amount.toFixed(2)}`;
export const dateLabel = (date: string) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(`${date}T12:00:00`));
export const daysUntil = (date: string) => Math.ceil((new Date(`${date}T12:00:00`).getTime() - Date.now()) / 86400000);