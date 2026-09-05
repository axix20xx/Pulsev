const fs = require('fs');
let css = fs.readFileSync('artifacts/sales-manager/src/index.css', 'utf-8');

// Strip out all the old conflicting themes that were appended at the end
// Actually let's just append super high specificity rules

const forcedStyles = `
/* =========================================================
   FORCED SPATIAL THEME OVERRIDES
   ========================================================= */

#root .login-screen {
  min-height: 100dvh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: radial-gradient(circle at center, hsl(var(--primary) / 0.08) 0%, transparent 70%), hsl(var(--background));
  padding: 24px;
}

#root .login-card {
  width: 100%;
  max-width: 420px;
  background: hsl(var(--card) / 0.8) !important;
  backdrop-filter: blur(48px) saturate(200%);
  border: 1px solid hsl(var(--border)) !important;
  border-radius: var(--radius-xl) !important;
  padding: 48px 40px !important;
  box-shadow: 0 32px 96px -16px hsl(0 0% 0% / 0.1), inset 0 1px 0 0 hsl(0 0% 100% / 0.5) !important;
  display: block;
  min-height: auto;
}

#root .pulse-surface-login > .surface-network {
  display: none !important; 
}

#root .login-orb {
  width: 72px !important;
  height: 72px !important;
  border-radius: 20px !important;
  background: linear-gradient(135deg, hsl(var(--primary)), hsl(193 84% 20%)) !important;
  margin: 0 auto 32px !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  box-shadow: 0 16px 40px -8px hsl(var(--primary) / 0.4), inset 0 2px 12px hsl(0 0% 100% / 0.3) !important;
}

#root .login-orb .pulse-mark {
  transform: scale(1.2);
}

#root .login-id-field {
  min-height: 52px !important;
  border-radius: var(--radius-lg) !important;
  background: hsl(var(--background)) !important;
  border: 1px solid hsl(var(--border)) !important;
  padding: 0 16px !important;
  box-shadow: inset 0 2px 4px hsl(0 0% 0% / 0.02) !important;
}

#root .login-id-field input {
  font-size: 16px !important;
  letter-spacing: 0.1em !important;
}

/* Make headers and text elegant */
h1, h2, h3, h4, h5, h6 {
  font-family: var(--font-serif) !important;
  letter-spacing: -0.03em !important;
}

#root .page-title {
  font-size: clamp(28px, 4vw, 36px) !important;
  font-weight: 800 !important;
  letter-spacing: -0.04em !important;
  color: hsl(var(--foreground)) !important;
  line-height: 1.1 !important;
}

#root .eyebrow {
  font-family: var(--font-mono) !important;
  letter-spacing: 0.1em !important;
  font-size: 11px !important;
  font-weight: 700 !important;
  color: hsl(var(--primary)) !important;
  text-transform: uppercase !important;
}

/* Force layout width and centering on main pages */
#root .page-wrap {
  width: 100% !important;
  max-width: 1440px !important;
  margin: 0 auto !important;
  padding: 40px 48px 120px !important;
}
@media (max-width: 768px) {
  #root .page-wrap { padding: 24px 20px 100px !important; }
}

/* Clean up status pills */
#root .status-pill {
  padding: 6px 12px !important;
  border-radius: 99px !important;
  font-size: 11px !important;
  font-weight: 700 !important;
  letter-spacing: 0.02em !important;
  display: inline-flex !important;
  align-items: center !important;
  gap: 6px !important;
  background: hsl(var(--background)) !important;
  border: 1px solid hsl(var(--border)) !important;
}
#root .status-pill.active, #root .status-pill.completed { color: hsl(154 60% 35%) !important; background: hsl(154 60% 95%) !important; border-color: hsl(154 60% 80%) !important; }
#root .status-pill.pending, #root .status-pill.expiring { color: hsl(35 91% 35%) !important; background: hsl(35 91% 95%) !important; border-color: hsl(35 91% 80%) !important; }
#root .status-pill.offline, #root .status-pill.expired { color: hsl(0 84% 45%) !important; background: hsl(0 84% 96%) !important; border-color: hsl(0 84% 85%) !important; }

/* Grid adjustments */
#root .metrics-grid {
  display: grid !important;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)) !important;
  gap: 16px !important;
}

#root .overview-grid, #root .lower-grid, #root .detail-grid {
  display: grid !important;
  gap: 20px !important;
}
@media (min-width: 1024px) {
  #root .overview-grid { grid-template-columns: 1.5fr 1fr !important; }
  #root .lower-grid { grid-template-columns: 1fr 1fr !important; }
  #root .detail-grid { grid-template-columns: 1fr 340px !important; }
}

/* Beautiful Table Wrappers */
#root .table-card {
  padding: 0 !important;
  overflow: hidden !important;
}
#root .panel-heading {
  padding: 24px 24px 16px !important;
  border-bottom: 1px solid hsl(var(--border) / 0.4) !important;
}
#root table th {
  background: hsl(var(--background) / 0.4) !important;
  padding: 14px 24px !important;
}
#root table td {
  padding: 16px 24px !important;
}
`;

fs.appendFileSync('artifacts/sales-manager/src/index.css', forcedStyles);
