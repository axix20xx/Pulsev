const fs = require('fs');
let css = fs.readFileSync('artifacts/sales-manager/src/index.css', 'utf-8');

const rootReplacement = `:root {
  --background: 216 28% 7%;
  --foreground: 210 33% 99%;
  --border: 216 28% 14%;
  --card: 216 28% 9%;
  --card-foreground: 210 33% 99%;
  --card-border: 216 28% 16%;
  --sidebar: 216 28% 7%;
  --sidebar-foreground: 210 33% 99%;
  --sidebar-border: 216 28% 14%;
  --sidebar-primary: 193 84% 45%;
  --sidebar-primary-foreground: 216 28% 7%;
  --sidebar-accent: 216 28% 14%;
  --sidebar-accent-foreground: 210 33% 99%;
  --sidebar-ring: 193 84% 45%;
  --popover: 216 28% 9%;
  --popover-foreground: 210 33% 99%;
  --popover-border: 216 28% 16%;
  --primary: 193 84% 45%;
  --primary-foreground: 216 28% 7%;
  --secondary: 216 28% 14%;
  --secondary-foreground: 210 33% 99%;
  --muted: 216 28% 14%;
  --muted-foreground: 215 16% 65%;
  --accent: 154 60% 45%;
  --accent-foreground: 216 28% 7%;
  --destructive: 0 84% 60%;
  --destructive-foreground: 210 33% 99%;
  --input: 216 28% 14%;
  --ring: 193 84% 45%;
  --chart-1: 193 84% 45%;
  --chart-2: 154 60% 45%;
  --chart-3: 35 91% 57%;
  --chart-4: 0 84% 60%;
  --chart-5: 262 83% 58%;
  --radius: 1.25rem;
  
  --shadow-2xs: 0px 2px 4px -1px hsl(0 0% 0% / 0.3);
  --shadow-xs: 0px 4px 8px -2px hsl(0 0% 0% / 0.4);
  --shadow-sm: 0px 8px 16px -4px hsl(0 0% 0% / 0.5);
  --shadow: 0px 16px 32px -8px hsl(0 0% 0% / 0.6);
  --shadow-md: 0px 24px 48px -12px hsl(0 0% 0% / 0.7);
  --shadow-lg: 0px 32px 64px -16px hsl(0 0% 0% / 0.8);
  --shadow-xl: 0px 48px 96px -24px hsl(0 0% 0% / 0.9);
  --shadow-2xl: 0px 64px 128px -32px hsl(0 0% 0% / 1);
  
  --button-outline: rgba(255, 255, 255, 0.08);
  --badge-outline: rgba(255, 255, 255, 0.05);
  --opaque-button-border-intensity: 8;
  --elevate-1: rgba(255, 255, 255, 0.04);
  --elevate-2: rgba(255, 255, 255, 0.08);
  
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
  --background: 216 28% 7%;
  --foreground: 210 33% 99%;
  --border: 216 28% 14%;
  --card: 216 28% 9%;
  --card-foreground: 210 33% 99%;
  --card-border: 216 28% 16%;
  --sidebar: 216 28% 7%;
  --sidebar-foreground: 210 33% 99%;
  --sidebar-border: 216 28% 14%;
  --sidebar-primary: 193 84% 45%;
  --sidebar-primary-foreground: 216 28% 7%;
  --sidebar-accent: 216 28% 14%;
  --sidebar-accent-foreground: 210 33% 99%;
  --sidebar-ring: 193 84% 45%;
  --popover: 216 28% 9%;
  --popover-foreground: 210 33% 99%;
  --popover-border: 216 28% 16%;
  --primary: 193 84% 45%;
  --primary-foreground: 216 28% 7%;
  --secondary: 216 28% 14%;
  --secondary-foreground: 210 33% 99%;
  --muted: 216 28% 14%;
  --muted-foreground: 215 16% 65%;
  --accent: 154 60% 45%;
  --accent-foreground: 216 28% 7%;
  --destructive: 0 84% 60%;
  --destructive-foreground: 210 33% 99%;
  --input: 216 28% 14%;
  --ring: 193 84% 45%;
  --chart-1: 193 84% 45%;
  --chart-2: 154 60% 45%;
  --chart-3: 35 91% 57%;
  --chart-4: 0 84% 60%;
  --chart-5: 262 83% 58%;

  --shadow-2xs: 0px 2px 4px -1px hsl(0 0% 0% / 0.3);
  --shadow-xs: 0px 4px 8px -2px hsl(0 0% 0% / 0.4);
  --shadow-sm: 0px 8px 16px -4px hsl(0 0% 0% / 0.5);
  --shadow: 0px 16px 32px -8px hsl(0 0% 0% / 0.6);
  --shadow-md: 0px 24px 48px -12px hsl(0 0% 0% / 0.7);
  --shadow-lg: 0px 32px 64px -16px hsl(0 0% 0% / 0.8);
  --shadow-xl: 0px 48px 96px -24px hsl(0 0% 0% / 0.9);
  --shadow-2xl: 0px 64px 128px -32px hsl(0 0% 0% / 1);
  
  --button-outline: rgba(255, 255, 255, 0.08);
  --badge-outline: rgba(255, 255, 255, 0.05);
  --opaque-button-border-intensity: 8;
  --elevate-1: rgba(255, 255, 255, 0.04);
  --elevate-2: rgba(255, 255, 255, 0.08);
}`;

css = css.replace(/:root\s*\{[\s\S]*?(?=\n\.dark\s*\{)/, rootReplacement + '\n\n');
css = css.replace(/\.dark\s*\{[\s\S]*?(?=\n@layer base\s*\{)/, darkReplacement + '\n\n');

css = css.replace(/html\s*\{\s*background:\s*hsl\(var\(--background\)\);\s*\}/, `html { background: hsl(var(--background)); color-scheme: dark; }`);

css = css.replace(/\.page-wrap\s*\{[^}]*\}/, `.page-wrap { max-width: 1460px; margin: 0 auto; padding: 48px 56px 80px; position: relative; z-index: 10; }`);

css = css.replace(/\.pulse-sidebar\s*\{[^}]*\}/, `.pulse-sidebar { position: fixed; inset: 0 0 0 auto; z-index: 40; width: 260px; background: hsl(var(--sidebar) / 0.4); backdrop-filter: blur(48px) saturate(180%); border-left: 1px solid hsl(var(--sidebar-border) / 0.5); transition: transform .3s cubic-bezier(0.16, 1, 0.3, 1); box-shadow: -8px 0 32px hsl(0 0% 0% / 0.4); }`);

css = css.replace(/\.topbar\s*\{[^}]*\}/, `.topbar { display: flex; height: 76px; align-items: center; gap: 16px; border-bottom: 1px solid hsl(var(--border) / 0.5); padding: 0 42px; background: hsl(var(--background) / 0.4); backdrop-filter: blur(48px) saturate(180%); position: sticky; top: 0; z-index: 30; box-shadow: 0 4px 24px -8px hsl(0 0% 0% / 0.4); transition: background 0.3s ease; }`);

css = css.replace(/\.metric-card,\s*\.panel-card,\s*\.table-card,\s*\.service-card,\s*\.customer-list\s*\{[^}]*\}/, `.metric-card, .panel-card, .table-card, .service-card, .customer-list { border: 1px solid hsl(var(--card-border) / 0.5); border-radius: var(--radius); background: hsl(var(--card) / 0.4); backdrop-filter: blur(24px) saturate(180%); box-shadow: var(--shadow-sm); transition: transform 0.3s ease, box-shadow 0.3s ease, border-color 0.3s ease; } \n.metric-card:hover, .panel-card:hover, .service-card:hover { transform: translateY(-2px); box-shadow: var(--shadow-md); border-color: hsl(var(--primary) / 0.4); }`);

fs.writeFileSync('artifacts/sales-manager/src/index.css', css);
