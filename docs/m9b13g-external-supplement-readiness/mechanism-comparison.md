# External supplement mechanism comparison

The closest documented mechanism is a second, separately embargoed OSF
registration using the active Open-Ended Registration version 3 schema. It is
not selected because two required properties remain unproved and one is
contradicted by the ordinary OSF workflow.

| Mechanism                                  | Result            | Controlling reason                                                                                              |
| ------------------------------------------ | ----------------- | --------------------------------------------------------------------------------------------------------------- |
| Update `63sh5`                             | Reject            | Modifies the predecessor and cannot add files.                                                                  |
| Add files to `63sh5`                       | Reject            | Submitted registration files cannot be added or changed.                                                        |
| Add a resource link to `63sh5`             | Reject            | Changes metadata and links rather than archives the 57 files.                                                   |
| Second embargoed OSF registration          | Blocked candidate | File immutability and embargo fit, but ordinary submissions auto-approve and exact 57-file closure is unproved. |
| Register a dedicated new project/component | Blocked candidate | Same approval and archive-closure blockers; source remains mutable until archiving.                             |
| Zenodo                                     | Reject            | Metadata is always public and published files have a documented correction window.                              |

## Narrowest documented interface

The official browser workflow is the only complete documented path covering
draft creation, registration metadata, file attachment, embargo choice,
submission and administrator approval. API v2 documents useful draft,
registration and file primitives, but the public specification does not freeze
the complete embargoed submission plus approval transaction. No API-only
workflow is claimed.

The prospective schema is Open-Ended Registration version 3, resource
`5df83f7dd28338001ac0ab0d`. Its public schema exposes the required `summary`
question and an `uploader`, and the observed schema canonical SHA-256 is
`e750a5a2870f7571032f2c84696321a1071ade6fdd8cccd8c678e0275d3d7fcc`.

## Blocking findings

1. Ordinary OSF submissions automatically approve after 48 hours if an
   administrator does not reject them. A submission therefore cannot enforce a
   later, separately authorized positive approval as a mandatory gate.
2. OSF requires a registration license, and official documentation says a
   project license is automatically uploaded when registering the project. The
   evidence does not prove that the final archive can contain exactly the
   prescribed 57 files and no license artifact.
3. The cited public documentation does not explicitly guarantee preservation of
   the two required folder namespaces through draft upload and registration
   archiving.

No authenticated probe or external mutation was used to resolve these gaps. M9b
remains NO-GO.
