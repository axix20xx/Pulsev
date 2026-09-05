const fs = require('fs');
let css = fs.readFileSync('artifacts/sales-manager/src/index.css', 'utf-8');

const newStyles = `
/* ──────────────────────────────────────────────────────────────────────────
   PREMIUM SPATIAL REDESIGN
   ────────────────────────────────────────────────────────────────────────── */

/* Typography & Base */
body {
  font-family: var(--app-font-sans);
  background-color: hsl(var(--background));
  color: hsl(var(--foreground));
  -webkit-font-smoothing: antialiased;
}

/* Animations */
@keyframes slideUpFade {
  from { opacity: 0; transform: translateY(12px) scale(0.98); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}

@keyframes pulseGlow {
  0% { box-shadow: 0 0 0 0 hsl(var(--primary) / 0.4); }
  70% { box-shadow: 0 0 0 10px hsl(var(--primary) / 0); }
  100% { box-shadow: 0 0 0 0 hsl(var(--primary) / 0); }
}

.page-wrap > * {
  animation: slideUpFade 0.5s cubic-bezier(0.16, 1, 0.3, 1) both;
}
.page-wrap > *:nth-child(2) { animation-delay: 0.05s; }
.page-wrap > *:nth-child(3) { animation-delay: 0.1s; }
.page-wrap > *:nth-child(4) { animation-delay: 0.15s; }
.page-wrap > *:nth-child(5) { animation-delay: 0.2s; }

/* Grid Layouts */
.metrics-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 16px;
  margin-bottom: 24px;
}

.overview-grid, .lower-grid, .detail-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 24px;
  margin-bottom: 24px;
}
@media (min-width: 1024px) {
  .overview-grid { grid-template-columns: 1.2fr 0.8fr; }
  .lower-grid { grid-template-columns: 1fr 1fr; }
  .detail-grid { grid-template-columns: 1fr 320px; }
}

/* Cards & Panels */
.metric-card, .panel-card, .table-card, .service-card, .customer-list, .ops-card, .smart-card {
  position: relative;
  background: hsl(var(--card) / 0.6) !important;
  backdrop-filter: blur(24px) saturate(180%);
  border: 1px solid hsl(var(--card-border) / 0.5) !important;
  border-radius: var(--radius-lg) !important;
  padding: 24px;
  box-shadow: 0 8px 32px -8px hsl(0 0% 0% / 0.08), inset 0 1px 0 0 hsl(0 0% 100% / 0.1) !important;
  overflow: hidden;
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1) !important;
}

.metric-card:hover, .panel-card:hover, .service-card:hover, .ops-card:hover {
  transform: translateY(-2px) scale(1.005);
  border-color: hsl(var(--primary) / 0.3) !important;
  box-shadow: 0 16px 48px -12px hsl(var(--primary) / 0.15), inset 0 1px 0 0 hsl(0 0% 100% / 0.1) !important;
  background: hsl(var(--card) / 0.8) !important;
}

/* Metric Cards Specifics */
.metric-card {
  padding: 20px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  min-height: 140px;
}
.metric-card::before {
  content: '';
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 2px;
  background: linear-gradient(90deg, transparent, hsl(var(--primary) / 0.5), transparent);
  opacity: 0;
  transition: opacity 0.3s ease;
}
.metric-card:hover::before { opacity: 1; }

.metric-icon {
  width: 36px;
  height: 36px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 12px;
  background: hsl(var(--primary) / 0.1);
  color: hsl(var(--primary));
  box-shadow: 0 4px 12px hsl(var(--primary) / 0.2);
}
.metric-icon.amber { background: hsl(var(--chart-3) / 0.1); color: hsl(var(--chart-3)); box-shadow: 0 4px 12px hsl(var(--chart-3) / 0.2); }
.metric-icon.coral { background: hsl(var(--destructive) / 0.1); color: hsl(var(--destructive)); box-shadow: 0 4px 12px hsl(var(--destructive) / 0.2); }
.metric-icon.sage { background: hsl(var(--chart-2) / 0.1); color: hsl(var(--chart-2)); box-shadow: 0 4px 12px hsl(var(--chart-2) / 0.2); }

.metric-label {
  font-size: 13px;
  font-weight: 600;
  color: hsl(var(--muted-foreground));
  margin-bottom: 4px;
}
.metric-value {
  font-family: var(--font-display);
  font-size: 32px;
  font-weight: 800;
  letter-spacing: -0.04em;
  color: hsl(var(--foreground));
  text-shadow: 0 2px 10px hsl(0 0% 0% / 0.1);
}
.metric-detail {
  font-size: 11px;
  color: hsl(var(--muted-foreground));
  margin-top: 8px;
  font-weight: 500;
}

/* Buttons */
.button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 42px;
  padding: 0 16px;
  border-radius: var(--radius-md);
  font-size: 13px;
  font-weight: 700;
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  cursor: pointer;
  border: 1px solid transparent;
}
.button:active { transform: scale(0.97); }

.button-primary {
  background: linear-gradient(135deg, hsl(var(--primary)), hsl(193 84% 25%));
  color: hsl(var(--primary-foreground));
  box-shadow: 0 4px 14px hsl(var(--primary) / 0.3), inset 0 1px 0 hsl(0 0% 100% / 0.2);
  border: 1px solid hsl(var(--primary) / 0.5);
}
.button-primary:hover {
  box-shadow: 0 6px 20px hsl(var(--primary) / 0.4), inset 0 1px 0 hsl(0 0% 100% / 0.2);
  filter: brightness(1.1);
}

.button-secondary {
  background: hsl(var(--secondary) / 0.5);
  backdrop-filter: blur(10px);
  color: hsl(var(--secondary-foreground));
  border-color: hsl(var(--border) / 0.5);
  box-shadow: 0 2px 8px hsl(0 0% 0% / 0.05);
}
.button-secondary:hover {
  background: hsl(var(--secondary) / 0.8);
  border-color: hsl(var(--border));
}

.button-quiet {
  background: transparent;
  color: hsl(var(--primary));
  height: 32px;
  padding: 0 12px;
  font-size: 12px;
}
.button-quiet:hover {
  background: hsl(var(--primary) / 0.1);
}

/* Tables */
table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
}
th {
  text-align: right;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: hsl(var(--muted-foreground));
  padding: 16px 12px;
  border-bottom: 1px solid hsl(var(--border) / 0.5);
}
td {
  padding: 16px 12px;
  font-size: 13px;
  font-weight: 500;
  border-bottom: 1px solid hsl(var(--border) / 0.3);
  transition: background 0.2s ease;
}
tr:last-child td { border-bottom: none; }
tbody tr:hover td {
  background: hsl(var(--foreground) / 0.02);
}

/* Forms & Inputs */
.field {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 16px;
}
.field > span {
  font-size: 12px;
  font-weight: 600;
  color: hsl(var(--foreground) / 0.8);
}
.field input, .field select, .field textarea {
  height: 44px;
  padding: 0 14px;
  border-radius: var(--radius-md);
  border: 1px solid hsl(var(--input));
  background: hsl(var(--background) / 0.5);
  color: hsl(var(--foreground));
  font-size: 14px;
  font-weight: 500;
  transition: all 0.2s ease;
  box-shadow: inset 0 2px 4px hsl(0 0% 0% / 0.02);
}
.field input:focus, .field select:focus, .field textarea:focus {
  outline: none;
  border-color: hsl(var(--primary));
  box-shadow: 0 0 0 3px hsl(var(--primary) / 0.15), inset 0 2px 4px hsl(0 0% 0% / 0.02);
  background: hsl(var(--background));
}

/* Modals */
.modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 100;
  background: hsl(0 0% 0% / 0.4);
  backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  animation: fadeIn 0.2s ease;
}
@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }

.modal-card {
  width: 100%;
  max-width: 520px;
  background: hsl(var(--card)) !important;
  border: 1px solid hsl(var(--border) / 0.5);
  border-radius: var(--radius-xl);
  padding: 32px;
  box-shadow: 0 32px 96px -16px hsl(0 0% 0% / 0.3), inset 0 1px 0 0 hsl(0 0% 100% / 0.05);
  animation: modalSlideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}
.modal-card-full { max-width: 800px; }
@keyframes modalSlideIn {
  from { opacity: 0; transform: translateY(20px) scale(0.95); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}

/* Login Screen */
.login-screen {
  min-height: 100dvh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: radial-gradient(circle at center, hsl(var(--primary) / 0.15) 0%, transparent 60%), hsl(var(--background));
  padding: 24px;
}
.login-card {
  width: 100%;
  max-width: 400px;
  background: hsl(var(--card) / 0.7);
  backdrop-filter: blur(32px) saturate(200%);
  border: 1px solid hsl(var(--border) / 0.5);
  border-radius: var(--radius-xl);
  padding: 40px;
  box-shadow: 0 32px 96px -16px hsl(0 0% 0% / 0.2), inset 0 1px 0 0 hsl(0 0% 100% / 0.1);
}
.login-orb {
  width: 80px;
  height: 80px;
  border-radius: 50%;
  background: linear-gradient(135deg, hsl(var(--primary)), hsl(193 84% 20%));
  margin: 0 auto 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 0 40px hsl(var(--primary) / 0.4), inset 0 4px 12px hsl(0 0% 100% / 0.4);
}

/* Empty States */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 48px 24px;
}
.empty-symbol {
  width: 64px;
  height: 64px;
  border-radius: 24px;
  background: hsl(var(--foreground) / 0.05);
  color: hsl(var(--muted-foreground));
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 16px;
  box-shadow: inset 0 2px 8px hsl(0 0% 0% / 0.1);
}

/* Custom Scrollbar */
::-webkit-scrollbar { width: 8px; height: 8px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: hsl(var(--border)); border-radius: 4px; }
::-webkit-scrollbar-thumb:hover { background: hsl(var(--muted-foreground) / 0.5); }
`;

css = css + '\n' + newStyles;
fs.writeFileSync('artifacts/sales-manager/src/index.css', css);
