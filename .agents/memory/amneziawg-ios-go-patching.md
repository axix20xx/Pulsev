---
name: AmneziaWG iOS Go patching
description: Keep the AmneziaWG Go bridge build compatible with the selected Xcode worker toolchain.
---

The iOS Go backend copies upstream Go sources into Xcode-derived build outputs. Make the temporary module copy writable before `go mod tidy`. Runtime diffs can become stale between Go patch releases, and installed Go distributions may bundle HTTP/2 into `net/http` rather than include the repository's `internal/http2` path. Locate the active function in the selected `GOROOT` before applying changes.

**Why:** The CI worker exposed both read-only permissions preserved by the source copy and an upstream HTTP/2 patch that no longer matched the installed Go source.

**How to apply:** When changing Go or macOS runner versions, validate every runtime patch against the selected Go source. Apply generated changes only to copied build sources, skip a patch only when its desired change is already present, and fail clearly on unknown source layouts.
