const fs = require('fs');
let css = fs.readFileSync('artifacts/sales-manager/src/index.css', 'utf-8');

// Replace the aggressive selector
css = css.replace(/h1, h2, h3, p, span, div \{\s*text-align: right;\s*\}/g, `
h1, h2, h3, h4, h5, h6, p, ul, ol, li { text-align: right; }
.metric-card * { text-align: right !important; }
`);

fs.writeFileSync('artifacts/sales-manager/src/index.css', css);
