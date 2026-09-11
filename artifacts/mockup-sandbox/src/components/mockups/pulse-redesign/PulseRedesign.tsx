import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Activity,
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  BarChart3,
  Bell,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  ClipboardList,
  Clock3,
  Copy,
  CreditCard,
  Download,
  ExternalLink,
  FileText,
  Filter,
  Gauge,
  Headphones,
  Home,
  KeyRound,
  LayoutDashboard,
  LifeBuoy,
  Link2,
  LockKeyhole,
  LogOut,
  Menu,
  MessageSquare,
  MoreHorizontal,
  Network,
  PackageCheck,
  PanelLeftClose,
  PanelLeftOpen,
  Percent,
  PieChart,
  Plus,
  RefreshCw,
  Router,
  Search,
  Server,
  Settings,
  ShieldCheck,
  ShoppingBag,
  Smartphone,
  SlidersHorizontal,
  Sparkles,
  Ticket,
  Trash2,
  TrendingUp,
  UserRound,
  Users,
  WalletCards,
  Wifi,
  X,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import "./_group.css";

type ScreenName =
  | "customer-dashboard"
  | "subscription-list"
  | "subscription-detail"
  | "purchase-vpn"
  | "server-selection"
  | "configuration"
  | "traffic-expiration"
  | "renewal"
  | "order-history"
  | "payment"
  | "profile"
  | "notifications"
  | "support"
  | "referral"
  | "mobile-dashboard"
  | "mobile-subscription-detail"
  | "mobile-purchase"
  | "admin-dashboard"
  | "admin-customers"
  | "admin-subscriptions"
  | "admin-servers"
  | "admin-plans"
  | "admin-orders"
  | "admin-payments"
  | "admin-analytics"
  | "admin-settings";

type NavItem = { id: ScreenName; label: string; icon: LucideIcon };
type Tone = "good" | "warn" | "bad" | "info";

const customerNav: NavItem[] = [
  { id: "customer-dashboard", label: "نمای کلی", icon: LayoutDashboard },
  { id: "subscription-list", label: "اشتراک‌های من", icon: PackageCheck },
  { id: "purchase-vpn", label: "خرید اشتراک", icon: ShoppingBag },
  { id: "order-history", label: "تاریخچه سفارش‌ها", icon: ClipboardList },
  { id: "support", label: "پشتیبانی", icon: Headphones },
  { id: "referral", label: "دعوت از دوستان", icon: Link2 },
];

const adminNav: NavItem[] = [
  { id: "admin-dashboard", label: "مرکز کنترل", icon: LayoutDashboard },
  { id: "admin-customers", label: "مشتریان", icon: Users },
  { id: "admin-subscriptions", label: "اشتراک‌ها", icon: PackageCheck },
  { id: "admin-servers", label: "سرورها", icon: Server },
  { id: "admin-plans", label: "پلن‌ها و قیمت‌گذاری", icon: SlidersHorizontal },
  { id: "admin-orders", label: "سفارش‌ها", icon: ClipboardList },
  { id: "admin-payments", label: "دریافت‌ها", icon: WalletCards },
  { id: "admin-analytics", label: "گزارش‌ها", icon: BarChart3 },
  { id: "admin-settings", label: "تنظیمات پنل", icon: Settings },
];

const screenLabels: Record<ScreenName, string> = {
  "customer-dashboard": "نمای کلی",
  "subscription-list": "اشتراک‌های من",
  "subscription-detail": "جزئیات اشتراک",
  "purchase-vpn": "خرید اشتراک",
  "server-selection": "انتخاب سرور",
  configuration: "کانفیگ اتصال",
  "traffic-expiration": "وضعیت مصرف",
  renewal: "تمدید اشتراک",
  "order-history": "تاریخچه سفارش‌ها",
  payment: "پرداخت",
  profile: "حساب کاربری",
  notifications: "اعلان‌ها",
  support: "پشتیبانی",
  referral: "دعوت از دوستان",
  "mobile-dashboard": "داشبورد موبایل",
  "mobile-subscription-detail": "جزئیات اشتراک موبایل",
  "mobile-purchase": "خرید موبایل",
  "admin-dashboard": "مرکز کنترل",
  "admin-customers": "مشتریان",
  "admin-subscriptions": "اشتراک‌ها",
  "admin-servers": "سرورها",
  "admin-plans": "پلن‌ها و قیمت‌گذاری",
  "admin-orders": "سفارش‌ها",
  "admin-payments": "دریافت‌ها",
  "admin-analytics": "گزارش‌ها",
  "admin-settings": "تنظیمات پنل",
};

const isAdminScreen = (screen: ScreenName) => screen.startsWith("admin-");
const isMobileScreen = (screen: ScreenName) =>
  screen === "mobile-dashboard" ||
  screen === "mobile-subscription-detail" ||
  screen === "mobile-purchase";

function readScreen(): ScreenName {
  const candidate = new URLSearchParams(window.location.search).get("screen") as ScreenName | null;
  return candidate && screenLabels[candidate] ? candidate : "customer-dashboard";
}

function Logo({ admin = false }: { admin?: boolean }) {
  return (
    <div className="pulse-logo">
      <div className="pulse-mark">
        {admin ? <Network size={20} /> : <Activity size={21} />}
      </div>
      <div>
        <strong>Pulse</strong>
        <small>{admin ? "کنسول مدیریت همکاران" : "مرکز کنترل اتصال شما"}</small>
      </div>
    </div>
  );
}

function Status({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`pulse-status ${tone}`}>{children}</span>;
}

function IconButton({
  icon: Icon,
  label,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}) {
  return (
    <button aria-label={label} className="pulse-icon-btn" onClick={onClick}>
      <Icon size={17} />
    </button>
  );
}

function Button({
  children,
  variant = "primary",
  icon: Icon,
  onClick,
  type = "button",
}: {
  children: ReactNode;
  variant?: "primary" | "ghost" | "soft" | "danger";
  icon?: LucideIcon;
  onClick: () => void;
  type?: "button" | "submit";
}) {
  return (
    <button className={`pulse-btn ${variant}`} onClick={onClick} type={type}>
      {Icon ? <Icon size={15} /> : null}
      {children}
    </button>
  );
}

function Sidebar({
  admin,
  current,
  onNavigate,
  collapsed,
  onToggle,
}: {
  admin: boolean;
  current: ScreenName;
  onNavigate: (screen: ScreenName) => void;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const items = admin ? adminNav : customerNav;
  return (
    <aside className="pulse-sidebar">
      <Logo admin={admin} />
      <div className="pulse-nav-label">{admin ? "مدیریت عملیات" : "حساب من"}</div>
      <nav className="pulse-nav" aria-label="ناوبری اصلی">
        {items.map(({ id, label, icon: Icon }) => (
          <button
            className={current === id ? "active" : ""}
            key={id}
            onClick={() => onNavigate(id)}
            title={collapsed ? label : undefined}
          >
            <Icon size={17} />
            {!collapsed && <span>{label}</span>}
          </button>
        ))}
      </nav>
      {!admin && (
        <>
          <div className="pulse-nav-label">سریع</div>
          <nav className="pulse-nav">
            <button onClick={() => onNavigate("configuration")}>
              <Wifi size={17} />
              {!collapsed && <span>راهنمای اتصال</span>}
            </button>
            <button onClick={() => onNavigate("profile")}>
              <UserRound size={17} />
              {!collapsed && <span>پروفایل</span>}
            </button>
          </nav>
        </>
      )}
      <div className="pulse-side-foot">
        <strong>{admin ? "فضای نمایندگی آریا" : "پلن حرفه‌ای فعال"}</strong>
        <span>{admin ? "آخرین همگام‌سازی: ۲ دقیقه پیش" : "پشتیبانی پاسخ‌گوست"}</span>
      </div>
      <button className="pulse-nav" style={{ marginTop: 14 }} onClick={onToggle}>
        <span className="pulse-nav button" style={{ display: "flex" }}>
          {collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
          {!collapsed && <span>جمع کردن منو</span>}
        </span>
      </button>
    </aside>
  );
}

function Topbar({
  admin,
  onNavigate,
  onNotice,
}: {
  admin: boolean;
  onNavigate: (screen: ScreenName) => void;
  onNotice: (message: string) => void;
}) {
  return (
    <header className="pulse-topbar">
      <div className="pulse-breadcrumb">
        <span>{admin ? "کنسول مدیریت" : "حساب کاربری"}</span>
        <ChevronLeft size={13} />
        <strong>{admin ? "Pulse Admin" : "Pulse"}</strong>
      </div>
      <div className="pulse-top-actions">
        <IconButton icon={Search} label="جست‌وجو" onClick={() => onNotice("جست‌وجوی سریع آماده است")} />
        <IconButton
          icon={Bell}
          label="اعلان‌ها"
          onClick={() => onNavigate("notifications")}
        />
        <div className="pulse-user">
          <div className="pulse-avatar">{admin ? "م" : "ن"}</div>
          <div>
            <span>{admin ? "مریم احمدی" : "نیما رضایی"}</span>
            <small>{admin ? "مدیر نمایندگی" : "حساب شخصی"}</small>
          </div>
        </div>
      </div>
    </header>
  );
}

function MobileNav({
  current,
  onNavigate,
}: {
  current: ScreenName;
  onNavigate: (screen: ScreenName) => void;
}) {
  const items: NavItem[] = [
    { id: "mobile-dashboard", label: "خانه", icon: Home },
    { id: "subscription-list", label: "اشتراک‌ها", icon: PackageCheck },
    { id: "purchase-vpn", label: "خرید", icon: Plus },
    { id: "support", label: "پشتیبانی", icon: Headphones },
    { id: "profile", label: "پروفایل", icon: UserRound },
  ];
  return (
    <nav className="pulse-mobile-nav" aria-label="ناوبری موبایل">
      {items.map(({ id, label, icon: Icon }) => (
        <button
          className={current === id || (id === "mobile-dashboard" && current === "customer-dashboard") ? "active" : ""}
          key={id}
          onClick={() => onNavigate(id)}
        >
          <Icon />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}

function Shell({
  screen,
  children,
  onNavigate,
  onNotice,
}: {
  screen: ScreenName;
  children: ReactNode;
  onNavigate: (screen: ScreenName) => void;
  onNotice: (message: string) => void;
}) {
  const admin = isAdminScreen(screen);
  const mobile = isMobileScreen(screen);
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div className={`pulse-app ${admin ? "pulse-admin" : ""} ${mobile ? "pulse-mobile-dashboard" : ""}`}>
      <div className="pulse-shell">
        <Sidebar
          admin={admin}
          current={screen}
          onNavigate={onNavigate}
          collapsed={collapsed}
          onToggle={() => setCollapsed((value) => !value)}
        />
        <div className="pulse-workspace">
          <Topbar admin={admin} onNavigate={onNavigate} onNotice={onNotice} />
          <main className="pulse-main">{children}</main>
        </div>
      </div>
      {!admin && <MobileNav current={screen} onNavigate={onNavigate} />}
    </div>
  );
}

function Heading({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle: string;
  actions?: ReactNode;
}) {
  return (
    <div className="pulse-heading">
      <div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      {actions ? <div className="pulse-heading-actions">{actions}</div> : null}
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  note,
  tone = "blue",
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  note: string;
  tone?: "blue" | "cyan" | "orange" | "green";
}) {
  return (
    <article className="pulse-card pulse-stat">
      <div className={`pulse-stat-icon ${tone}`}><Icon size={17} /></div>
      <span className="pulse-eyebrow">{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </article>
  );
}

function UsageCard({ compact = false }: { compact?: boolean }) {
  return (
    <article className={`pulse-card ${compact ? "compact" : ""}`}>
      <div className="pulse-card-title">
        <div>
          <h2>مصرف اینترنت</h2>
          <p>اشتراک حرفه‌ای • تا ۲۶ اردیبهشت ۱۴۰۴</p>
        </div>
        <Status tone="good">فعال</Status>
      </div>
      <div className="pulse-meter-row"><span>مصرف‌شده</span><strong>۱۸.۴ GB از ۵۰ GB</strong></div>
      <div className="pulse-meter"><span style={{ width: "37%" }} /></div>
      <div className="pulse-card-footer">
        <span className="pulse-eyebrow">۳۱.۶ گیگابایت باقی‌مانده</span>
        <button className="pulse-btn ghost" onClick={() => undefined}>جزئیات <ArrowLeft size={14} /></button>
      </div>
    </article>
  );
}

function ChartCard({ admin = false }: { admin?: boolean }) {
  return (
    <article className="pulse-card">
      <div className="pulse-card-title">
        <div>
          <h2>{admin ? "درآمد ماهانه" : "مصرف در ۷ روز اخیر"}</h2>
          <p>{admin ? "مقایسه دریافت خالص با ماه قبل" : "مجموع دانلود و آپلود حساب شما"}</p>
        </div>
        <button className="pulse-icon-btn" aria-label="فیلتر بازه" onClick={() => undefined}><MoreHorizontal size={17} /></button>
      </div>
      <div className="pulse-chart">
        <div className="pulse-chart-grid"><span /><span /><span /><span /></div>
        <div className="pulse-spark">
          <svg viewBox="0 0 600 160" preserveAspectRatio="none" aria-label="نمودار روند">
            <defs>
              <linearGradient id={admin ? "adminFill" : "customerFill"} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#18b7c9" stopOpacity=".24" />
                <stop offset="100%" stopColor="#18b7c9" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path d="M0 126 C40 119 58 130 92 97 S145 102 176 83 S220 100 255 73 S300 83 330 56 S370 80 410 43 S460 63 493 32 S550 45 600 22 V160 H0 Z" fill={`url(#${admin ? "adminFill" : "customerFill"})`} />
            <path d="M0 126 C40 119 58 130 92 97 S145 102 176 83 S220 100 255 73 S300 83 330 56 S370 80 410 43 S460 63 493 32 S550 45 600 22" fill="none" stroke="#0d78df" strokeWidth="3" />
          </svg>
        </div>
        <div className="pulse-chart-labels"><span>شنبه</span><span>یکشنبه</span><span>دوشنبه</span><span>سه‌شنبه</span><span>امروز</span></div>
      </div>
      <div className="pulse-legend">
        <span><i /> دانلود ۱۲.۸ GB</span>
        <span><i className="cyan" /> آپلود ۵.۶ GB</span>
      </div>
    </article>
  );
}

function CustomerDashboard({ go, notice }: { go: (screen: ScreenName) => void; notice: (message: string) => void }) {
  return (
    <>
      <Heading
        title="صبح بخیر، نیما"
        subtitle="وضعیت اتصال و اشتراک‌های شما، یک‌جا و بدون پیچیدگی."
        actions={
          <>
            <Button variant="ghost" icon={RefreshCw} onClick={() => notice("اطلاعات با موفقیت به‌روز شد")}>به‌روزرسانی</Button>
            <Button icon={Plus} onClick={() => go("purchase-vpn")}>خرید اشتراک</Button>
          </>
        }
      />
      <div className="pulse-banner">
        <div>
          <strong>اتصال شما پایدار است</strong>
          <p>سرور فرانکفورت با تأخیر ۴۲ میلی‌ثانیه در دسترس است.</p>
        </div>
        <Status tone="good">متصل</Status>
      </div>
      <section className="pulse-grid stats">
        <StatCard icon={Gauge} label="اشتراک فعال" value="۱" note="تا ۲۶ اردیبهشت ۱۴۰۴" />
        <StatCard icon={Wifi} label="مصرف این ماه" value="۱۸.۴ GB" note="۳۷٪ از سهمیه استفاده شده" tone="cyan" />
        <StatCard icon={Clock3} label="روزهای باقی‌مانده" value="۲۳ روز" note="نیاز به اقدام فوری نیست" tone="orange" />
        <StatCard icon={Server} label="سرور فعلی" value="فرانکفورت" note="پینگ ۴۲ms • وضعیت عالی" tone="green" />
      </section>
      <div className="pulse-grid two" style={{ marginTop: 16 }}>
        <ChartCard />
        <UsageCard />
      </div>
      <div className="pulse-grid two" style={{ marginTop: 16 }}>
        <article className="pulse-card">
          <div className="pulse-card-title"><div><h2>فعالیت اخیر</h2><p>رویدادهای مهم حساب شما</p></div><ArrowLeft size={16} /></div>
          <div className="pulse-activity">
            <div className="pulse-activity-item"><span className="pulse-activity-dot" /><div><strong>کانفیگ جدید ساخته شد</strong><small>فرانکفورت • ۱۸ دقیقه پیش</small></div></div>
            <div className="pulse-activity-item"><span className="pulse-activity-dot" /><div><strong>پرداخت تمدید ثبت شد</strong><small>رسید #PL-29841 • دیروز</small></div></div>
            <div className="pulse-activity-item"><span className="pulse-activity-dot" /><div><strong>ورود از دستگاه جدید</strong><small>Chrome روی macOS • ۲ روز پیش</small></div></div>
          </div>
        </article>
        <article className="pulse-card">
          <div className="pulse-card-title"><div><h2>میانبرهای کاربردی</h2><p>برای شروع سریع</p></div><Sparkles size={16} /></div>
          <div style={{ display: "grid", gap: 9 }}>
            <Button variant="soft" icon={Router} onClick={() => go("configuration")}>دریافت کانفیگ اتصال</Button>
            <Button variant="ghost" icon={RefreshCw} onClick={() => go("renewal")}>تمدید اشتراک فعلی</Button>
            <Button variant="ghost" icon={Headphones} onClick={() => go("support")}>گفت‌وگو با پشتیبانی</Button>
          </div>
        </article>
      </div>
    </>
  );
}

function SubscriptionList({ go }: { go: (screen: ScreenName) => void }) {
  const [tab, setTab] = useState("همه");
  return (
    <>
      <Heading title="اشتراک‌های من" subtitle="مدیریت وضعیت، مصرف و دسترسی‌های فعال شما." actions={<Button icon={Plus} onClick={() => go("purchase-vpn")}>اشتراک جدید</Button>} />
      <div className="pulse-filterbar">
        <div className="pulse-tabs">
          {["همه", "فعال", "منقضی‌شده"].map((item) => <button className={tab === item ? "active" : ""} key={item} onClick={() => setTab(item)}>{item}</button>)}
        </div>
        <span className="pulse-eyebrow">۲ اشتراک در حساب شما</span>
      </div>
      <div className="pulse-grid two">
        <article className="pulse-card pulse-subscription featured">
          <div className="pulse-subscription-head"><div><h3>پلن حرفه‌ای</h3><span className="meta">شناسه PL-8842 • یک دستگاه</span></div><Status tone="good">فعال</Status></div>
          <div className="pulse-meter-row"><span>ترافیک مصرفی</span><strong>۱۸.۴ / ۵۰ GB</strong></div><div className="pulse-meter"><span style={{ width: "37%" }} /></div>
          <div className="pulse-kv" style={{ marginTop: 17 }}><div><span>انقضا</span><strong>۲۶ اردیبهشت</strong></div><div><span>سرور</span><strong>فرانکفورت</strong></div></div>
          <div className="pulse-card-footer"><span className="pulse-eyebrow">۲۳ روز باقی‌مانده</span><Button icon={ArrowLeft} onClick={() => go("subscription-detail")}>مشاهده جزئیات</Button></div>
        </article>
        <article className="pulse-card pulse-subscription">
          <div className="pulse-subscription-head"><div><h3>پلن پایه</h3><span className="meta">شناسه PL-7610 • سه دستگاه</span></div><Status tone="bad">منقضی</Status></div>
          <div className="pulse-callout"><AlertCircle size={16} /><span>این اشتراک در ۲۸ فروردین منقضی شده است.</span></div>
          <div className="pulse-kv" style={{ marginTop: 17 }}><div><span>ترافیک استفاده‌شده</span><strong>۲۲ / ۲۵ GB</strong></div><div><span>آخرین اتصال</span><strong>۱۲ روز پیش</strong></div></div>
          <div className="pulse-card-footer"><span className="pulse-eyebrow">قابل تمدید</span><Button variant="soft" icon={RefreshCw} onClick={() => go("renewal")}>تمدید پلن</Button></div>
        </article>
      </div>
      {tab === "فعال" ? <div className="pulse-banner" style={{ marginTop: 16 }}><div><strong>یک اشتراک فعال پیدا شد</strong><p>جزئیات پلن حرفه‌ای در بالا نمایش داده شده است.</p></div><CheckCircle2 size={19} /></div> : null}
    </>
  );
}

function SubscriptionDetail({ go, mobile = false }: { go: (screen: ScreenName) => void; mobile?: boolean }) {
  return (
    <>
      <div className="pulse-detail-hero">
        <div className="pulse-detail-id"><div className="pulse-plan-icon"><ShieldCheck size={24} /></div><div><h1>پلن حرفه‌ای</h1><p>شناسه اشتراک: PL-8842 • آخرین بروزرسانی: همین حالا</p></div></div>
        <div className="pulse-heading-actions"><Status tone="good">فعال و امن</Status><Button variant="ghost" icon={RefreshCw} onClick={() => undefined}>به‌روزرسانی</Button></div>
      </div>
      <div className="pulse-grid stats">
        <StatCard icon={Gauge} label="ترافیک باقی‌مانده" value="۳۱.۶ GB" note="از ۵۰ گیگابایت کل" />
        <StatCard icon={Clock3} label="اعتبار باقی‌مانده" value="۲۳ روز" note="انقضا در ۲۶ اردیبهشت" tone="orange" />
        <StatCard icon={Server} label="سرور متصل" value="فرانکفورت" note="پینگ پایدار ۴۲ms" tone="green" />
        <StatCard icon={Smartphone} label="دستگاه‌ها" value="۱ از ۳" note="۲ ظرفیت خالی" tone="cyan" />
      </div>
      <div className="pulse-grid two" style={{ marginTop: 16 }}>
        <UsageCard compact={mobile} />
        <article className="pulse-card">
          <div className="pulse-card-title"><div><h2>اقدام‌های سریع</h2><p>مدیریت همین اشتراک</p></div><MoreHorizontal size={16} /></div>
          <div style={{ display: "grid", gap: 9 }}>
            <Button icon={Router} onClick={() => go("configuration")}>مشاهده کانفیگ اتصال</Button>
            <Button variant="ghost" icon={RefreshCw} onClick={() => go("renewal")}>تمدید اشتراک</Button>
            <Button variant="ghost" icon={Server} onClick={() => go("server-selection")}>تغییر سرور</Button>
          </div>
        </article>
      </div>
      <div style={{ marginTop: 16 }}><ChartCard /></div>
    </>
  );
}

function PurchaseVpn({ go, mobile = false }: { go: (screen: ScreenName) => void; mobile?: boolean }) {
  const [step, setStep] = useState(1);
  const steps = ["انتخاب پلن", "انتخاب سرور", "پرداخت"];
  return (
    <>
      <Heading title="خرید اشتراک" subtitle="در کمتر از دو دقیقه، اتصال امن خود را فعال کنید." />
      <div className="pulse-stepper">{steps.map((item, index) => <div className={`pulse-step ${index + 1 === step ? "current" : ""} ${index + 1 < step ? "done" : ""}`} key={item}><span className="pulse-step-num">{index + 1 < step ? <Check size={13} /> : index + 1}</span>{item}</div>)}</div>
      {step === 1 && <div className={`pulse-grid three ${mobile ? "pulse-mobile-only" : ""}`}>
        <PlanCard title="پایه" price="۱۸۹٬۰۰۰" traffic="۲۵ گیگابایت" devices="۳ دستگاه" onClick={() => setStep(2)} />
        <PlanCard title="حرفه‌ای" price="۳۴۹٬۰۰۰" traffic="۵۰ گیگابایت" devices="۵ دستگاه" featured onClick={() => setStep(2)} />
        <PlanCard title="تیمی" price="۷۹۰٬۰۰۰" traffic="۱۵۰ گیگابایت" devices="۱۲ دستگاه" onClick={() => setStep(2)} />
      </div>}
      {step === 2 && <ServerSelection embedded onBack={() => setStep(1)} onNext={() => setStep(3)} />}
      {step === 3 && <Payment embedded onBack={() => setStep(2)} onDone={() => go("configuration")} />}
      {step === 1 && <div className="pulse-banner" style={{ marginTop: 18 }}><div><strong>همه پلن‌ها شامل پشتیبانی فارسی هستند</strong><p>بدون قرارداد بلندمدت؛ هر زمان خواستید لغو یا تمدید کنید.</p></div><ShieldCheck size={19} /></div>}
    </>
  );
}

function PlanCard({ title, price, traffic, devices, featured = false, onClick }: { title: string; price: string; traffic: string; devices: string; featured?: boolean; onClick: () => void }) {
  return (
    <article className={`pulse-card pulse-subscription ${featured ? "featured" : ""}`}>
      <div className="pulse-subscription-head"><div><h3>{title}</h3><span className="meta">اتصال پایدار و رمزگذاری‌شده</span></div>{featured ? <Status tone="info">پیشنهاد ما</Status> : <Wifi size={19} />}</div>
      <div className="pulse-price">{price} <small>تومان / ماه</small></div>
      <ul className="pulse-list"><li><Check size={14} /> {traffic} ترافیک</li><li><Check size={14} /> {devices}</li><li><Check size={14} /> پشتیبانی در تمام روزها</li></ul>
      <div className="pulse-card-footer"><span className="pulse-eyebrow">فعال‌سازی فوری</span><Button onClick={onClick}>انتخاب پلن <ArrowLeft size={14} /></Button></div>
    </article>
  );
}

function ServerSelection({ embedded = false, onBack, onNext, go }: { embedded?: boolean; onBack?: () => void; onNext?: () => void; go?: (screen: ScreenName) => void }) {
  const [server, setServer] = useState("آلمان");
  const servers = [
    { city: "آلمان", location: "فرانکفورت", ping: "۴۲ms", load: "۳۴٪", tone: "good" as Tone },
    { city: "هلند", location: "آمستردام", ping: "۵۸ms", load: "۵۱٪", tone: "good" as Tone },
    { city: "ترکیه", location: "استانبول", ping: "۷۳ms", load: "۶۸٪", tone: "warn" as Tone },
    { city: "فنلاند", location: "هلسینکی", ping: "۸۵ms", load: "۲۲٪", tone: "good" as Tone },
  ];
  return (
    <div>
      {!embedded && <Heading title="انتخاب سرور" subtitle="نزدیک‌ترین مسیر را بر اساس پینگ و ظرفیت انتخاب کنید." />}
      <div className="pulse-grid two">
        <article className="pulse-card"><div className="pulse-card-title"><div><h2>موقعیت‌های پیشنهادی</h2><p>وضعیت لحظه‌ای ظرفیت سرورها</p></div><Button variant="ghost" icon={RefreshCw} onClick={() => undefined}>به‌روزرسانی</Button></div>
          <div style={{ display: "grid", gap: 9 }}>{servers.map((item) => <button key={item.city} className={`pulse-radio ${server === item.city ? "selected" : ""}`} onClick={() => setServer(item.city)} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", textAlign: "right", cursor: "pointer" }}><span style={{ display: "flex", alignItems: "center", gap: 10 }}><span className="pulse-plan-icon" style={{ width: 34, height: 34 }}><Server size={16} /></span><span><strong>{item.city} <span style={{ color: "var(--pulse-muted)", fontWeight: 400 }}>• {item.location}</span></strong><small>پینگ {item.ping} • ظرفیت مصرفی {item.load}</small></span></span><Status tone={item.tone}>{item.tone === "warn" ? "پرترافیک" : "مناسب"}</Status></button>)}</div>
          <div className="pulse-card-footer"><span className="pulse-eyebrow">انتخاب فعلی: {server}</span>{embedded ? <span style={{ display: "flex", gap: 8 }}>{onBack && <Button variant="ghost" onClick={onBack}>مرحله قبل</Button>}{onNext && <Button onClick={onNext}>ادامه پرداخت <ArrowLeft size={14} /></Button>}</span> : <Button onClick={() => go?.("configuration")}>اعمال سرور</Button>}</div>
        </article>
        <article className="pulse-card"><div className="pulse-card-title"><div><h2>راهنمای انتخاب</h2><p>برای تجربه بهتر</p></div><CircleHelp size={18} /></div><div className="pulse-callout"><Zap size={16} /><span>پینگ پایین‌تر برای تماس تصویری و بازی بهتر است. ظرفیت زیر ۶۰٪ را اولویت دهید.</span></div><div style={{ marginTop: 16 }}><div className="pulse-meter-row"><span>آلمان • بهترین انتخاب</span><strong>۳۴٪</strong></div><div className="pulse-meter"><span style={{ width: "34%" }} /></div></div></article>
      </div>
    </div>
  );
}

function Configuration({ notice }: { notice: (message: string) => void }) {
  const [copied, setCopied] = useState(false);
  const copy = () => { setCopied(true); notice("کانفیگ در کلیپ‌بورد کپی شد"); window.setTimeout(() => setCopied(false), 1800); };
  return (
    <>
      <Heading title="کانفیگ اتصال" subtitle="از این اطلاعات برای فعال‌سازی Pulse روی دستگاه خود استفاده کنید." actions={<Button variant="ghost" icon={Download} onClick={() => notice("فایل کانفیگ دانلود شد")}>دانلود فایل</Button>} />
      <div className="pulse-banner"><div><strong>کانفیگ شما آماده است</strong><p>این اطلاعات خصوصی است؛ آن را با دیگران به اشتراک نگذارید.</p></div><Status tone="good">رمزگذاری‌شده</Status></div>
      <div className="pulse-grid two">
        <article className="pulse-card"><div className="pulse-card-title"><div><h2>اتصال سریع با QR</h2><p>اپ Pulse را باز کنید و کد را اسکن کنید.</p></div><Smartphone size={18} /></div><div className="pulse-config"><div className="pulse-qr" role="img" aria-label="QR کد آزمایشی"><span /></div><div><h3 style={{ margin: "0 0 6px", fontSize: ".86rem" }}>پلن حرفه‌ای • فرانکفورت</h3><p className="pulse-eyebrow">ساخته‌شده در ۲۲ اردیبهشت ۱۴۰۴</p><Button variant="soft" icon={Copy} onClick={copy}>{copied ? "کپی شد" : "کپی QR کد"}</Button></div></div></article>
        <article className="pulse-card"><div className="pulse-card-title"><div><h2>جزئیات دستی</h2><p>برای کلاینت‌های سازگار با WireGuard</p></div><LockKeyhole size={18} /></div><div style={{ display: "grid", gap: 10 }}><div className="pulse-kv"><div><span>آدرس سرور</span><strong>de-fra-03.pulse.ir</strong></div><div><span>پورت اتصال</span><strong>۵۱۸۲۰</strong></div></div><div className="pulse-code"><span>pulse://de-fra-03/PL-8842</span><button onClick={copy} aria-label="کپی لینک"><Copy size={15} /></button></div></div></article>
      </div>
      <article className="pulse-card" style={{ marginTop: 16 }}><div className="pulse-card-title"><div><h2>راهنمای دستگاه‌ها</h2><p>برای هر سیستم‌عامل مراحل کوتاه و روشن</p></div><ArrowLeft size={16} /></div><div className="pulse-grid three"><Button variant="ghost" icon={Smartphone} onClick={() => notice("راهنمای اندروید باز شد")}>اندروید</Button><Button variant="ghost" icon={Smartphone} onClick={() => notice("راهنمای iOS باز شد")}>iPhone و iPad</Button><Button variant="ghost" icon={Router} onClick={() => notice("راهنمای دسکتاپ باز شد")}>ویندوز و macOS</Button></div></article>
    </>
  );
}

function TrafficExpiration({ go }: { go: (screen: ScreenName) => void }) {
  return (
    <>
      <Heading title="وضعیت مصرف و انقضا" subtitle="قبل از تمام‌شدن ترافیک یا اعتبار، تصمیم مناسب را بگیرید." />
      <div className="pulse-card pulse-notice"><div className="pulse-card-title"><div><h2>ترافیک شما رو به پایان است</h2><p>با تمدید به‌موقع، اتصال‌تان قطع نمی‌شود.</p></div><Status tone="warn">نیازمند توجه</Status></div><div className="pulse-meter-row"><span>باقی‌مانده</span><strong>۳.۲ GB از ۵۰ GB</strong></div><div className="pulse-meter warn"><span style={{ width: "94%" }} /></div><div className="pulse-card-footer"><span className="pulse-eyebrow">اعتبار زمانی: ۲۳ روز</span><Button icon={RefreshCw} onClick={() => go("renewal")}>افزایش ترافیک</Button></div></div>
      <div className="pulse-grid two" style={{ marginTop: 16 }}><ChartCard /><article className="pulse-card"><div className="pulse-card-title"><div><h2>سناریوهای پیشنهادی</h2><p>بر اساس الگوی مصرف شما</p></div><Gauge size={17} /></div><div style={{ display: "grid", gap: 10 }}><div className="pulse-callout"><AlertCircle size={16} /><span>اگر روزانه حدود ۱۲۰ مگابایت مصرف دارید، ۲۶ روز دیگر به پایان می‌رسد.</span></div><Button variant="soft" icon={ShoppingBag} onClick={() => go("purchase-vpn")}>خرید ترافیک اضافه</Button><Button variant="ghost" icon={RefreshCw} onClick={() => go("renewal")}>تمدید و شارژ هم‌زمان</Button></div></article></div>
    </>
  );
}

function Renewal({ go }: { go: (screen: ScreenName) => void }) {
  const [selected, setSelected] = useState("یک ماه");
  return (
    <>
      <Heading title="تمدید اشتراک" subtitle="پلن فعلی را نگه دارید و فقط مدت اعتبار را انتخاب کنید." />
      <div className="pulse-grid two"><article className="pulse-card"><div className="pulse-card-title"><div><h2>پلن حرفه‌ای</h2><p>۵۰ گیگابایت • ۵ دستگاه • فرانکفورت</p></div><Status tone="good">فعال</Status></div><div className="pulse-kv"><div><span>قیمت فعلی</span><strong>۳۴۹٬۰۰۰ تومان</strong></div><div><span>انقضای فعلی</span><strong>۲۶ اردیبهشت</strong></div></div><div style={{ marginTop: 18 }}><span className="pulse-eyebrow">مدت تمدید را انتخاب کنید</span><div className="pulse-radio-grid" style={{ marginTop: 8 }}>{["یک ماه", "سه ماه", "شش ماه"].map((item) => <button className={`pulse-radio ${selected === item ? "selected" : ""}`} key={item} onClick={() => setSelected(item)}><strong>{item}</strong><small>{item === "یک ماه" ? "۳۴۹٬۰۰۰ تومان" : item === "سه ماه" ? "۹۴۲٬۰۰۰ تومان" : "۱٬۶۹۰٬۰۰۰ تومان"}</small></button>)}</div></div><div className="pulse-card-footer"><span className="pulse-eyebrow">انتخاب شما: {selected}</span><Button icon={CreditCard} onClick={() => go("payment")}>ادامه پرداخت</Button></div></article><article className="pulse-card"><div className="pulse-card-title"><div><h2>مزایای تمدید</h2><p>بدون تغییر در کانفیگ فعلی</p></div><CheckCircle2 size={18} /></div><ul className="pulse-list"><li><Check size={14} /> حفظ سرور و آدرس فعلی</li><li><Check size={14} /> انتقال خودکار روزهای باقی‌مانده</li><li><Check size={14} /> فعال‌شدن بلافاصله بعد از پرداخت</li></ul><div className="pulse-callout" style={{ marginTop: 19 }}><Sparkles size={16} /><span>با تمدید سه‌ماهه، ۱۰٪ تخفیف به‌صورت خودکار اعمال می‌شود.</span></div></article></div>
    </>
  );
}

function OrderHistory() {
  const rows = [
    ["PL-29841", "تمدید پلن حرفه‌ای", "۳۴۹٬۰۰۰ تومان", "۲۲ اردیبهشت ۱۴۰۴", "موفق", "good"],
    ["PL-29214", "خرید پلن پایه", "۱۸۹٬۰۰۰ تومان", "۲۸ فروردین ۱۴۰۴", "موفق", "good"],
    ["PL-28730", "افزایش ترافیک", "۱۲۰٬۰۰۰ تومان", "۱۴ فروردین ۱۴۰۴", "در انتظار", "warn"],
    ["PL-27984", "خرید پلن حرفه‌ای", "۳۴۹٬۰۰۰ تومان", "۲۵ اسفند ۱۴۰۳", "موفق", "good"],
  ] as const;
  return <><Heading title="تاریخچه سفارش‌ها" subtitle="رسیدها و وضعیت پرداخت‌های قبلی حساب شما." actions={<Button variant="ghost" icon={Download} onClick={() => undefined}>خروجی اکسل</Button>} /><div className="pulse-filterbar"><div className="pulse-search"><Search size={15} /><input placeholder="جست‌وجو در سفارش‌ها" /></div><Button variant="ghost" icon={Filter} onClick={() => undefined}>فیلتر تاریخ</Button></div><div className="pulse-table-wrap"><table className="pulse-table"><thead><tr><th>شناسه</th><th>شرح</th><th>مبلغ</th><th>تاریخ</th><th>وضعیت</th><th /></tr></thead><tbody>{rows.map((row) => <tr key={row[0]}><td className="mono">{row[0]}</td><td><strong>{row[1]}</strong></td><td className="mono">{row[2]}</td><td>{row[3]}</td><td><Status tone={row[5] as Tone}>{row[4]}</Status></td><td><button className="pulse-icon-btn" onClick={() => undefined} aria-label="مشاهده رسید"><ExternalLink size={15} /></button></td></tr>)}</tbody></table></div></>;
}

function Payment({ embedded = false, onBack, onDone }: { embedded?: boolean; onBack?: () => void; onDone?: () => void }) {
  const [method, setMethod] = useState("درگاه بانکی");
  const [success, setSuccess] = useState(false);
  if (success) return <div className="pulse-empty"><CheckCircle2 size={38} /><strong>پرداخت با موفقیت ثبت شد</strong><p>اشتراک شما آماده استفاده است. کانفیگ اتصال را دریافت کنید.</p><Button icon={Router} onClick={() => onDone?.()}>دریافت کانفیگ</Button></div>;
  return <div className={embedded ? "" : "pulse-grid two"}>{!embedded && <Heading title="پرداخت" subtitle="اطلاعات پرداخت شما در محیط امن بانکی پردازش می‌شود." />}{!embedded ? <div className="pulse-card"><div className="pulse-card-title"><div><h2>روش پرداخت</h2><p>یک روش امن را انتخاب کنید</p></div><LockKeyhole size={18} /></div><div className="pulse-radio-grid">{["درگاه بانکی", "کیف پول Pulse", "کارت ذخیره‌شده"].map((item) => <button className={`pulse-radio ${method === item ? "selected" : ""}`} key={item} onClick={() => setMethod(item)}><strong>{item}</strong><small>{item === "درگاه بانکی" ? "پرداخت شتابی" : item === "کیف پول Pulse" ? "موجودی: ۲۸۰٬۰۰۰" : "**** ۴۲۱۷"}</small></button>)}</div><div className="pulse-form-grid" style={{ marginTop: 16 }}><div className="pulse-field"><label>ایمیل رسید</label><input defaultValue="nima.r@example.com" /></div><div className="pulse-field"><label>کد تخفیف</label><input placeholder="اختیاری" /></div></div><div className="pulse-card-footer">{onBack && <Button variant="ghost" onClick={onBack}>مرحله قبل</Button>}<Button icon={LockKeyhole} onClick={() => setSuccess(true)}>پرداخت ۳۴۹٬۰۰۰ تومان</Button></div></div> : <div className="pulse-card"><div className="pulse-card-title"><div><h2>پرداخت امن</h2><p>پلن حرفه‌ای • یک ماه</p></div><LockKeyhole size={18} /></div><div className="pulse-callout"><ShieldCheck size={16} /><span>اطلاعات کارت خارج از Pulse ذخیره نمی‌شود.</span></div><div className="pulse-card-footer">{onBack && <Button variant="ghost" onClick={onBack}>مرحله قبل</Button>}<Button onClick={() => setSuccess(true)}>پرداخت و فعال‌سازی</Button></div></div>}</div>;
}

function Profile({ notice }: { notice: (message: string) => void }) {
  const [saved, setSaved] = useState(false);
  return <><Heading title="پروفایل و امنیت" subtitle="اطلاعات تماس و تنظیمات دسترسی حساب شما." actions={<Button icon={Check} onClick={() => { setSaved(true); notice("تغییرات ذخیره شد"); }}>ذخیره تغییرات</Button>} /><div className="pulse-grid two"><article className="pulse-card"><div className="pulse-card-title"><div><h2>اطلاعات شخصی</h2><p>این اطلاعات برای رسیدها استفاده می‌شود.</p></div><UserRound size={18} /></div><div className="pulse-form-grid"><div className="pulse-field"><label>نام و نام خانوادگی</label><input defaultValue="نیما رضایی" /></div><div className="pulse-field"><label>شماره موبایل</label><input defaultValue="۰۹۱۲ ۴۸۲ ۷۳۱۰" /></div><div className="pulse-field"><label>ایمیل</label><input defaultValue="nima.r@example.com" /></div><div className="pulse-field"><label>منطقه زمانی</label><select defaultValue="تهران"><option>تهران (GMT+3:30)</option><option>استانبول (GMT+3)</option></select></div></div>{saved && <div className="pulse-banner" style={{ marginTop: 15, marginBottom: 0 }}><div><strong>اطلاعات به‌روز است</strong><p>آخرین ذخیره‌سازی همین حالا انجام شد.</p></div><CheckCircle2 size={17} /></div>}</article><article className="pulse-card"><div className="pulse-card-title"><div><h2>امنیت ورود</h2><p>کنترل دسترسی به حساب Pulse</p></div><LockKeyhole size={18} /></div><div className="pulse-toggle"><div><strong>تأیید دومرحله‌ای</strong><small>ورود با کد یک‌بارمصرف</small></div><button className="pulse-switch on" aria-label="تأیید دومرحله‌ای فعال" onClick={() => notice("تنظیم امنیتی تغییر کرد")} /></div><div className="pulse-toggle"><div><strong>اعلان ورود جدید</strong><small>اطلاع‌رسانی برای دستگاه تازه</small></div><button className="pulse-switch on" aria-label="اعلان ورود فعال" onClick={() => notice("تنظیم اعلان تغییر کرد")} /></div><div className="pulse-card-footer"><span className="pulse-eyebrow">آخرین ورود: امروز، ۱۰:۴۸</span><Button variant="danger" icon={LogOut} onClick={() => notice("از نشست‌های دیگر خارج شدید")}>خروج از دستگاه‌ها</Button></div></article></div></>;
}

function Notifications({ notice }: { notice: (message: string) => void }) {
  const [unread, setUnread] = useState(2);
  const items = [{ title: "اتصال شما دوباره برقرار شد", text: "سرور فرانکفورت در دسترس است.", time: "۱۸ دقیقه پیش", tone: "good" as Tone }, { title: "ترافیک شما از ۷۰٪ عبور کرد", text: "۳۱.۶ گیگابایت از سهمیه باقی مانده است.", time: "دیروز", tone: "warn" as Tone }, { title: "پرداخت شما تأیید شد", text: "رسید سفارش PL-29841 آماده دانلود است.", time: "۲ روز پیش", tone: "info" as Tone }];
  return <><Heading title="اعلان‌ها" subtitle="خبرهای مهم اتصال و حساب شما." actions={<Button variant="ghost" icon={Check} onClick={() => { setUnread(0); notice("همه اعلان‌ها خوانده شدند"); }}>خواندن همه</Button>} /><div className="pulse-card">{items.map((item, index) => <div className="pulse-ticket" key={item.title} style={{ opacity: index > 1 ? .72 : 1, padding: index ? "14px 0 0" : "0 0 14px", borderBottom: index < items.length - 1 ? "1px solid var(--pulse-line)" : 0 }}><div className="pulse-ticket-title"><div className="pulse-plan-icon" style={{ width: 34, height: 34 }}><Bell size={15} /></div><div><strong>{item.title} {index < unread && <span style={{ color: "var(--pulse-blue)" }}>•</span>}</strong><small>{item.text} • {item.time}</small></div></div><Status tone={item.tone}>{item.tone === "good" ? "اتصال" : item.tone === "warn" ? "مصرف" : "پرداخت"}</Status></div>)}</div></>;
}

function Support({ notice }: { notice: (message: string) => void }) {
  const [sent, setSent] = useState(false);
  return <><Heading title="پشتیبانی" subtitle="اگر جایی نیاز به کمک دارید، تیم Pulse کنار شماست." actions={<Button icon={Plus} onClick={() => setSent(false)}>تیکت جدید</Button>} /><div className="pulse-grid two"><article className="pulse-card"><div className="pulse-card-title"><div><h2>تیکت‌های شما</h2><p>میانگین پاسخ‌گویی: کمتر از ۱۰ دقیقه</p></div><Headphones size={18} /></div>{[["اتصال در iPhone برقرار نمی‌شود", "در حال بررسی", "warn"], ["درخواست تغییر ایمیل حساب", "پاسخ داده شد", "good"], ["راهنمای استفاده از کانفیگ", "بسته‌شده", "info"]].map(([title, status, tone]) => <div className="pulse-ticket" key={title}><div className="pulse-ticket-title"><Ticket size={17} /><div><strong>{title}</strong><small>آخرین پیام • امروز</small></div></div><Status tone={tone as Tone}>{status}</Status></div>)}</article><article className="pulse-card">{sent ? <div className="pulse-empty" style={{ minHeight: 260 }}><CheckCircle2 size={35} /><strong>پیام شما ثبت شد</strong><p>کارشناس پشتیبانی تا دقایقی دیگر پاسخ می‌دهد.</p><Button variant="ghost" onClick={() => setSent(false)}>ارسال تیکت دیگر</Button></div> : <><div className="pulse-card-title"><div><h2>پیام جدید</h2><p>موضوع و شرح درخواست را بنویسید.</p></div><MessageSquare size={18} /></div><div className="pulse-field"><label>موضوع</label><input defaultValue="اتصال در دستگاه جدید" /></div><div className="pulse-field" style={{ marginTop: 12 }}><label>شرح درخواست</label><input defaultValue="سلام، برای راه‌اندازی روی لپ‌تاپ راهنمایی می‌خواهم." /></div><div className="pulse-card-footer"><span className="pulse-eyebrow">پاسخ از داخل همین پنل</span><Button icon={MessageSquare} onClick={() => { setSent(true); notice("تیکت شما به پشتیبانی ارسال شد"); }}>ارسال پیام</Button></div></>}</article></div></>;
}

function Referral({ notice }: { notice: (message: string) => void }) {
  const [copied, setCopied] = useState(false);
  return <><Heading title="دعوت از دوستان" subtitle="دوستتان را به Pulse دعوت کنید و اعتبار هدیه بگیرید." /><div className="pulse-banner"><div><strong>اعتبار هدیه شما: ۲۴۰٬۰۰۰ تومان</strong><p>با اولین خرید هر دوست، ۸۰٬۰۰۰ تومان اعتبار می‌گیرید.</p></div><WalletCards size={20} /></div><div className="pulse-grid two"><article className="pulse-card"><div className="pulse-card-title"><div><h2>لینک دعوت اختصاصی</h2><p>بدون محدودیت اشتراک‌گذاری</p></div><Link2 size={18} /></div><div className="pulse-code"><span>pulse.ir/invite/nima-r8</span><button onClick={() => { setCopied(true); notice("لینک دعوت کپی شد"); }} aria-label="کپی لینک">{copied ? <Check size={15} /> : <Copy size={15} />}</button></div><div className="pulse-card-footer"><span className="pulse-eyebrow">۳ نفر دعوت‌شده • ۲ خرید موفق</span><Button variant="soft" icon={ExternalLink} onClick={() => notice("پنجره اشتراک‌گذاری باز شد")}>اشتراک‌گذاری</Button></div></article><article className="pulse-card"><div className="pulse-card-title"><div><h2>عملکرد دعوت‌ها</h2><p>در ۳۰ روز اخیر</p></div><TrendingUp size={18} /></div><div className="pulse-kv"><div><span>بازدید لینک</span><strong>۴۷ نفر</strong></div><div><span>تبدیل به خرید</span><strong>۴.۲٪</strong></div><div><span>اعتبار دریافت‌شده</span><strong>۱۶۰٬۰۰۰</strong></div><div><span>قابل استفاده</span><strong>۲۴۰٬۰۰۰</strong></div></div></article></div></>;
}

function AdminDashboard({ go }: { go: (screen: ScreenName) => void }) {
  return <><Heading title="مرکز کنترل نمایندگی" subtitle="نمایی دقیق از فروش، سلامت سرویس و مشتریان Pulse." actions={<Button variant="ghost" icon={Download} onClick={() => undefined}>گزارش امروز</Button>} /><div className="pulse-grid stats"><StatCard icon={Users} label="مشتریان فعال" value="۱٬۲۸۴" note="+۸.۶٪ نسبت به ماه قبل" /><StatCard icon={WalletCards} label="دریافت این ماه" value="۴۸.۷M" note="تومان • ۷۸٪ از هدف" tone="cyan" /><StatCard icon={Activity} label="اتصال‌های فعال" value="۹۶۸" note="پایداری شبکه ۹۹.۲٪" tone="green" /><StatCard icon={AlertCircle} label="تیکت‌های باز" value="۱۲" note="۳ مورد نیازمند پاسخ" tone="orange" /></div><div className="pulse-grid two" style={{ marginTop: 16 }}><ChartCard admin /><article className="pulse-card"><div className="pulse-card-title"><div><h2>سلامت زیرساخت</h2><p>وضعیت زنده نودهای اصلی</p></div><Status tone="good">همه پایدار</Status></div>{[["فرانکفورت", "۳۴٪", "good"], ["آمستردام", "۵۱٪", "good"], ["استانبول", "۶۸٪", "warn"], ["هلسینکی", "۲۲٪", "good"]].map(([name, value, tone]) => <div key={name} style={{ marginBottom: 14 }}><div className="pulse-meter-row"><span>{name}</span><strong>{value}</strong></div><div className={`pulse-meter ${tone === "warn" ? "warn" : ""}`}><span style={{ width: value }} /></div></div>)}<Button variant="ghost" icon={Server} onClick={() => go("admin-servers")}>مدیریت سرورها</Button></article></div><div className="pulse-grid two" style={{ marginTop: 16 }}><article className="pulse-card"><div className="pulse-card-title"><div><h2>آخرین سفارش‌ها</h2><p>ورودی‌های امروز</p></div><Button variant="ghost" onClick={() => go("admin-orders")}>مشاهده همه</Button></div><div className="pulse-table-wrap"><table className="pulse-table" style={{ minWidth: 530 }}><thead><tr><th>مشتری</th><th>پلن</th><th>مبلغ</th><th>وضعیت</th></tr></thead><tbody>{[["سارا محمدی", "حرفه‌ای", "۳۴۹٬۰۰۰", "موفق"], ["کاوه نادری", "تیمی", "۷۹۰٬۰۰۰", "موفق"], ["الهام کریمی", "پایه", "۱۸۹٬۰۰۰", "در انتظار"]].map((row) => <tr key={row[0]}><td><strong>{row[0]}</strong></td><td>{row[1]}</td><td className="mono">{row[2]}</td><td><Status tone={row[3] === "موفق" ? "good" : "warn"}>{row[3]}</Status></td></tr>)}</tbody></table></div></article><article className="pulse-card"><div className="pulse-card-title"><div><h2>صف پشتیبانی</h2><p>تیکت‌های نیازمند توجه</p></div><Status tone="warn">۳ فوری</Status></div>{["اتصال کاربر روی iOS", "تغییر پلن سازمانی", "رسید پرداخت ناموفق"].map((title, index) => <div className="pulse-ticket" key={title}><div className="pulse-ticket-title"><div className="pulse-avatar" style={{ width: 29, height: 29, fontSize: ".67rem" }}>{["س", "ک", "ر"][index]}</div><div><strong>{title}</strong><small>{index + 1} ساعت پیش • اولویت {index === 0 ? "بالا" : "عادی"}</small></div></div><ChevronLeft size={15} /></div>)}<Button variant="ghost" icon={Headphones} onClick={() => go("support")}>ورود به پشتیبانی</Button></article></div></>;
}

function AdminTable({ kind, go }: { kind: "customers" | "subscriptions" | "servers" | "plans" | "orders" | "payments"; go: (screen: ScreenName) => void }) {
  const config = {
    customers: { title: "مشتریان", subtitle: "مدیریت حساب‌ها و وضعیت اتصال مشتریان.", icon: Users, headers: ["مشتری", "شماره تماس", "اشتراک", "آخرین فعالیت", "وضعیت"], rows: [["سارا محمدی", "۰۹۱۰ ۳۱۲ ۴۸۸۲", "حرفه‌ای", "امروز، ۱۲:۰۴", "فعال"], ["کاوه نادری", "۰۹۳۵ ۸۲۱ ۰۹۷۱", "تیمی", "امروز، ۱۱:۳۲", "فعال"], ["الهام کریمی", "۰۹۱۹ ۷۷۳ ۲۲۶۰", "پایه", "دیروز", "منقضی"], ["آرمان یوسفی", "۰۹۰۲ ۴۴۱ ۶۷۸۳", "—", "ثبت‌نام جدید", "بدون پلن"]] },
    subscriptions: { title: "اشتراک‌ها", subtitle: "تمام اشتراک‌ها، ظرفیت و تاریخ انقضا.", icon: PackageCheck, headers: ["شناسه", "مشتری", "پلن", "مصرف", "انقضا", "وضعیت"], rows: [["PL-8842", "نیما رضایی", "حرفه‌ای", "۳۷٪", "۲۶ اردیبهشت", "فعال"], ["PL-8831", "سارا محمدی", "حرفه‌ای", "۶۲٪", "۲۲ اردیبهشت", "فعال"], ["PL-8744", "الهام کریمی", "پایه", "۸۸٪", "منقضی", "منقضی"], ["PL-8680", "کاوه نادری", "تیمی", "۲۱٪", "۱۲ خرداد", "فعال"]] },
    servers: { title: "سرورها", subtitle: "سلامت، ظرفیت و مسیرهای اتصال.", icon: Server, headers: ["سرور", "موقعیت", "اتصال فعال", "ظرفیت", "پینگ", "وضعیت"], rows: [["de-fra-03", "فرانکفورت", "۳۴۱", "۳۴٪", "۴۲ms", "سالم"], ["nl-ams-02", "آمستردام", "۲۸۸", "۵۱٪", "۵۸ms", "سالم"], ["tr-ist-01", "استانبول", "۲۲۱", "۶۸٪", "۷۳ms", "پرترافیک"], ["fi-hel-01", "هلسینکی", "۱۱۸", "۲۲٪", "۸۵ms", "سالم"]] },
    plans: { title: "پلن‌ها و قیمت‌گذاری", subtitle: "پیشنهادهای فعال برای مشتریان این نمایندگی.", icon: SlidersHorizontal, headers: ["پلن", "ترافیک", "دستگاه", "قیمت فروش", "فروش ماه", "وضعیت"], rows: [["پایه", "۲۵ GB", "۳", "۱۸۹٬۰۰۰", "۸۲", "فعال"], ["حرفه‌ای", "۵۰ GB", "۵", "۳۴۹٬۰۰۰", "۱۴۶", "فعال"], ["تیمی", "۱۵۰ GB", "۱۲", "۷۹۰٬۰۰۰", "۳۴", "فعال"]] },
    orders: { title: "سفارش‌ها", subtitle: "پیگیری سفارش‌ها و عملیات پرداخت.", icon: ClipboardList, headers: ["سفارش", "مشتری", "شرح", "مبلغ", "زمان", "وضعیت"], rows: [["PL-29841", "نیما رضایی", "تمدید حرفه‌ای", "۳۴۹٬۰۰۰", "۱۰:۴۸", "موفق"], ["PL-29840", "کاوه نادری", "خرید تیمی", "۷۹۰٬۰۰۰", "۱۰:۲۱", "موفق"], ["PL-29839", "الهام کریمی", "خرید پایه", "۱۸۹٬۰۰۰", "۰۹:۵۵", "در انتظار"]] },
    payments: { title: "دریافت‌ها", subtitle: "گردش مالی و واریزهای تسویه‌نشده.", icon: WalletCards, headers: ["تراکنش", "سفارش", "روش", "مبلغ", "تاریخ", "وضعیت"], rows: [["TX-90128", "PL-29841", "درگاه بانکی", "۳۴۹٬۰۰۰", "امروز", "تسویه‌شده"], ["TX-90127", "PL-29840", "کیف پول", "۷۹۰٬۰۰۰", "امروز", "تسویه‌شده"], ["TX-90121", "PL-29831", "درگاه بانکی", "۱۸۹٬۰۰۰", "دیروز", "در انتظار"]] },
  }[kind];
  const [filter, setFilter] = useState("");
  const Icon = config.icon;
  return <><Heading title={config.title} subtitle={config.subtitle} actions={<Button icon={Plus} onClick={() => go(kind === "customers" ? "admin-customers" : "admin-orders")}>افزودن مورد</Button>} /><div className="pulse-filterbar"><div className="pulse-search"><Search size={15} /><input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder={`جست‌وجو در ${config.title}`} /></div><div style={{ display: "flex", gap: 8 }}><Button variant="ghost" icon={Filter} onClick={() => setFilter("فعال")}>فیلتر</Button><Icon size={19} color="var(--pulse-muted)" /></div></div><div className="pulse-table-wrap"><table className="pulse-table"><thead><tr>{config.headers.map((header) => <th key={header}>{header}</th>)}<th /></tr></thead><tbody>{config.rows.filter((row) => row.some((cell) => cell.includes(filter))).map((row) => <tr key={row[0]}>{row.map((cell, index) => <td key={`${row[0]}-${index}`} className={index === 0 || /^\d/.test(cell) ? "mono" : ""}><strong>{index === 0 ? cell : undefined}</strong>{index === 0 ? null : cell}</td>)}<td><button className="pulse-icon-btn" aria-label="گزینه‌ها" onClick={() => undefined}><MoreHorizontal size={15} /></button></td></tr>)}</tbody></table></div></>;
}

function AdminAnalytics() {
  return <><Heading title="گزارش‌ها و تحلیل" subtitle="تصمیم‌گیری بر اساس روند فروش و سلامت سرویس." actions={<Button variant="ghost" icon={Download} onClick={() => undefined}>دریافت گزارش</Button>} /><div className="pulse-grid stats"><StatCard icon={TrendingUp} label="رشد فروش" value="+۱۸.۴٪" note="در مقایسه با ماه قبل" tone="green" /><StatCard icon={Percent} label="نرخ تمدید" value="۶۴.۸٪" note="از مشتریان فعال" /><StatCard icon={Users} label="ورودی جدید" value="۲۸۷" note="در ۳۰ روز گذشته" tone="cyan" /><StatCard icon={WalletCards} label="میانگین سفارش" value="۳۸۲K" note="تومان" tone="orange" /></div><div className="pulse-grid two" style={{ marginTop: 16 }}><ChartCard admin /><article className="pulse-card"><div className="pulse-card-title"><div><h2>ترکیب درآمد</h2><p>بر اساس نوع فروش</p></div><PieChart size={18} /></div><div style={{ display: "grid", gap: 16, marginTop: 12 }}><div><div className="pulse-meter-row"><span>پلن حرفه‌ای</span><strong>۵۴٪</strong></div><div className="pulse-meter"><span style={{ width: "54%" }} /></div></div><div><div className="pulse-meter-row"><span>پلن تیمی</span><strong>۲۸٪</strong></div><div className="pulse-meter"><span style={{ width: "28%" }} /></div></div><div><div className="pulse-meter-row"><span>افزایش ترافیک</span><strong>۱۸٪</strong></div><div className="pulse-meter"><span style={{ width: "18%" }} /></div></div></div></article></div><article className="pulse-card" style={{ marginTop: 16 }}><div className="pulse-card-title"><div><h2>پرسودترین روزهای ماه</h2><p>روند ۴ هفته اخیر</p></div><BarChart3 size={18} /></div><div className="pulse-mini-bars">{[38, 55, 43, 68, 52, 84, 61, 73, 49, 91, 65, 78, 56, 83, 70, 96, 67, 88].map((height, index) => <span key={index} style={{ height: `${height}%` }} />)}</div></article></>;
}

function AdminSettings({ notice }: { notice: (message: string) => void }) {
  return <><Heading title="تنظیمات پنل" subtitle="شخصی‌سازی نمایندگی و کنترل دسترسی تیم." actions={<Button icon={Check} onClick={() => notice("تنظیمات ذخیره شد")}>ذخیره تنظیمات</Button>} /><div className="pulse-grid two"><article className="pulse-card"><div className="pulse-card-title"><div><h2>اطلاعات نمایندگی</h2><p>در رسید و پیام‌های مشتری نمایش داده می‌شود.</p></div><Settings size={18} /></div><div className="pulse-form-grid"><div className="pulse-field"><label>نام نمایندگی</label><input defaultValue="نمایندگی آریا" /></div><div className="pulse-field"><label>شماره تماس</label><input defaultValue="۰۲۱ ۸۸۴۲ ۱۹۳۰" /></div><div className="pulse-field"><label>ایمیل پاسخ‌گویی</label><input defaultValue="support@arya.example" /></div><div className="pulse-field"><label>واحد پول</label><select defaultValue="تومان"><option>تومان</option><option>ریال</option></select></div></div></article><article className="pulse-card"><div className="pulse-card-title"><div><h2>اعلان‌های مدیریتی</h2><p>چه چیزی را از Pulse بشنوید؟</p></div><Bell size={18} /></div>{[["افت ظرفیت سرورها", "وقتی ظرفیت نود از ۸۰٪ عبور کرد"], ["پرداخت ناموفق", "در لحظه تراکنش ناموفق"], ["گزارش هفتگی", "هر شنبه ساعت ۹ صبح"]].map(([title, detail], index) => <div className="pulse-toggle" key={title}><div><strong>{title}</strong><small>{detail}</small></div><button className={`pulse-switch ${index < 2 ? "on" : ""}`} aria-label={title} onClick={() => notice(`اعلان ${title} تغییر کرد`)} /></div>)}</article></div><article className="pulse-card" style={{ marginTop: 16 }}><div className="pulse-card-title"><div><h2>اعضای تیم</h2><p>مدیریت دسترسی همکاران نمایندگی</p></div><Button variant="ghost" icon={Plus} onClick={() => notice("فرم دعوت همکار باز شد")}>دعوت همکار</Button></div><div className="pulse-table-wrap"><table className="pulse-table" style={{ minWidth: 500 }}><thead><tr><th>همکار</th><th>نقش</th><th>آخرین فعالیت</th><th>وضعیت</th><th /></tr></thead><tbody>{[["مریم احمدی", "مدیر", "امروز ۱۰:۴۸"], ["سعید نوری", "پشتیبان", "دیروز ۱۶:۲۲"], ["ترانه کاظمی", "مالی", "۲ روز پیش"]].map((row) => <tr key={row[0]}><td><strong>{row[0]}</strong></td><td>{row[1]}</td><td>{row[2]}</td><td><Status tone="good">فعال</Status></td><td><button className="pulse-icon-btn" aria-label="ویرایش" onClick={() => notice(`ویرایش ${row[0]}`)}><MoreHorizontal size={15} /></button></td></tr>)}</tbody></table></div></article></>;
}

function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  return <div style={{ position: "fixed", left: 22, bottom: 22, zIndex: 100, display: "flex", alignItems: "center", gap: 10, maxWidth: 340, border: "1px solid #b7dce0", borderRadius: 12, padding: "11px 13px", background: "#edfbfc", color: "#126e7c", boxShadow: "0 10px 30px rgba(31,67,88,.16)", fontSize: ".74rem" }}><CheckCircle2 size={16} /><span>{message}</span><button onClick={onClose} aria-label="بستن اعلان" style={{ border: 0, background: "transparent", color: "inherit" }}><X size={14} /></button></div>;
}

export function PulseRedesign() {
  const [screen, setScreen] = useState<ScreenName>(() => readScreen());
  const [toast, setToast] = useState("");
  const go = (next: ScreenName) => {
    window.history.pushState({}, "", `${window.location.pathname}?screen=${next}`);
    setScreen(next);
  };
  useEffect(() => {
    const onPop = () => setScreen(readScreen());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const notice = (message: string) => setToast(message);
  const content = useMemo(() => {
    switch (screen) {
      case "customer-dashboard": return <CustomerDashboard go={go} notice={notice} />;
      case "subscription-list": return <SubscriptionList go={go} />;
      case "subscription-detail": return <SubscriptionDetail go={go} />;
      case "purchase-vpn": return <PurchaseVpn go={go} />;
      case "server-selection": return <ServerSelection go={go} />;
      case "configuration": return <Configuration notice={notice} />;
      case "traffic-expiration": return <TrafficExpiration go={go} />;
      case "renewal": return <Renewal go={go} />;
      case "order-history": return <OrderHistory />;
      case "payment": return <Payment />;
      case "profile": return <Profile notice={notice} />;
      case "notifications": return <Notifications notice={notice} />;
      case "support": return <Support notice={notice} />;
      case "referral": return <Referral notice={notice} />;
      case "mobile-dashboard": return <CustomerDashboard go={go} notice={notice} />;
      case "mobile-subscription-detail": return <SubscriptionDetail go={go} mobile />;
      case "mobile-purchase": return <PurchaseVpn go={go} mobile />;
      case "admin-dashboard": return <AdminDashboard go={go} />;
      case "admin-customers": return <AdminTable kind="customers" go={go} />;
      case "admin-subscriptions": return <AdminTable kind="subscriptions" go={go} />;
      case "admin-servers": return <AdminTable kind="servers" go={go} />;
      case "admin-plans": return <AdminTable kind="plans" go={go} />;
      case "admin-orders": return <AdminTable kind="orders" go={go} />;
      case "admin-payments": return <AdminTable kind="payments" go={go} />;
      case "admin-analytics": return <AdminAnalytics />;
      case "admin-settings": return <AdminSettings notice={notice} />;
      default: return <CustomerDashboard go={go} notice={notice} />;
    }
  }, [screen]);
  return (
    <Shell screen={screen} onNavigate={go} onNotice={notice}>
      {content}
      {toast ? <Toast message={toast} onClose={() => setToast("")} /> : null}
    </Shell>
  );
}

export default PulseRedesign;