# M8b.2a debug and root-cause record

## Stage 6 prospective-audit boundary

Stage 6 packed only the private CLI. Its external consumer then resolved the
CLI's `workspace:*` dependencies as published alpha.3 packages. The resulting
exercise was valid backward API compatibility evidence, but it could not test
the post-alpha.3 canonicalization and strict JSON-boundary corrections in the
kernel, evidence, or generator.

M8b.2a corrects the boundary by deterministically packing all six packages from
one source tree, overriding the complete Lachesis dependency closure to those
local artifacts, rejecting registry fallback, and verifying both tarball and
installed content identities. A separate alpha.3 pairing remains explicitly
compatibility-only.

During development, direct package packing also exposed ordering instability in
the generated evidence-typegraph package manifest: a third raw pack could order
dependency keys differently. The corrected harness uses the same deterministic
staged-manifest approach as audited release preparation: it copies only each
package's declared `files` allowlist, sorts dependency keys while replacing
workspace ranges with exact bound versions, and then requires three
byte-identical npm packs. Package source and metadata are not changed by this
test-only staging step.

## M2 timeout

The M2 pool-exhaustion test used a full held-out campaign merely to reach an
exhaustion boundary. The OpenAI pool admitted 108 calls, producing 216
reserve/settle events. The durable ledger deliberately re-reads and
cryptographically validates its complete history after every append, so the
fixture multiplied that integrity work under default worker contention.

The correction keeps the full production ledger path and derives the unchanged
322,880-micro-dollar per-call bound. It creates a valid digest-rebound test
campaign with a 968,640-micro-dollar provider cap, proves three successful
conservative settlements and exact accounting, then proves the fourth
reservation fails. The five-second timeout and all semantic assertions remain.

## M3b.1 incidental timing finding

The first repeated-gate attempt found a distinct 20-second timeout in the M3b.1
identity test. That integration test constructs the complete historical held-out
schedule; three isolated measurements were 9.27, 8.99, and 8.68 seconds. Under
default worker contention it reached 20.03 seconds.

Unlike M2, reducing this fixture would remove the held-out identity and
preflight assertions. M8b.2a therefore retained the fixture and assertions and
changed only that test's local integration ceiling to 30 seconds. Production
behavior is unchanged.

## Historical checksum commands

The alpha.3 and Stage 5.1 checksum manifests are immutable snapshots, not
current-tree assertions. Both included files that were later changed under
separate authorization. Raw `shasum -c` therefore compared different epochs. The
existing historical verifier now requires the current manifest bytes to equal
the bound commit's manifest, then reads and verifies every listed artifact from
that commit. This preserves later authorized workflow and root-script changes
without weakening historical integrity.
