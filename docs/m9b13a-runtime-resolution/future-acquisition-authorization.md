# Inactive exact future acquisition authorization

The following text is a prospective authorization object. It is **not active**.
It may become authority only if a later user instruction reproduces it
byte-for-byte and explicitly activates it after verifying the committed M9b.13a
checksum manifest.

```text
M9B13A-OCI-ACQUISITION-AUTHORIZATION-v1

Authorize exactly one runtime acquisition under
lachesis-m9b13a-oci-acquisition-protocol/1 as reviewed by
lachesis-m9b13a-runtime-requirement-review@1.0.0 with protocol-file SHA-256
671ab4a064be4db18a869cf7dfaa514b3f6b316c198c29ff9e80a53a0ce01135.
This authorization does not alter the preserved
m9b13-materialization-readiness-no-go decision and does not authorize
materialization.

Acquire only the Docker Official Image source
docker.io/library/node:24.18.1-bookworm-slim after read-only resolution proves
that the tag still resolves to OCI index
sha256:235600a8101ab264e117b1768e925532262668dc9b581ef1dd7d96ced463b8e7.
Acquire only platform linux/arm64/v8, platform manifest
sha256:c39335f45d6d5b2a5be95b0f1a63e57cca4e9e36cc69b313c1ad5472b13a1e3,
and its attestation manifest
sha256:f3c062ad822adadf8f41d1bfaa2a25cce3fd81800fc2a2cf2264307b8c77ae23.
No mutable tag may be executed, imported, or treated as identity. No other
platform, image, base, layer, or historical image may be substituted or reused.

Permit outbound TLS only to auth.docker.io, registry-1.docker.io,
production.cloudflare.docker.com, api.github.com, raw.githubusercontent.com,
and nodejs.org. Permit no account credential. The only authentication material
permitted is an ephemeral anonymous Docker Registry challenge token held in
memory, never mounted, persisted, or logged. Any redirect to an unlisted host
must stop the operation before that request.

Download exactly the index, selected platform manifest, image config
sha256:1c261b8cd71d78fcdc0507b08bc7156a29785b92f0d3496861455a598bcc042d,
and image layers
sha256:53bb9e501f1803aca595be8d902a62cea6bf4d996ce6f7dfe16c1c97be343e6c,
sha256:ab40f635d656bc78edba5f9d146f84446f9726581f8b6d0107bb4829aaa20f4a,
sha256:78c0f71ad86cbdcf4792fbde7c7ad8ed4ec0d0928e23304150f912fc28e8f7a3,
sha256:8055ce4d148bba236fda7c9bcd5eee50b7f1459ee71e6dadcd6c4583373b3618,
and sha256:1930f839b9269e060fc3b6e12831c0cf685409855d3b2c80accf5bfa561da2c1.
Download the selected attestation manifest, attestation config
sha256:eaa2172dacb9b1759f08a5c09e17877017373536a23f5a0ca1abeb68b8355d50,
SPDX predicate
sha256:582f962d2a1af162c7927de3b356d08961575a2b32aee3b39ea733f5b5ce919c,
SLSA v0.2 predicate
sha256:792f6e366cff5fff17d77e82eb8b3e52e37b7f83ee3f80cf0036ff439baa9b15,
GitHub commit metadata for
53252eea9caacaa50bdf58f4d34f0bff8d259999, that commit's
24/bookworm-slim/Dockerfile, and Node v24.18.1 SHASUMS256.txt.asc. Do not
download a Node binary separately. The complete registry image-and-attestation
payload must not exceed 100000000 bytes.

Use an empty isolated Docker data root and an empty output root. Enforce
directory mode 0700, file mode 0600, regular files only, no symlinks, no
worktree or repository-history mount, no credential mount, and no corpus or
study-role mount. Resolve first, verify every received size and SHA-256 before
use, pull only the platform manifest by digest, and export exactly one image
archive. Write only beneath
/Users/paul/orgs/nicia/lachesis-private/m9b13a-runtime-acquisition/v1/docker.io/library/node/24.18.1-bookworm-slim/linux-arm64-v8.
The exported archive must not exceed 512000000 bytes. Record its SHA-256, byte
size, complete regular-file inventory, OCI manifests, source evidence,
provenance, SBOM, and an acquisition receipt using atomic writes.

Verify that both in-toto statements bind the selected platform manifest;
validate the SLSA builder, build type, materials, source commit, and immutable
Debian base; validate the SPDX document and image coverage; verify the GitHub
commit signature; verify the Dockerfile Git blob
afcf773d35c32bb03a527e89813deb7f1af6f8d3 and file SHA-256
bd6bb06de21f22916d8e582ccd43722889f8788a5699f2a099296707c2c57e52;
and verify the Node OpenPGP-signed checksum manifest under the frozen Node
release-key policy. Record that no standalone OCI image signature was
established by M9b.13a. If an already approved offline malware or secret
scanner is available, scan the archive and record its immutable tool and result
identities; do not install or download a scanner under this authorization.

Remove network access before verification import. Import the archive into a
second empty isolated offline Docker data root by digest and verify its
platform, manifest, config, layer inventory, Node version, and Debian bookworm
identity without running it. Do not run the image or begin the compatibility
campaign under this authorization.

Stop and quarantine all outputs on any digest, size, subject, provenance, SBOM,
signature, platform, source, base, archive, permission, symlink, inventory,
redirect, credential, network, or scanner finding mismatch; on any incomplete
receipt; or on any attempt to access unlisted material. Stop after sealed
archive creation, offline import verification, and receipt generation for
independent review.

This authorization permits zero corpus documents, source acquisition for the
study, gold artifacts, cases, packets, schedules, random seeds, operational
identities, authority stores, provider/model calls, study-role launches,
analysis runs, OSF mutations, public artifacts, pushes, and image executions.
END-M9B13A-OCI-ACQUISITION-AUTHORIZATION-v1
```
