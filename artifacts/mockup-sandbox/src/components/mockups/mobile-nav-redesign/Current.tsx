import { Bell, Home, Package, UserRound } from "lucide-react";

import "./_group.css";

const navItems = [
  { href: "/mobile/dashboard", label: "خانه", Icon: Home },
  { href: "/mobile/subscriptions", label: "اشتراک‌ها", Icon: Package },
  { href: "/mobile/notifications", label: "اعلان‌ها", Icon: Bell },
  { href: "/mobile/profile", label: "پروفایل", Icon: UserRound },
];

// Local preview state replaces the customer app's wouter location.
const activeHref = "/mobile/dashboard";
const unread = 0;

export function Current() {
  return (
    <div className="mobile-app mobile-nav-preview" dir="rtl">
      <nav className="mobile-bottom-nav" aria-label="ناوبری اصلی">
        {navItems.map(({ href, label, Icon }) => {
          const active = activeHref === href ||
            (href !== "/mobile/dashboard" && activeHref.startsWith(href));

          return (
            <a
              href={href}
              className={`mobile-nav-item ${active ? "is-active" : ""}`}
              key={href}
              onClick={(event) => event.preventDefault()}
            >
              <span className="mobile-nav-icon">
                <Icon size={19} />
                {label === "اعلان‌ها" && unread > 0 ? (
                  <b>{unread.toLocaleString("fa-IR")}</b>
                ) : null}
              </span>
              <span>{label}</span>
            </a>
          );
        })}
      </nav>
    </div>
  );
}