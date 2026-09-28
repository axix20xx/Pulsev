---
name: Hostinger runtime boundary
description: Hostinger Web App deployments and a user's VPS SSH session can be separate machines.
---

Do not treat localhost probes or process lists from an SSH session as evidence about a Hostinger Web App until that shell can see the active Web App release directory.

**Why:** An SSH shell could not see the managed Web App's release path or API child even while the Web App's own startup log reported it running. The shell's refused connection was therefore unrelated to the app's internal connection failure.

**How to apply:** Check whether the active release path from the Web App log exists in the shell first. If it does not, use diagnostics emitted from inside the deployed app or obtain access to that specific runtime instead of repeatedly probing from the VPS.