# M9b.13k decision

Decision: `m9b13k-osf-pat-canary-controller-ready-for-independent-review`

The private controller is limited to one exact future synthetic upload, one
bound project and provider, zero retries, manual/error redirects, durable
single-PUT accounting, and mandatory single-attempt PAT revocation with a
separately controlled verification boundary. The intercepted hostile matrix
passed 76 tests and proves zero PUT redispatch after ambiguity or restart.

This decision permits only independent read-only review. It does not activate
`NEXT-PAT-CEREMONY-AUTHORIZATION.txt`, create or authorize a PAT, permit a real
request, or authorize any OSF mutation. M9b remains NO-GO.
