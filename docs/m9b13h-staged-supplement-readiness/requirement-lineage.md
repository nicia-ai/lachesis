# Signed requirement lineage

The signed M9b.13f.2 body requires a new immutable external identity, the
original embargo boundary, no public view-only link or protected metadata
exposure, exact immutable attachment hashes, a server submission timestamp,
separate approval where required, post-upload byte verification, an append-only
local receipt, and separate exact submission authorization.

Those requirements come directly from `external-mechanism-requirements.json` at
accepted supplement commit `13a2ff00fe6b04d8d38a8a3d0bc867db23d04f17`. The
separate authority contract comes from `review-submission-boundary.json` in the
same commit.

The signed body does not require 57 native external objects, preservation of two
OSF folder paths, absence of every provider-generated file, a platform without
automatic approval, or submission before draft inspection. Those were M9b.13g
design constraints, not signed requirements.

Wrapping the 57 exact files in a deterministic archive changes transport only.
It changes no scientific, financial, operational, author, or review byte.
