const fs = require('fs');
let css = fs.readFileSync('artifacts/sales-manager/src/index.css', 'utf-8');

css = css.replace(/\.sidebar-bottom \{ position: absolute; right: 16px; bottom: 20px; left: 16px; \}/g, '');

const forcedStyles = `
/* Remove absolute positioning from sidebar-bottom */
#root .sidebar-bottom {
  position: relative !important;
  right: auto !important;
  bottom: auto !important;
  left: auto !important;
  margin-top: auto !important;
  width: 100% !important;
}

#root .topbar-search-wrap kbd {
  display: flex !important;
}

/* Beautiful custom scrollbars */
::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: hsl(var(--border)); border-radius: 10px; }
::-webkit-scrollbar-thumb:hover { background: hsl(var(--primary) / 0.5); }
`;

fs.appendFileSync('artifacts/sales-manager/src/index.css', forcedStyles);
