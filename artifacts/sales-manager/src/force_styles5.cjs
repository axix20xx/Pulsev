const fs = require('fs');
let css = fs.readFileSync('artifacts/sales-manager/src/index.css', 'utf-8');

const forcedStyles = `
/* Ops Status Pills */
#root .ops-status {
  padding: 6px 12px !important;
  border-radius: 99px !important;
  font-size: 11px !important;
  font-weight: 800 !important;
  display: inline-flex !important;
  align-items: center !important;
  gap: 6px !important;
  border: 1px solid transparent !important;
}
#root .ops-status i { display: none !important; }
#root .ops-status::before { content: ''; width: 4px; height: 4px; border-radius: 50%; background: currentColor; opacity: 0.6; }
#root .ops-status.ok { color: hsl(154 60% 35%) !important; background: hsl(154 60% 92%) !important; border-color: hsl(154 60% 80% / 0.5) !important; }
#root .ops-status.warn { color: hsl(35 91% 35%) !important; background: hsl(35 91% 94%) !important; border-color: hsl(35 91% 80% / 0.5) !important; }
#root .ops-status.bad { color: hsl(0 84% 45%) !important; background: hsl(0 84% 96%) !important; border-color: hsl(0 84% 85% / 0.5) !important; }
#root .ops-status.neutral { color: hsl(var(--muted-foreground)) !important; background: hsl(var(--muted)) !important; border-color: hsl(var(--border)) !important; }

/* Pulse Mark Polish */
.pulse-mark {
  background: linear-gradient(135deg, hsl(var(--primary)), hsl(193 84% 20%)) !important;
  box-shadow: 0 4px 12px hsl(var(--primary) / 0.3) !important;
}
`;

fs.appendFileSync('artifacts/sales-manager/src/index.css', forcedStyles);
