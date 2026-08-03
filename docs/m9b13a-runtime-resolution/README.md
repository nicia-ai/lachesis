# m9b13a-existing-image-acquisition-ready-for-review

This append-only review finds that the registered M9b.12f protocol does **not**
require exactly Node `24.18.1`. That number appears in
`docs/m9b12f-preregistration/verification.json` as the runtime used to verify
the package. The package engines bind Node `>=24 <25`; the registered
operational text requires a future runtime/environment binding but does not name
a patch. M9b.13 therefore promoted verification metadata into an exact
prospective dependency without registered justification.

The correction does not make M9b.13 pass. Its preserved decision remains
`m9b13-materialization-readiness-no-go`. This review instead identifies one
exact official image that may be acquired only after separate activation of the
text in `future-acquisition-authorization.md`.

## Runtime derivation

The identity distinctions are:

- **Verification environment:** Node `24.18.1` records the host used for the
  M9b.12f verification run.
- **Package compatibility:** the root and four published package manifests
  accept Node `>=24 <25`.
- **Operational materialization:** a clean, digest-bound runtime is required
  before materialization, but the registered artifacts do not select a patch.
- **Scientific identity:** a compatible Node 24 patch does not by itself change
  the estimand, population, model boundary, retrieval mechanism, answer
  envelope, or evaluator.
- **Replay and security identity:** the exact patch, OS, architecture, OCI
  manifests, layers, native modules, provenance, SBOM, archive, and test receipt
  must receive prospective immutable identities.

Node `24.18.1` is nevertheless the selected prospective patch. It is an
[official Node.js LTS security release](https://nodejs.org/en/blog/release/v24.18.1),
and Node publishes an
[OpenPGP-signed checksum manifest](https://nodejs.org/dist/v24.18.1/SHASUMS256.txt.asc).
The selection is a new security/replay pin, not a reinterpretation of the
registration.

## Candidate and platform

| Field                        | Selected value                                                                                                                      |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Source                       | Docker Official Image `docker.io/library/node`                                                                                      |
| Tag used for resolution only | `24.18.1-bookworm-slim`                                                                                                             |
| OCI index                    | `sha256:235600a8101ab264e117b1768e925532262668dc9b581ef1dd7d96ced463b8e7`                                                           |
| Platform                     | `linux/arm64/v8`                                                                                                                    |
| Platform manifest            | `sha256:c39335f45d6d5b2a5be95b0f1a63e57cca4e9e36cc69b313c1ad5472b13a1e3`                                                            |
| Node                         | `24.18.1`                                                                                                                           |
| Distribution                 | [Debian GNU/Linux 12 (`bookworm`)](https://www.debian.org/releases/bookworm/), slim variant; exact image point release not asserted |
| Immutable base               | `debian:bookworm-slim@sha256:9b67294679b30e5d6ab257b40594feeb4a4b81f7fcf4131f4decf0d6a212a9b0`                                      |
| Image creation               | `2026-07-30T19:04:18Z`                                                                                                              |
| Tag update                   | `2026-07-30T20:40:41.339895Z`                                                                                                       |
| Source commit                | `53252eea9caacaa50bdf58f4d34f0bff8d259999`                                                                                          |
| Dockerfile blob              | `afcf773d35c32bb03a527e89813deb7f1af6f8d3`                                                                                          |
| Dockerfile SHA-256           | `bd6bb06de21f22916d8e582ccd43722889f8788a5699f2a099296707c2c57e52`                                                                  |
| Attestation manifest         | `sha256:f3c062ad822adadf8f41d1bfaa2a25cce3fd81800fc2a2cf2264307b8c77ae23`                                                           |
| SPDX predicate               | `sha256:582f962d2a1af162c7927de3b356d08961575a2b32aee3b39ea733f5b5ce919c`                                                           |
| SLSA v0.2 predicate          | `sha256:792f6e366cff5fff17d77e82eb8b3e52e37b7f83ee3f80cf0036ff439baa9b15`                                                           |

`linux/arm64/v8` is explicit. It was chosen because the reviewed Docker engine
is native `linux/aarch64`, the official index publishes a dedicated arm64/v8
manifest and attestations, and using `linux/amd64` here would add an unreviewed
emulation layer. Future use must remain native arm64/v8; platform fallback is a
new review, not client negotiation. This is a reasoned platform selection, not
implicit inheritance from a mutable client default.

The exact Dockerfile is bound to the
[signed source commit](https://github.com/nodejs/docker-node/commit/53252eea9caacaa50bdf58f4d34f0bff8d259999)
and
[immutable source path](https://github.com/nodejs/docker-node/blob/53252eea9caacaa50bdf58f4d34f0bff8d259999/24/bookworm-slim/Dockerfile).
The Docker Official Images program documents its
[review and publication model](https://docs.docker.com/docker-hub/repos/manage/trusted-content/official-images/),
while the upstream official-images repository documents
[repeatability and source-verification requirements](https://github.com/docker-library/official-images).

## Supply-chain assessment

The OCI index and both selected manifests were inspected as registry metadata.
The platform manifest is content-addressed, identifies its immutable Debian base
and source commit, and has a paired attestation manifest. That attestation
manifest advertises an SPDX in-toto predicate and a SLSA v0.2 in-toto predicate.
Docker documents these as
[BuildKit build attestations](https://docs.docker.com/build/metadata/attestations/)
and documents the
[SPDX SBOM form](https://docs.docker.com/build/metadata/attestations/sbom/).

The review did not fetch either predicate body, any image config, any layer, or
any binary. It therefore does not claim that the predicate subjects or contents
have passed validation. No standalone Cosign or Notation signature was
established. Docker has announced retirement of Docker Content Trust for
Official Images, so DCT is not used as the acceptance basis. Later acquisition
must validate predicate subjects, provenance materials/builder, SPDX coverage,
the signed source commit, and Node's signed checksums before the image is
eligible for compatibility testing.

The selected image is preferred over a new project build because it already has
an immutable official source path, an immutable base reference, upstream release
verification in the Dockerfile, and attached SBOM/provenance descriptors. A
project build is not authorized or needed unless those predicate bodies fail
validation; that failure would produce NO-GO and a new review, not an automatic
fallback.

## Compatibility boundary

No runtime compatibility claim has been made. The selected image, and any
different Node 24 patch proposed later, must pass the complete matrix in
`compatibility-protocol.json`. The sensitive surface includes Node's built-in
SQLite behavior, `better-sqlite3` native loading and journal modes,
child-process reopen, canonical JSON, crypto digests, tokenizer vectors,
closed-AST execution, evaluator reproduction, deterministic scheduling,
zero-effect replay, offline packed dependencies, and Node/Workers smokes.

Frozen scientific artifacts must remain byte-identical. OCI, archive,
attestation, native-addon, dependency-closure, environment, and compatibility
receipts are runtime artifacts and are expected to receive new identities.

## Authority and effects

`future-acquisition-authorization.md` is inactive. Even when separately
activated, it permits one digest-bound acquisition, archive, offline import
verification, and receipts—then requires a stop for independent review. It does
not permit running the image or the compatibility campaign.

This review made authorized public documentation and registry-manifest metadata
requests. It produced zero image-layer, image-config, attestation-body, or
binary downloads; zero pulls, builds, imports, or image runs; and zero corpus,
gold, source-document, schedule, authority, credential, provider/model,
analysis, OSF, or push effects. See `effects.json` for the machine-readable
record.
