#!/usr/bin/env python3
"""Adapt AmneziaWG's HTTP/2 memory patch to the Go toolchain used by Xcode."""

from difflib import unified_diff
from pathlib import Path
import re
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
    http_source_root = goroot / "src/net/http"
    patch_path = source_dir / "goruntime-http2-request-body-scratch-32k.diff"
    function_pattern = re.compile(
        r"func\s*\([^)]*\)\s*frameScratchBufferLen\s*\([^)]*\)\s*int\s*\{"
    )

    if not patch_path.is_file():
        print(f"error: expected AmneziaWG patch not found at {patch_path}", file=sys.stderr)
        return 1

    if not http_source_root.is_dir():
        print(
            f"error: Go net/http source directory not found at {http_source_root}",
            file=sys.stderr,
        )
        return 1

    patches = []
    found_function = False
    already_patched = False
    for go_source_path in http_source_root.rglob("*.go"):
        original = go_source_path.read_text(encoding="utf-8")
        matches = list(function_pattern.finditer(original))
        if not matches:
            continue

        found_function = True
        relative_path = go_source_path.relative_to(goroot).as_posix()
        patched = original
        for match in reversed(matches):
            start = match.start()
            end = original.find("\n}", match.end())
            if end < 0:
                print(
                    f"error: could not find the end of the scratch-buffer function "
                    f"in {go_source_path}",
                    file=sys.stderr,
                )
                return 1

            function = original[start : end + 2]
            if "const max = 32 << 10" in function:
                already_patched = True
                continue
            if "const max = 512 << 10" not in function:
                print(
                    f"error: unexpected HTTP/2 scratch-buffer limit in {go_source_path}; "
                    "review before building.",
                    file=sys.stderr,
                )
                return 1

            patched_function = (
                function.replace("const max = 512 << 10", "const max = 32 << 10", 1)
                .replace("512KB", "32KB")
                .replace("512K", "32K")
            )
            patched = patched[:start] + patched_function + patched[end + 2 :]

        if patched != original:
            patches.append(
                "".join(
                    unified_diff(
                        original.splitlines(keepends=True),
                        patched.splitlines(keepends=True),
                        fromfile=f"a/{relative_path}",
                        tofile=f"b/{relative_path}",
                    )
                )
            )

    if not found_function:
        print(
            "error: frameScratchBufferLen was not found in the installed Go net/http sources.",
            file=sys.stderr,
        )
        return 1

    patch = "".join(patches)
    if not patch:
        patch_path.unlink()
        print(
            "Go already uses the 32 KiB HTTP/2 request-body buffer."
            if already_patched
            else "No HTTP/2 patch is needed."
        )
        return 0

    patch_path.write_text(patch, encoding="utf-8")
    print(f"Generated the 32 KiB HTTP/2 patch for {len(patches)} Go source file(s).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
