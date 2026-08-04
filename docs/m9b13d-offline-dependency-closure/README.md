# M9b.13d offline dependency closure

M9b.13d is a private, offline-only dependency milestone. It preserves M9b.13c
and addresses only its two accepted dependency blockers: independent OCI
package-inventory derivation and race-resistant destination mutation.

No acceptable third-party OCI scanner is present in the local executable,
workspace, or pnpm-store closure. The selected scanner class is therefore a
private purpose-built deterministic inventory scanner. It is not a vulnerability
scanner and does not establish that an image is safe.

The acquisition host has a local Apple Clang toolchain and Darwin descriptor-
relative filesystem primitives. The selected helper design is a small pinned C
program using `openat`, `mkdirat`, `fstatat`, `unlinkat`, `O_NOFOLLOW`,
`O_CREAT`, `O_EXCL`, and `renameatx_np(RENAME_EXCL)`. It owns the destination
descriptor for the complete mutation transaction.

This namespace does not authorize acquisition or activate the withheld M9b.13c
authorization. Only synthetic OCI layouts and disposable synthetic filesystem
roots may be used. A final readiness decision requires executable hostile tests,
separate-process races, reproducible native builds, and an append-only checksum
seal.
