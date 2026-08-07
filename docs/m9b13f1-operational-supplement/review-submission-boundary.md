# Independent review and submission separation

`reviewPassGrantsSubmissionAuthority: false`

`separateSubmissionAuthorizationRequired: true`

`supplementSubmissionAuthorityCurrentlyPresent: false`

> Independent review confirms the reviewed supplement bytes only. A review pass
> does not authorize external submission, approval, publication, embargo change,
> or any study operation.

> Distinct author and reviewer key commitments establish distinct cryptographic
> review principals. They do not by themselves prove distinct natural persons.

The body does not select a reviewer. A future reviewer must use a separately
controlled public-key identity with a commitment different from the author
commitment, verify the author signature, bind the exact body and package
identities, sign the review receipt, attest operational independence, and never
access the author private key.

A future review receipt remains external to the body payload. A review pass
remains nonauthorizing. Any submission requires a separate exact authorization
binding the supplement body, payload manifest, complete package manifest, author
attestation, review receipt, reviewed Git identity, external mechanism and
target identities, embargo and visibility, exact attachments, exactly one
attempt, and separate approval authority where applicable. It expressly excludes
acquisition, corpus/gold/schedule construction, credentials, providers/models,
study execution, analysis, publication, and embargo termination.
