#!/usr/bin/env python3
"""Adapt AmneziaWG's HTTP/2 memory patch to the Go toolchain used by Xcode."""

from difflib import unified_diff
from pathlib import Path
import sys


def main() -> int:
    if len(sys.argv) != 3:
        print(
            "usage: prepare-amneziawg-go-patch.py <GOROOT> <WireGuardKitGo source>",
            file=sys.stderr,
        )
        return 2

    goroot = Path(sys.argv[1])
    source_dir = Path(sys.argv[2])
    go_source_path = goroot / "src/net/http/internal/http2/transport.go"
    patch_path = source_dir / "goruntime-http2-request-body-scratch-32k.diff"
    function_header = (
        "func (cs *clientStream) frameScratchBufferLen(maxFrameSize int) int {"
    )

    if not go_source_path.is_file():
        print(f"error: Go HTTP/2 source not found at {go_source_path}", file=sys.stderr)
        return 1
    if not patch_path.is_file():
        print(f"error: expected AmneziaWG patch not found at {patch_path}", file=sys.stderr)
        return 1

    original = go_source_path.read_text(encoding="utf-8")
    start = original.find(function_header)
    if start < 0:
        print(
            "error: Go HTTP/2 scratch-buffer function changed; review the AmneziaWG patch.",
            file=sys.stderr,
        )
        return 1

    end = original.find("\n}", start)
    if end < 0:
        print(
            "error: could not find the end of Go's HTTP/2 scratch-buffer function.",
            file=sys.stderr,
        )
        return 1

    function = original[start : end + 2]
    if "const max = 32 << 10" in function:
        patch_path.unlink()
        print("Go already uses the 32 KiB HTTP/2 request-body buffer.")
        return 0

    if "const max = 512 << 10" not in function:
        print(
            "error: Go's HTTP/2 scratch-buffer limit is neither 512 KiB nor 32 KiB; "
            "review before building.",
            file=sys.stderr,
        )
        return 1

    patched_function = (
        function.replace("const max = 512 << 10", "const max = 32 << 10", 1)
        .replace("512KB", "32KB")
        .replace("512K", "32K")
    )
    patched = original[:start] + patched_function + original[end + 2 :]
    patch = "".join(
        unified_diff(
            original.splitlines(keepends=True),
            patched.splitlines(keepends=True),
            fromfile="a/src/net/http/internal/http2/transport.go",
            tofile="b/src/net/http/internal/http2/transport.go",
        )
    )
    if not patch:
        print("error: generated an empty Go HTTP/2 patch.", file=sys.stderr)
        return 1

    patch_path.write_text(patch, encoding="utf-8")
    print("Generated the 32 KiB HTTP/2 patch for the active Go toolchain.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
