# Separate approval protocol

Approval must be a later, single-use action under authority distinct from the
submission authority. It may occur only after the pending registration identity
and exact submitted bytes are reconciled.

The ordinary OSF workflow does not presently satisfy this contract: official
documentation says the submission automatically approves after 48 hours if no
administrator rejects it. Passive auto-approval is not positive separate
authority. This is a blocking M9b.13g finding, so the approval protocol remains
disabled.
