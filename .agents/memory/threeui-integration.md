---
name: ThreeUI integration
description: Installation and runtime constraints for using ThreeUI in the Pulse frontend.
---

ThreeUI belongs only to the web artifact that owns the visual surface, and it should be progressively enhanced: every WebGL accent needs a reduced-motion path, a WebGL capability fallback, and must not carry operational data.

**Why:** The app is a data-dense RTL operations panel, so a 3D effect must add product identity without making tables, forms, or public subscription actions fragile or unreadable.

**How to apply:** Import the package stylesheet once at the frontend entrypoint, use only verified package exports, and install workspace dependencies with a package filter rather than adding them to the monorepo root.