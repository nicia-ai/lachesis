# Access matrix

Access is deny-by-default. The machine matrix gives every role its exact
read-only inputs and single writable output class. Future private roots use
`0700` directories and `0600` regular files. Only the source-acquirer may have
temporary, allowlisted acquisition egress; all other roles are network-none.

Credentials, parent/worktree/history, sealed or retired namespaces, unrelated
private artifacts, `paper/`, and `.DS_Store` are excluded from every role. Gold,
cross-packet, and population-wide access are explicitly denied except for the
narrow secret-bearing audit/evaluation responsibilities shown in the matrix,
after which incompatible future role reuse is permanently forbidden.
