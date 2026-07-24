# M8b.2b.2 authenticated draft-release correction

Decision: `prepared-unexecuted-awaiting-separate-authorizations`.

Bootstrap run
[`30127417942`](https://github.com/nicia-ai/lachesis/actions/runs/30127417942)
failed before npm setup, credential use, packaging, or publication. GitHub's
tag-addressed release API returned HTTP 404 because release database ID
`359550250` is still a draft. Every npm-related step was skipped, and all six
alpha.4 versions remained absent.

Workflow-only correction `587b23d6b37ccb3f6a0f4ba0aba046638036f13b` replaces
that lookup with the authenticated release-ID endpoint. The lookup uses only the
workflow `GITHUB_TOKEN` under the existing `contents: read` permission and
validates:

- release ID `359550250`;
- tag `v0.1.0-alpha.4`;
- draft and prerelease state;
- exact title `Lachesis 0.1.0-alpha.4`;
- body SHA-256
  `bec6a90f3c7683e3d66d10607ebfb4891105abb25064c5feae14e59196fc1a02`;
- body equality with the frozen release-note bytes; and
- annotated-tag peel to package-source commit
  `635521f1d2e753095fca4fdbbafbf7ed2287efe1`.

The corrected workflow SHA-256 is
`e5fb843e3e89b576d1a6cf27917b0c7e98dfff118c05c626b18b32d2f3e7ed82`.
`release.yml` remains byte-identical at
`c6288195114390cbcb2369a0ae96f2573f8ccd4ab954950302496617dec822a1`.

Authenticated discovery passed. Wrong ID, tag, title, body, draft state,
prerelease state, and API-failure cases rejected. Actionlint, the existing
bootstrap safety test, formatting, lint, source safety, and `git diff --check`
passed. A live read-only registry check confirmed no alpha.4 npm mutation.

No remote state was mutated. No npm credential, package, trusted publisher,
release, tag, or dist-tag was created or changed during correction preparation.
