# M7 technical lessons

1. A counts-only audit cannot substitute for a typed constructor-to-materializer
   payload. Complete digests, referential integrity, and separation checks must
   precede packet emission.
2. Clean-room package validation needs the complete recursive public dependency
   capsule, not only first-party tarballs.
3. Capacity must be computed from the actual serialized request envelopes,
   including continuations, diagnostics, tiebreaks, prior output, reasoning, and
   conservative unknown-usage settlement.
4. Credential ownership, lease lifetime, revocation, and receipt verification
   are one state machine. A credential that outlives an authorization or a
   revocation that cannot be independently proven is a terminal failure.
5. A mock entrypoint is not evidence that the real controller entrypoint can
   satisfy the same FD, transport, lifecycle, and image bindings.
6. Request identity must be globally unique and domain-separated from any
   artifact whose digest contains that identity. Reuse is a pre-dispatch stop.
7. Repository-wide discovery commands are incompatible with sealed clean-room
   boundaries. Preparation environments should not mount the historical audit
   repository at all.
8. Fail-closed operational records are valuable, but they do not become
   scientific observations. Study claims begin only after the registered roles
   actually execute.
9. M7a and M7b demonstrate that strict finite offline conformance and safe
   diagnostic guidance are testable without inference. Their scope should stay
   exactly that narrow.
