# M9b.13d independent review

Reviewed commit: `ad60ce42813c265316859e118efd23f5eb8d5a01`.

Reviewed tree: `3dc116c6746fb419bf52cd8d6e3e69206eacb72a`.

Reviewed manifest:
`9ff0b8cfb95cb69b8f9a2b01dff21bffa69904964758a6e0b4c85b5e98eb4fda`.

Submitted decision:
`m9b13d-offline-dependency-closure-ready-for-independent-review`.

Independent-review decision: `m9b13d-offline-dependency-closure-review-no-go`.

Disposition:
`superseded-unexecuted-descriptor-and-consumption-bindings-incomplete`.

The checksum, predecessor, offline-build, test, and zero-effect claims
reproduce, but seven implementation defects are blocking. The same-UID attacker
used below is within the submitted threat model and is not downgraded to a
cross-UID or directory-only attacker.

## Blocking findings

1. **The verified temporary file can be swapped before publication**

   - Severity: Critical
   - Confidence: High
   - Source:
     `packages/generator-ai-sdk/internal/native/m9b13d-filesystem-helper.c`,
     lines 585–638, especially the descriptor close at line 626 and subsequent
     pathname rename at line 635.
   - The helper validates the digest and metadata through `file_fd`, fsyncs it,
     closes it, and only then renames the directory entry named by `temporary`.
     No `fstatat(..., AT_SYMLINK_NOFOLLOW)` comparison binds that entry to the
     verified descriptor immediately before publication, and no retained
     descriptor is checked after publication.
   - A same-UID process can rename `.m9b13d.tmp.1` away after the close, create
     a different regular `0600` file under that name, and cause `BAD` to be
     published and sealed. `RENAME_EXCL` protects only the final-name collision;
     it does not authenticate the source entry.

2. **Verified OCI blobs are reopened through mutable pathnames**

   - Severity: Critical
   - Confidence: High
   - Source:
     `packages/generator-ai-sdk/internal/m9b13d-oci-inventory-scanner.ts`, lines
     196–250, 383–508, and 728–818.
   - `verifyDescriptor` hashes `createReadStream(path)` and returns the
     pathname. Manifest and config parsing then call `readStrictRegularFile` on
     that path. Every layer is opened once for compressed verification, again
     for diff-id hashing, and again for tar parsing. Identity is neither
     retained nor rechecked across those opens.
   - Same-path replacement, rename exchange, unlink/recreate, or same-inode
     mutation can therefore make parsing consume bytes other than the bytes
     whose descriptor digest passed.

3. **The exact `linux/arm64/v8` platform and frozen manifest are not enforced**

   - Severity: High
   - Confidence: High
   - Source:
     `packages/generator-ai-sdk/internal/m9b13d-oci-inventory-scanner.ts`, lines
     57–109 and 748–800.
   - The descriptor schema admits `amd64` or `arm64`, omits `variant`, and makes
     `platform` optional. Selection requires only one descriptor and the image
     manifest media type. It does not require index digest
     `sha256:235600a8101ab264e117b1768e925532262668dc9b581ef1dd7d96ced463b8e7`
     or selected manifest digest
     `sha256:c39335f45d6d5b2a5be95b0f1a63e57cca4e9e36cc69b313c1ad5472b13a1e3`.
     Config architecture also accepts `amd64`.
   - An omitted platform, alternate ARM variant, wrong OS/architecture encoded
     through a self-consistent object, or a different single manifest can pass.

4. **Arbitrary text can impersonate the Node executable**

   - Severity: Critical
   - Confidence: High
   - Source:
     `packages/generator-ai-sdk/internal/m9b13d-oci-inventory-scanner.ts`, lines
     375–381 and 673–702.
   - The scanner records only that `usr/local/bin/node` has virtual kind `file`.
     It captures no binary bytes, mode, ELF structure, or digest. Version comes
     solely from caller-controlled `node_version.h` macros.
   - A one-byte or text file plus a matching header is accepted as Node. There
     is no binding to OpenPGP-verified Node release evidence or to the exact
     Node 24.18.1 Linux arm64 archive and extracted binary.

5. **Trailing and concatenated tar content is accepted**

   - Severity: High
   - Confidence: High
   - Source:
     `packages/generator-ai-sdk/internal/m9b13d-oci-inventory-scanner.ts`, lines
     383–485, especially the break after the second zero block at lines 403–406.
   - Tar parsing returns immediately after two terminal zero blocks. It does not
     drain the decompressed stream, require EOF, validate a frozen zero-padding
     policy, reject a partial trailing block, or account trailing bytes against
     ceilings.
   - Arbitrary nonzero suffixes and a second concatenated tar archive are
     ignored by semantic inventory derivation.

6. **Helper execution and acquired evidence identities are
   caller-substitutable**

   - Severity: Critical
   - Confidence: High
   - Source:
     `packages/generator-ai-sdk/internal/m9b13d-synthetic-integration.ts`, lines
     44–53 and 136–240.
   - Integration reads and hashes `helperPath`, then later executes the same
     replaceable pathname at lines 175–186. Pre-spawn pathname hashing does not
     bind the bytes loaded by the kernel.
   - `attachedSpdx` is caller input and is compared directly at lines 225–228.
     The receipt omits frozen index, manifest, attestation, provenance, config,
     ordered layer, Node archive/binary, descriptor-map, scanner, helper,
     inventory, and comparison identities. A self-consistently re-signed
     substitution can select the asserted SPDX and manifest identities.

7. **The durable root seal precedes terminal input-framing validation**

   - Severity: Critical
   - Confidence: High
   - Source:
     `packages/generator-ai-sdk/internal/native/m9b13d-filesystem-helper.c`,
     lines 652–694 and 726–796, especially `seal_transaction` at line 739 and
     the later EOF probe at line 740.
   - The helper durably creates and fsyncs `.m9b13d-sealed` before checking for
     trailing commands or bytes. On a post-terminal command it reports failure
     but leaves an accepted-looking seal on disk. Missing EOF, duplicate
     terminal commands, delayed input, and interrupted framing are not made
     structurally impossible before the final mutation.

## Reproduced exploit

The review built the frozen helper twice with the submitted Xcode compiler, SDK,
and flags, confirmed executable digest
`60a81ccf7658b1a7a91d9dbee7d1ca63840a4751597319139d65f0a0a1536fd7`, then ran
this deterministic same-UID sequence against one helper process:

1. Send a valid `FILE` frame for `target` containing `GOOD`, with the SHA-256
   digest of `GOOD`.
2. Wait until `output/.m9b13d.tmp.1` exists, then finish the content frame.
3. Poll until the helper closes its descriptor (an exclusive nonblocking
   advisory lock on the temporary inode succeeds); before publication, rename
   the verified entry to `.reviewer-good`.
4. Create a new regular `0600` `.m9b13d.tmp.1` containing `BAD`.
5. Send `SEAL` and EOF.

The frozen helper exited successfully, reported `"status":"sealed"`, published
`output/target` containing exactly `BAD`, and created an accepted
`.m9b13d-sealed`. The exploit uses neither symlinks nor another UID; it replaces
the unchecked source directory entry during the close-to-rename window.

The existing hostile suite does not cover this window. Its parent/destination
replacement cases recheck directory identities, while the vulnerable temporary
entry is never compared with the now-closed verified descriptor.

## Independent disposition

The reviewed M9b.13d artifacts remain immutable evidence of a failed review.
They must not be reinterpreted or rewritten. A later append-only correction must
retain verified temporary descriptors through publication and consumption,
provide real descriptor-bound OCI scanning and helper execution on the pinned
host, freeze platform and acquired evidence identities, validate Node as the
trusted release binary, reject tar suffixes, and validate all input framing
before the final seal.

M9b remains `m9b13-materialization-readiness-no-go`. No acquisition
authorization is issued or executed.

## Review effects

- Network calls: 0
- Downloads or package installations: 0
- OCI pulls, imports, builds, or runs: 0
- Real acquisition roots created: 0
- Corpus or gold accesses: 0
- Credential accesses: 0
- Provider or model calls: 0
- OSF mutations or publications: 0
- Pushes: 0
- M9b executions: 0
- M10 work: 0
