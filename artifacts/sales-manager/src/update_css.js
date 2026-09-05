const fs = require('fs');
let css = fs.readFileSync('artifacts/sales-manager/src/index.css', 'utf-8');

const rootReplacement = `:root {
  --background: 210 33% 99%;
  --foreground: 222 47% 11%;
  --border: 214 32% 91%;
  --card: 0 0% 100%;
  --card-foreground: 222 47% 11%;
  --card-border: 214 32% 91%;
  --sidebar: 210 33% 99%;
  --sidebar-foreground: 222 47% 11%;
  --sidebar-border: 214 32% 91%;
  --sidebar-primary: 188 86% 40%;
  --sidebar-primary-foreground: 0 0% 100%;
  --sidebar-accent: 214 32% 91%;
  --sidebar-accent-foreground: 222 47% 11%;
  --sidebar-ring: 188 86% 40%;
  --popover: 0 0% 100%;
  --popover-foreground: 222 47% 11%;
  --popover-border: 214 32% 91%;
  --primary: 193 84% 32%;
  --primary-foreground: 0 0% 100%;
  --secondary: 214 32% 95%;
  --secondary-foreground: 222 47% 11%;
  --muted: 214 32% 95%;
  --muted-foreground: 215 16% 47%;
  --accent: 154 60% 45%;
  --accent-foreground: 0 0% 100%;
  --destructive: 0 84% 60%;
  --destructive-foreground: 0 0% 100%;
  --input: 214 32% 91%;
  --ring: 193 84% 32%;
  --chart-1: 193 84% 32%;
  --chart-2: 154 60% 45%;
  --chart-3: 35 91% 57%;
  --chart-4: 0 84% 60%;
  --chart-5: 262 83% 58%;
  --radius: 1.25rem;
  
  --shadow-2xs: 0px 2px 4px -1px hsl(222 47% 11% / 0.04);
  --shadow-xs: 0px 4px 8px -2px hsl(222 47% 11% / 0.05);
  --shadow-sm: 0px 8px 16px -4px hsl(222 47% 11% / 0.06);
  --shadow: 0px 16px 32px -8px hsl(222 47% 11% / 0.08);
  --shadow-md: 0px 24px 48px -12px hsl(222 47% 11% / 0.1);
  --shadow-lg: 0px 32px 64px -16px hsl(222 47% 11% / 0.12);
  --shadow-xl: 0px 48px 96px -24px hsl(222 47% 11% / 0.14);
  --shadow-2xl: 0px 64px 128px -32px hsl(222 47% 11% / 0.16);
  
  --button-outline: rgba(0, 0, 0, 0.08);
  --badge-outline: rgba(0, 0, 0, 0.05);
  --opaque-button-border-intensity: -5;
  --elevate-1: rgba(0, 0, 0, 0.02);
  --elevate-2: rgba(0, 0, 0, 0.05);
  
  --app-font-sans: 'Vazirmatn', sans-serif;
  --app-font-serif: 'Vazirmatn', sans-serif;
  --app-font-mono: 'IBM Plex Mono', monospace;
  
  --sidebar-primary-border: hsl(var(--sidebar-primary));
  --sidebar-accent-border: hsl(var(--sidebar-accent));
  --primary-border: hsl(var(--primary));
  --secondary-border: hsl(var(--secondary));
  --muted-border: hsl(var(--muted));
  --accent-border: hsl(var(--accent));
  --destructive-border: hsl(var(--destructive));
}`;

const darkReplacement = `.dark {
  --background: 224 50% 6%;
  --foreground: 210 33% 99%;
  --border: 222 30% 16%;
  --card: 222 40% 9%;
  --card-foreground: 210 33% 99%;
  --card-border: 222 30% 16%;
  --sidebar: 224 50% 6%;
  --sidebar-foreground: 210 33% 99%;
  --sidebar-border: 222 30% 16%;
  --sidebar-primary: 193 84% 32%;
  --sidebar-primary-foreground: 0 0% 100%;
  --sidebar-accent: 222 30% 16%;
  --sidebar-accent-foreground: 210 33% 99%;
  --sidebar-ring: 193 84% 32%;
  --popover: 222 40% 9%;
  --popover-foreground: 210 33% 99%;
  --popover-border: 222 30% 16%;
  --primary: 193 84% 45%;
  --primary-foreground: 224 50% 6%;
  --secondary: 222 30% 16%;
  --secondary-foreground: 210 33% 99%;
  --muted: 222 30% 16%;
  --muted-foreground: 215 16% 65%;
  --accent: 154 60% 45%;
  --accent-foreground: 224 50% 6%;
  --destructive: 0 84% 60%;
  --destructive-foreground: 210 33% 99%;
  --input: 222 30% 16%;
  --ring: 193 84% 45%;
  --chart-1: 193 84% 45%;
  --chart-2: 154 60% 45%;
  --chart-3: 35 91% 57%;
  --chart-4: 0 84% 60%;
  --chart-5: 262 83% 58%;

  --shadow-2xs: 0px 2px 4px -1px hsl(0 0% 0% / 0.2);
  --shadow-xs: 0px 4px 8px -2px hsl(0 0% 0% / 0.3);
  --shadow-sm: 0px 8px 16px -4px hsl(0 0% 0% / 0.4);
  --shadow: 0px 16px 32px -8px hsl(0 0% 0% / 0.5);
  --shadow-md: 0px 24px 48px -12px hsl(0 0% 0% / 0.6);
  --shadow-lg: 0px 32px 64px -16px hsl(0 0% 0% / 0.7);
  --shadow-xl: 0px 48px 96px -24px hsl(0 0% 0% / 0.8);
  --shadow-2xl: 0px 64px 128px -32px hsl(0 0% 0% / 0.9);
  
  --button-outline: rgba(255, 255, 255, 0.1);
  --badge-outline: rgba(255, 255, 255, 0.05);
  --opaque-button-border-intensity: 5;
  --elevate-1: rgba(255, 255, 255, 0.04);
  --elevate-2: rgba(255, 255, 255, 0.08);
}`;

css = css.replace(/:root\s*\{[\s\S]*?(?=\n\.dark\s*\{)/, rootReplacement + '\n\n');
css = css.replace(/\.dark\s*\{[\s\S]*?(?=\n@layer base\s*\{)/, darkReplacement + '\n\n');

// Update global body/app styles
css = css.replace(/\.page-wrap\s*\{[^}]*\}/, `.page-wrap { max-width: 1460px; margin: 0 auto; padding: 48px 56px 80px; position: relative; z-index: 10; }`);

css = css.replace(/\.pulse-sidebar\s*\{[^}]*\}/, `.pulse-sidebar { position: fixed; inset: 0 0 0 auto; z-index: 40; width: 260px; background: hsl(var(--sidebar) / 0.6); backdrop-filter: blur(24px) saturate(180%); border-left: 1px solid hsl(var(--sidebar-border) / 0.5); transition: transform .3s cubic-bezier(0.16, 1, 0.3, 1); box-shadow: -8px 0 32px hsl(0 0% 0% / 0.04); }`);

css = css.replace(/\.topbar\s*\{[^}]*\}/, `.topbar { display: flex; height: 76px; align-items: center; gap: 16px; border-bottom: 1px solid hsl(var(--border) / 0.5); padding: 0 42px; background: hsl(var(--background) / 0.6); backdrop-filter: blur(24px) saturate(180%); position: sticky; top: 0; z-index: 30; box-shadow: 0 4px 24px -8px hsl(0 0% 0% / 0.04); transition: background 0.3s ease; }`);

css = css.replace(/\.metric-card,\s*\.panel-card,\s*\.table-card,\s*\.service-card,\s*\.customer-list\s*\{[^}]*\}/, `.metric-card, .panel-card, .table-card, .service-card, .customer-list { border: 1px solid hsl(var(--card-border) / 0.6); border-radius: var(--radius); background: hsl(var(--card) / 0.7); backdrop-filter: blur(12px); box-shadow: var(--shadow-sm); transition: transform 0.3s ease, box-shadow 0.3s ease; } \n.metric-card:hover, .panel-card:hover, .service-card:hover { transform: translateY(-2px); box-shadow: var(--shadow-md); border-color: hsl(var(--border)); }`);

fs.writeFileSync('artifacts/sales-manager/src/index.css', css);
