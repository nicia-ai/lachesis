# M8b.2b.9 parity timeout correction

Parent diagnosis: `a2246913910fdb72dad6ae2e989ee43e12991c45`.

The correction changes one test-specific timeout from 20 to 40 seconds. It
changes no product code, assertion, fixture, task, provider, compile,
reconstruction, or package artifact.

Five clean focused runs passed in 9.721–10.163 seconds. Three focused runs under
13 CPU burners on a 14-core host, with the test process at nice 15, passed in
18.745, 19.760, and 20.964 seconds. The slowest constrained run would have
failed the former timeout and retained 19.036 seconds of headroom under the new
bound.

The correction therefore fixes the diagnosed anti-hang-bound defect without
reducing the 60 task/provider assignments, 120 compiles, 120 provenance
reconstructions, or any identity assertion.

The complete repository verification matrix passed. Both the default-parallel
and single-worker coverage runs executed all 443 tests. Coverage remained at
90.04% statements, 80.36% branches, 97.17% functions, and 94.06% lines.
Formatting, strict TypeScript 6, lint, build, Node and Workers smokes, examples,
load baseline, source safety, public API inventory, historical checksums, M7c
binding audit, deterministic three-run packing, and the strict packed consumer
all passed.

Alpha.5 preparation remains blocked until this correction commit is reviewed
separately.
