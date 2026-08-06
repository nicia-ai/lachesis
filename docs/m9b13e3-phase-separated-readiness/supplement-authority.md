# Separate supplement body, review, and submission authority

The future supplement body is a strict, checksum-bound object whose canonical
digest excludes only its own digest field. It contains the exact amended
assumption, nonclaim, retained scope, registration archive, scientific
projection, historical NO-GOs, and embargo policy. It contains no review or
submission decision.

The review is a second strict object created after body freeze. Its
independently recomputed digest binds the body digest, commit, tree, manifest,
reviewer, evidence, literal `pass`, review time, and required prospective
checks.

Structural validation of either object is nonauthoritative. The synthetic-only
submission harness holds the accepted body and review digests, commit, tree,
authorization time and identity, registry mechanism, and embargo policy outside
the submitted JSON. A caller-selected, mutually consistent review therefore
cannot substitute for the authority-bound review. No live harness or real body
or review package exists.
