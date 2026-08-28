# Threat-model boundary

The accepted deployment assumption is a trusted, controlled macOS host with no
malicious same-UID process. The implementation protects against accidental
races, stale processes, crashes, symlinks, hardlinks, rename/swap mistakes,
truncation, torn writes, malformed records, and executable replacement detected
at the wrapper's pre/post boundaries.

The helper is executed by a checksum-bound pathname because macOS does not offer
the accepted inherited-descriptor execution path. The wrapper binds the source,
normalized executable bytes, build tools, and the executable's device/inode,
then checks hash and identity immediately before invocation and after
completion. Replacement while the process is executing is returned as ambiguous
because the ledger effect may already have committed.

This does not claim resistance to a malicious same-UID process capable of
ptracing processes, replacing path components between arbitrary instructions,
altering both ledger bytes and an external activation receipt, manipulating the
compiler/toolchain, or continuously racing the pre-exec pathname. Those powers
violate the trusted-host assumption. A later activation must bind the expected
session, sequence, root, namespace identity, log identity, helper identity, and
implementation identity; audit with that expectation rejects rollback.

Root-owned system ancestors are accepted only when they are non-writable or
sticky. The immediate campaign parent, namespace, and log must be owned by the
effective user. The parent and namespace are mode 0700; the log and helper are
mode 0600 and 0700 respectively. The helper refuses unexpected owners, types,
modes, symlinks, and link counts.
