# Independent review and submission separation

`reviewPassGrantsSubmissionAuthority: false`

`reviewPassGrantsOperationalAuthority: false`

`separateSubmissionAuthorizationRequired: true`

`supplementSubmissionAuthorityCurrentlyPresent: false`

> Independent review confirms the reviewed supplement bytes only. A review pass
> does not authorize external submission, approval, publication, embargo change,
> or any study operation.

> Distinct author and reviewer key commitments establish distinct cryptographic
> review principals. They do not by themselves prove distinct natural persons.

The body does not select a reviewer. A future reviewer uses a separately
controlled key commitment distinct from the author commitment, verifies the
author signature, binds the exact body, package, author-evidence and final Git
identities, supplies a canonical per-artifact evidence inventory, signs the
exact receipt projection, attests operational independence, and never accesses
the author private key.

The receipt's direct bindings are exhaustively defined by
`future-review-receipt-schema.json`. They include raw and canonical author
attestation identities, package-inventory protocol and canonical digest,
complete manifest protocol and raw digest, exact final Git identity, distinct
reviewer identity and signature, exact decision, and every review-evidence
artifact. An opaque review digest or ambiguous singular attestation digest is
insufficient.

A future review receipt remains external to the body payload and cannot
self-authorize submission. Any submission requires a later exact authorization
binding the supplement, author and review evidence, external mechanism and
target, embargo and visibility, exact attachments, exactly one attempt, and
separate approval authority where applicable. Acquisition, corpus/gold/schedule
construction, credentials, providers/models, study execution, analysis,
publication, and embargo termination remain excluded.
