# m9b13b-acquisition-authorization-review-no-go

The identities, checksums, predecessor bindings, inactivity boundary, and offline tests all reproduce. However, seven operationally blocking gaps prevent authorizing the future acquisition.

1. **Network allowlist is declarative, not executable**

   - Severity: Critical
   - Confidence: High
   - Files: [inactive-acquisition-authorization.json:22](/Users/paul/orgs/nicia/lachesis/docs/m9b13b-acquisition-authorization/inactive-acquisition-authorization.json:22), lines 22–40; [protocol.json:214](/Users/paul/orgs/nicia/lachesis/docs/m9b13b-acquisition-authorization/protocol.json:214), lines 214–225.
   - Violated invariant: DNS, proxies, mirrors, credential helpers, ambient Docker configuration, alternate registries, and bearer-token scope must fail closed.
   - Consequence: The host list does not specify an enforcement mechanism, proxy/DNS isolation, TLS peer checks, empty Docker context, or exact bearer parameters such as service and `repository:library/node:pull`. An implementation could contact an allowed hostname through an unreviewed proxy or invoke ambient credential/mirror behavior.
   - Prospective correction: Bind an exact acquisition runner and configuration; prohibit all proxy variables and system proxies; exclude Docker daemon/config/context/helpers/mirrors; validate URL host, SNI, certificate, and post-resolution connection for every request; and pin the anonymous token service, repository scope, action, lifetime, response ceiling, and in-memory destruction rule.

2. **Git commit-to-path-to-blob closure is incomplete**

   - Severity: High
   - Confidence: High
   - Files: [protocol.json:90](/Users/paul/orgs/nicia/lachesis/docs/m9b13b-acquisition-authorization/protocol.json:90), lines 90–100; [protocol.json:102](/Users/paul/orgs/nicia/lachesis/docs/m9b13b-acquisition-authorization/protocol.json:102), lines 102–119.
   - Violated invariant: Exact source commits, tree objects, paths, and blobs must be locally and cryptographically linked.
   - Consequence: Hashing raw Dockerfile or `library/node` bytes proves the blob content, but not that the named commit’s tree maps the required path to that blob. The docker-node signature verification similarly does not require reconstruction of the complete Git commit object or traversal to the Dockerfile blob.
   - Prospective correction: Add the exact commit and recursive tree objects to Stage A, with size ceilings and allowed endpoints. Reconstruct and hash Git commit/tree/blob objects locally, require the named commit and tree identities, and traverse the exact path to the pinned blob. Apply the same provenance linkage to the release-key repository claim.

3. **Byte ceilings are ambiguous and incomplete**

   - Severity: High
   - Confidence: High
   - File: [inactive-acquisition-authorization.json:41](/Users/paul/orgs/nicia/lachesis/docs/m9b13b-acquisition-authorization/inactive-acquisition-authorization.json:41), lines 41–42.
   - Violated invariant: The 100,000,000-byte registry ceiling and 512,000,000-byte archive ceiling must be explicitly aggregate and enforced before durable acceptance.
   - Consequence: `registryPayloadCeilingBytes` does not say whether it is per object or aggregate. The enumerated OCI roots and known children total `82,785,952` bytes, so the ceiling is sufficient if aggregate, with `17,214,048` bytes headroom—but a per-object interpretation leaves total recursive acquisition unbounded. GitHub commit responses and some source evidence also lack explicit response ceilings.
   - Prospective correction: Rename and define both ceilings as aggregate byte counters, identify precisely which bodies count, enforce declared per-object sizes plus cumulative streaming limits before writes/renames, and add ceilings for every Stage A HTTP response. Require the archive aggregate to remain below its ceiling before hashing, sealing, or acceptance.

4. **Node OpenPGP validity handling is underspecified**

   - Severity: High
   - Confidence: High
   - File: [protocol.json:68](/Users/paul/orgs/nicia/lachesis/docs/m9b13b-acquisition-authorization/protocol.json:68), lines 68–80.
   - Violated invariant: Expired, revoked, substituted, or otherwise unverifiable signing identities must reject without a keyserver.
   - Consequence: The protocol requires `gpgv`, the keyring, and fingerprint, but does not bind machine-readable status handling, verification time semantics, or rejection of expired/revoked-key statuses. An exact fingerprint alone is insufficient.
   - Prospective correction: Require `--status-fd` parsing and exact `VALIDSIG` fingerprint, while rejecting `EXPKEYSIG`, `EXPSIG`, `REVKEYSIG`, `KEYREVOKED`, `BADSIG`, `ERRSIG`, missing signature, or conflicting signer. Freeze the policy for key validity at signature creation and review time.

5. **Independent SBOM generation and comparison are not frozen**

   - Severity: High
   - Confidence: High
   - File: [protocol.json:258](/Users/paul/orgs/nicia/lachesis/docs/m9b13b-acquisition-authorization/protocol.json:258), lines 258–267.
   - Violated invariant: The evaluator/tool identity and comparison procedure must be fixed before observing the acquired SBOM or image.
   - Consequence: No offline SBOM generator identity, version, digest, normalization rules, comparison schema, or exact mismatch policy is bound. The procedure could be selected after seeing the attached SBOM, and the required tool might entail an unlisted download.
   - Prospective correction: Pin an already-available offline scanner artifact and digest, require scanning the sealed OCI layout without import, and bind a versioned comparison protocol defining package identity, normalization, relationship checks, tolerated metadata differences, and exact quarantine outcomes.

6. **Signature and quarantine policy conflicts with the required fail-closed rule**

   - Severity: High
   - Confidence: High
   - Files: [protocol.json:269](/Users/paul/orgs/nicia/lachesis/docs/m9b13b-acquisition-authorization/protocol.json:269), lines 269–275; [quarantine-decision.json:6](/Users/paul/orgs/nicia/lachesis/docs/m9b13b-acquisition-authorization/quarantine-decision.json:6), lines 6–16.
   - Violated invariant: Oversized, unexpectedly signed, or insufficiently verifiable evidence must produce exactly `quarantined-supply-chain-evidence-insufficient`.
   - Consequence: The current policy allows a newly discovered signature or transparency claim to proceed if it verifies, but Stage A pins no OCI-attestation signature trust root, log checkpoint, or verification material. Oversize and unexpected-signature cases are not explicit quarantine triggers.
   - Prospective correction: For this attempt, either reject any unanticipated signature/transparency material directly into the exact quarantine state, or prospectively pin every required trust root and transparency input in Stage A. Add explicit oversize, unexpected-signature, insufficient-authentication, and semantic-incompatibility triggers.

7. **Destination admission is vulnerable to replacement and aliasing**

   - Severity: High
   - Confidence: High
   - Files: [inactive-acquisition-authorization.json:21](/Users/paul/orgs/nicia/lachesis/docs/m9b13b-acquisition-authorization/inactive-acquisition-authorization.json:21), line 21; [protocol.json:299](/Users/paul/orgs/nicia/lachesis/docs/m9b13b-acquisition-authorization/protocol.json:299), lines 299–307.
   - Violated invariant: The root must reject pre-existing, replaced, exposed, symlinked, mounted, aliased, or identity-mismatched destinations.
   - Consequence: “New empty root” and “no symlinks” do not define atomic creation, ancestor validation, inode/device pinning, bind-mount rejection, or protection against replacement between checks and writes.
   - Prospective correction: Require exclusive `0700` creation after `lstat`/realpath validation of every ancestor, prove the resolved path is outside the repository, reject mount or alias boundaries, pin owner/device/inode, and use directory-relative no-follow operations with repeated `fstat` checks through sealing.

Verification completed locally with zero network:

- Commit `c47752135d37e17831194ee8ba96641b4b149e8a` and tree `35c107a146751339270432d4b8be621b8842b63a` reproduced.
- All three requested digests and every M9b.13b checksum reproduced.
- All predecessor checksum chains reproduced.
- M9b.13 remains `m9b13-materialization-readiness-no-go`.
- The prospective destination is absent.
- Focused TypeScript and lint passed.
- Relevant offline tests: 49/49 passed.
- Tracked worktree remained unchanged; protected `.DS_Store` and `paper/` were not opened or modified.
- No network, credential, download, image, corpus, provider, OSF, commit, or push effect occurred.

No future authorization text is supplied because the pass condition was not met.
