# m9b13b-corrected-acquisition-authorization-ready-for-independent-review

This private package corrects the M9b.13a prospective OCI acquisition text. It
does not activate that text, acquire an image, change the M9b.13 readiness
decision, or authorize compatibility or materialization work.

The reviewed M9b.13a package remains byte-for-byte intact. Its acquisition text
is recorded as reviewed but not activatable because it did not pin the complete
Node release trust inputs, the official-images mapping bytes, or exact
attestation acceptance gates. M9b.13 remains
`m9b13-materialization-readiness-no-go`.

## Frozen candidate and source chain

The only prospective candidate is
`docker.io/library/node:24.18.1-bookworm-slim`, OCI index
`sha256:235600a8101ab264e117b1768e925532262668dc9b581ef1dd7d96ced463b8e7`,
platform `linux/arm64/v8`, platform manifest
`sha256:c39335f45d6d5b2a5be95b0f1a63e57cca4e9e36cc69b313c1ad5472b13a1e3`, and
attestation manifest
`sha256:f3c062ad822adadf8f41d1bfaa2a25cce3fd81800fc2a2cf2264307b8c77ae23`.

Node `v24.18.1` is bound to the exact signed-manifest, active-keyring,
signer-fingerprint, Linux ARM64 artifact, and source-XZ hashes in
`verification-inputs.json`. A later verification must hash both the signed
manifest and keyring, run `gpgv` with only that keyring, require fingerprint
`DD792F5973C6DE52C432CBDAC77ABFA00DDBF2B7`, and parse artifact hashes only after
signature success. Keyserver lookup and additional trust roots are forbidden.

The docker-node commit signature claim is deliberately narrow. The exact public
key may later be obtained only from `https://github.com/web-flow.gpg`, must hash
to `6e8af687f60cf3f403151c8fb1b26e95e6f9e424ca60cc8f3787bd4466a3ef84`, and must
verify key ID `B5690EEEBB952194` locally. Success proves a GitHub web-flow
signature, not a direct Node-maintainer signature.

The authoritative official-images mapping is commit
`baca6de4f5be548b9b818fa2ca5a1d1d9e66f309`, `library/node` blob
`611d1d2858eff2204e357de60a188b88ef1cd1c7`, file SHA-256
`4e06e614086ad016d795d1005e821c595cf4e7c8e18bf03aecacc74191dd5e68`. Its exact
stanza contains tag `24.18.1-bookworm-slim`, architecture `arm64v8`, docker-node
commit `53252eea9caacaa50bdf58f4d34f0bff8d259999`, and directory
`24/bookworm-slim`.

## Closed acquisition graph

The inactive authorization permits one future attempt only. Stage A is limited
to the three frozen OCI root objects and the exact source/signature/mapping
evidence. Stage B cannot begin until Stage A passes and the full recursive
digest, size, and media-type inventory has been sealed. Only descendants of the
verified platform and attestation manifests may be requested. Unknown or foreign
descriptors, nondigest URLs, mutable fallback, schema drift, unexpected
redirects, cycles, conflicting duplicate descriptors, and out-of-graph children
all fail closed.

Only an ephemeral anonymous Docker Registry bearer token may be held in memory.
There are zero automatic retries. Failure consumes the attempt, quarantines the
whole root, forbids partial-byte reuse, and cannot trigger candidate
substitution.

## Attestation and SBOM gates

Every statement must use one of the two explicitly supported in-toto statement
versions (`v0.1` or `v1`), the exact predicate type, a single subject named `_`,
and the exact platform-manifest digest. The two statements must agree.

Provenance must bind the official-images builder, BuildKit build type,
docker-node repository and commit, Dockerfile and context, invocation,
`linux/arm64/v8`, Node `24.18.1`, complete materials including the base image,
and nonconflicting timestamp and reproducibility metadata. The attached SPDX
must coherently bind the platform image, Node version, Debian Bookworm slim
packages, identifiers, and relationships. A separately generated local SBOM must
be compared under a protocol frozen before import.

Unsigned BuildKit/in-toto data is recorded as content-addressed but not
cryptographically authenticated. If signature or transparency evidence is
claimed, all trust roots, identities, signatures, log proofs, and checkpoints
must verify offline. Missing, contradictory, malformed, or unverifiable required
evidence produces `quarantined-supply-chain-evidence-insufficient`.

## Inactive authorization and effects

The exact prospective object is `inactive-acquisition-authorization.json`,
SHA-256 `f89ace450dba19c174b00340ff8cbe90c6cb014e76f25740f80735a1ca781f64`. It
is not user authority. A later explicit user instruction after independent
review would have to identify the exact committed object and digest and
separately authorize one attempt.

This milestone downloaded zero image manifests, configs, layers, attestation
bodies, Node binaries, key material, or OCI archives; pulled, built, imported,
and ran zero images; and produced zero corpus, gold, credential, provider,
model, schedule, operational-identity, authority, analysis, OSF, or push
effects. Read-only public metadata review was nonzero and carried no study data.

## Files

- `protocol.json`: complete frozen review and acceptance protocol.
- `verification-inputs.json`: exact cryptographic and mapping inventory.
- `inactive-acquisition-authorization.json`: prospective, inactive one-attempt
  text.
- `quarantine-decision.json`: fail-closed state transition.
- `hostile-tests.json` and `zero-effect-report.json`: synthetic evidence.
- `decision.json` and `verification.json`: disposition and gate results.
- `CHECKSUMS.sha256`: independent byte inventory.
