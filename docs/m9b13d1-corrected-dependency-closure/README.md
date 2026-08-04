# M9b.13d.1 descriptor-execution feasibility boundary

M9b.13d.1 is an append-only correction attempt after the failed independent
review of M9b.13d. The correction cannot proceed to a ready disposition on the
pinned host because descriptor-bound execution of the verified native helper
cannot be proven.

The private probe opens the frozen M9b.13d helper with both
`O_RDONLY | O_NOFOLLOW` and `O_EXEC | O_NOFOLLOW`, confirms that the two
descriptors identify the same regular inode, hashes the retained read
descriptor, inherits each descriptor as file descriptor 3, and attempts to
execute only `/dev/fd/3`. Darwin returns `EACCES` for both modes. The pinned SDK
has neither `fexecve` nor `execveat`.

A 32-repetition hostile regression retains both descriptors, replaces the
original pathname with an unauthorized executable as the same UID, and confirms
that both descriptor-only launch attempts return `EACCES`. The test separately
proves that a forbidden fallback to the original pathname would execute the
replacement.

The phase brief requires a NO-GO when descriptor-bound helper execution cannot
be proven. It expressly forbids downgrading the race or substituting pathname
rehashing. Therefore no M9b.13d artifact is modified, no partial correction is
reinterpreted as safe, and no acquisition authorization is prepared or executed.
