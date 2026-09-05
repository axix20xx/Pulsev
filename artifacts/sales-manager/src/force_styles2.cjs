const fs = require('fs');
let css = fs.readFileSync('artifacts/sales-manager/src/index.css', 'utf-8');

const forcedStyles = `
/* Hide broken pseudo-elements from legacy CSS */
#root .login-card::before, #root .login-card::after { display: none !important; }
#root .login-orb::before, #root .login-orb::after { display: none !important; }
#root .login-card .login-orb { min-height: 72px !important; }

/* Force correct height for buttons */
#root .button-primary { height: 42px !important; border-radius: var(--radius-md) !important; font-size: 13px !important; font-weight: 700 !important; }
`;

fs.appendFileSync('artifacts/sales-manager/src/index.css', forcedStyles);
