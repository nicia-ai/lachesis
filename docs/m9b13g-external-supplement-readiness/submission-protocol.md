# Future single-attempt submission protocol

The protocol is disabled while the M9b.13g mechanism decision is NO-GO. It is
not an instruction to create a draft or submit anything now.

A future attempt would require three separately scoped authorities: one for
preparing exactly one private draft and uploading the frozen files, one
single-use authority for one submission attempt, and a later approval authority
issued only after the submitted state is reconciled. The submission authority
must bind the exact 57-file inventory, both source manifests, both commit/tree
pairs, all body and receipt identities, the provider, Open-Ended Registration
schema version 3, exact metadata, Apache-2.0 license, embargo, visibility,
target object identity and one-attempt limit.

Before submission, `63sh5` must be reverified unchanged, duplicate discovery
must be negative, all 57 uploaded objects must be rehashed, and no extra file or
view-only link may exist. Submit is invoked once. Any timeout, interruption,
unknown response or partial state is permanently ambiguous and cannot be
retried.

The submission phase stops before approval. M9b remains NO-GO.
