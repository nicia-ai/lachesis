# M9b.12c final independent review

Reviewed commit: `c9e50ff3db56f898184dc9b7be934b1f1c0560df`.

Reviewed tree: `ef9f3847a6f0eb7d1a5a519c4acc90cd6a2354fd`.

Decision: `m9b12c-independent-review-no-go`.

Disposition:
`superseded-unregistered-process-durability-identity-admission-incomplete`.

## Blocking findings

1. The quarantine authority is process-local `WeakMap` state and cannot reopen
   authoritatively after a real process restart.
2. Startup revalidation returns a caller-visible permission before startup or
   effect admission, leaving a check/use race.
3. The assessment caller selects the observer commitment and can rotate it to
   evade exact history matching.

## Preserved results

The review independently reproduced the M9b.12c preregistration and manifest
digests, verified all predecessor manifests and package bytes, confirmed all 12
role assertions, and confirmed scientific and financial invariance. Those checks
do not cure the blocking authority, identity, and admission defects.

No registration, corpus, credential, provider, network, push, publication, or
study-execution effect occurred.
