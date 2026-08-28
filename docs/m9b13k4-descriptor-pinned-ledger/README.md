# M9b.13k.4 descriptor-pinned ledger feasibility

M9b.13k.4 is a narrow offline storage-mechanics milestone. It replaces the
M9b.13k.3 pathname-to-SQLite boundary with a minimal native append-log helper
and a typed TypeScript wrapper. It does not integrate the M9b controller.

The helper walks a private namespace without following symlinks, retains parent,
namespace, and log descriptors, pins device/inode/type/mode/link-count identity,
locks the retained log descriptor, validates the complete chain, applies stale
root CAS, appends one framed record, and synchronizes the log and directory.
Authoritative reads and writes never reopen the log through a pathname after
admission. Pathnames are used after admission only to verify that the retained
objects have not been renamed, unlinked, or replaced.

The TypeScript wrapper rejects duplicate JSON keys before kernel JSON parsing,
canonicalizes the synthetic payload, enforces size bounds, holds a
closure-private build capability, verifies helper bytes and inode before
execution, revalidates them after completion, and strictly parses bounded stdout
with no stderr.

This primitive is suitable only for independent read-only review. It supplies no
activation, credential, request, PUT, revocation, custodian,
terminal-scientific, or OSF authority. M9b remains NO-GO until a separately
authorized controller integration milestone succeeds.

The independently source/build-bound implementation identity is
`d52fadda1be127f610f838f12e7c361ad949d65e46c76e09e6e21e02ddca5ecf`. The
inventory is noncircular: it binds the build protocol and executable but
excludes its own bytes and the later checksum/package manifests.
