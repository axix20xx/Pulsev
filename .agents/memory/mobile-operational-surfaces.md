---
name: Mobile operational surfaces
description: Responsive rules for dense report and operations views in the RTL sales panel.
---

Dense operational views must be designed as readable phone surfaces, not desktop grids shrunk into a narrow viewport. At phone widths, summaries need a deliberate minimum touch/read height, section hierarchy needs normal page typography, and tables should become labeled record cards when possible. Any fixed five-item bottom navigation requires a page-level safe-area reserve so the last content remains reachable.

**Why:** The initial responsive pass removed some horizontal overflow but still left the operations page visually tiny and allowed the fixed navigation to compete with the final finance content.

**How to apply:** When adding or changing report-like pages, test at roughly 360–480px and 768px, verify text and actions remain readable, use `data-label`/card treatment for dense rows, and keep bottom padding owned by the page plus the shared mobile navigation safe area.