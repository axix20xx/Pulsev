const fs = require('fs');
let css = fs.readFileSync('artifacts/sales-manager/src/index.css', 'utf-8');

const rootReplacement = `:root {
  --background: 210 33% 98%;
  --foreground: 222 47% 11%;
  --border: 214 32% 91%;
  --card: 210 33% 99%;
  --card-foreground: 222 47% 11%;
  --card-border: 214 32% 91%;
  --sidebar: 210 33% 98%;
  --sidebar-foreground: 222 47% 11%;
  --sidebar-border: 214 32% 91%;
  --sidebar-primary: 193 84% 32%;
  --sidebar-primary-foreground: 0 0% 100%;
  --sidebar-accent: 214 32% 91%;
  --sidebar-accent-foreground: 222 47% 11%;
  --sidebar-ring: 193 84% 32%;
  --popover: 210 33% 99%;
  --popover-foreground: 222 47% 11%;
  --popover-border: 214 32% 91%;
  --primary: 193 84% 32%;
  --primary-foreground: 0 0% 100%;
  --secondary: 214 32% 91%;
  --secondary-foreground: 222 47% 11%;
  --muted: 214 32% 91%;
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

css = css.replace(/:root\s*\{[\s\S]*?(?=\n\.dark\s*\{)/, rootReplacement + '\n\n');
css = css.replace(/color-scheme:\s*dark;/g, "");
fs.writeFileSync('artifacts/sales-manager/src/index.css', css);
