const fs = require('fs');
let css = fs.readFileSync('artifacts/sales-manager/src/index.css', 'utf-8');

const forcedStyles = `
/* Ops State */
#root .ops-state {
  display: flex !important;
  flex-direction: column !important;
  align-items: center !important;
  justify-content: center !important;
  text-align: center !important;
  padding: 48px 24px !important;
  background: hsl(var(--card) / 0.6) !important;
  backdrop-filter: blur(24px) saturate(180%);
  border: 1px dashed hsl(var(--border) / 0.5) !important;
  border-radius: var(--radius-lg) !important;
  box-shadow: inset 0 2px 12px hsl(0 0% 0% / 0.02) !important;
  min-height: 240px !important;
}

#root .ops-state > svg {
  width: 48px !important;
  height: 48px !important;
  color: hsl(var(--muted-foreground)) !important;
  margin-bottom: 16px !important;
  opacity: 0.5 !important;
}

#root .ops-state strong {
  font-size: 16px !important;
  font-weight: 800 !important;
  color: hsl(var(--foreground)) !important;
  margin-bottom: 8px !important;
}

#root .ops-state p {
  font-size: 13px !important;
  color: hsl(var(--muted-foreground)) !important;
  max-width: 400px !important;
  line-height: 1.6 !important;
  text-align: center !important;
}

#root .ops-state .button {
  margin-top: 24px !important;
}

/* Avatar spacing fix for sidebar */
#root .sidebar-bottom .avatar {
  margin-left: 0 !important; 
  flex-shrink: 0 !important;
}

#root .sidebar-bottom .min-w-0 {
  margin-right: 12px !important;
}
`;

fs.appendFileSync('artifacts/sales-manager/src/index.css', forcedStyles);
