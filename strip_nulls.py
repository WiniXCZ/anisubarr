#!/usr/bin/env python3
"""Strip null bytes from Python source files (CIFS write cache artifact)."""
import os, sys

def strip_nulls(root="backend"):
    fixed = []
    for dirpath, _, files in os.walk(root):
        for f in files:
            if f.endswith(".py"):
                path = os.path.join(dirpath, f)
                data = open(path, "rb").read()
                if b"\x00" in data:
                    open(path, "wb").write(data.replace(b"\x00", b""))
                    fixed.append(path)
    if fixed:
        print(f"Stripped null bytes from {len(fixed)} file(s):")
        for p in fixed: print(f"  {p}")
    else:
        print("No null bytes found.")
    return fixed

if __name__ == "__main__":
    strip_nulls()
