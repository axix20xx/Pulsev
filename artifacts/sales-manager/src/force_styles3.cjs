const fs = require('fs');
let css = fs.readFileSync('artifacts/sales-manager/src/index.css', 'utf-8');

const forcedStyles = `
/* Metric Card Alignment Fixes */
#root .metric-card {
  align-items: flex-start !important;
  text-align: right !important;
}

#root .metric-card > * {
  width: 100%;
}

#root .metric-icon {
  margin-right: 0 !important;
  margin-left: auto !important;
}

/* Fix sidebar text alignment */
.pulse-sidebar .side-link {
  text-align: right;
  justify-content: flex-start;
}

/* Status Pill Polish */
#root .status-pill {
  padding: 6px 12px !important;
  border-radius: 99px !important;
  font-size: 11px !important;
  font-weight: 800 !important;
  display: inline-flex !important;
  align-items: center !important;
  gap: 6px !important;
  border: 1px solid transparent !important;
}
#root .status-pill.active, #root .status-pill.completed, #root .status-pill.paid { color: hsl(154 60% 35%) !important; background: hsl(154 60% 92%) !important; border-color: hsl(154 60% 80% / 0.5) !important; }
#root .status-pill.pending, #root .status-pill.expiring { color: hsl(35 91% 35%) !important; background: hsl(35 91% 94%) !important; border-color: hsl(35 91% 80% / 0.5) !important; }
#root .status-pill.offline, #root .status-pill.expired, #root .status-pill.disabled, #root .status-pill.refunded { color: hsl(0 84% 45%) !important; background: hsl(0 84% 96%) !important; border-color: hsl(0 84% 85% / 0.5) !important; }

/* Global typography */
h1, h2, h3, p, span, div {
  text-align: right;
}
.text-center { text-align: center !important; }
.text-left { text-align: left !important; }
`;

fs.appendFileSync('artifacts/sales-manager/src/index.css', forcedStyles);
