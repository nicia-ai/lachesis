# Git-native study registry

This implements charter §6, using `apps/registry` (the `lachesis-registry` CLI).
It needs only git, `ssh-keygen` and `openssl`. It works with any git host or
none: GitHub, GitLab, Gitea, a bare SSH remote, or a local repository.

## Principle

The registry doesn't rely on the server to prevent changes. It makes tampering
detectable instead:

- **Hash chain:** each entry commits to the digest of the one before it.
- **Timestamps:** RFC 3161 tokens from at least two independent authorities
  prove each entry existed by a signed time. Through the chain, they also prove
  that everything before it existed.
- **Signature:** only the sponsor's SSH key, which is bound in the genesis
  entry, can seal an entry.
- **Append-only history:** no commit may modify or delete a sealed file.
- **Witnesses:** independent copies of the repository catch history rewritten
  with a force-push.

Tags and branch protection are conveniences. Nothing depends on them.

## Layout

```text
registry/
  tsa/<name>.pem                 # pinned CA bundle per timestamp authority
  witnesses.json                 # remotes compared by verify (mutable)
  <study>/
    0000.json                    # genesis entry (canonical JSON + newline)
    0000.json.sig                # sponsor SSH signature, namespace lachesis-registry
    0000.json.<tsa>.tsr          # one RFC 3161 response per authority
    0001.json ...
    pending/NNNN.json            # prepared, unsealed entry (mutable)
studies/<study>/registrations/<rev>/
  MANIFEST.json                  # SHA-256 and size of every package file
  ...
```

## Entries

| Kind           | Binds                                                                                                                    |
| -------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `genesis`      | Signer principal and public key, timestamp authorities with their CA bundle digests, external roots such as OSF `63sh5`. |
| `registration` | Manifest path and digest, the source commit, and the phase it `authorizes`.                                              |
| `result`       | Manifest path and digest, the source commit, and the earlier registration it `reportsOn`.                                |

Every entry also carries `parentEntrySha256`, so each one commits to the entry
before it.

Package contents are bound by SHA-256 in the manifest, not by git object IDs,
which default to SHA-1. A manifest may list any repository file, including the
code under test.

## Workflow

The **author agent** may run these. They need no key and work from any checkout,
including a cloud agent pushing over HTTPS:

```sh
lachesis-registry manifest studies/m9/registrations/<rev>
git add studies/m9/registrations/<rev> && git commit
lachesis-registry prepare registration --study m9 --revision <rev> \
  --manifest studies/m9/registrations/<rev>/MANIFEST.json --authorizes <phase>
git add registry/m9/pending && git commit && git push
```

The **sponsor** reviews the package and the pending entry, then runs one
command:

```sh
lachesis-registry seal --study m9 --key ~/.ssh/pdlug_ed25519
```

`seal` performs these steps, and aborts without leaving partial files if any of
them fails:

1. Re-verifies the existing chain.
2. Checks that the key matches the genesis signer.
3. Signs the entry.
4. Requests a token from every pinned authority and verifies each one against
   its pinned CA bundle.
5. Commits the sealed files.
6. Tags the commit `registry/<study>/NNNN`.
7. Pushes to every witness.

The TSA requests carry only a SHA-256 digest.

**Anyone** can run `lachesis-registry verify`. Add `--offline` to skip
witnesses, or `--json` for machine-readable output.

## Verification

`verify` checks:

1. **Chain:** entry files are contiguous from `0000`. The first entry, and only
   the first, is genesis. Each parent digest matches the previous entry's bytes.
   Each result reports on an earlier registration.
2. **Canonical form:** every entry and manifest is byte-identical to its
   canonical encoding.
3. **Signatures:** every entry verifies against the genesis key with
   `ssh-keygen -Y verify`. No allowed-signers file is trusted.
4. **Timestamps:** every entry has a granted token from every genesis authority.
   Each token's message imprint matches the entry digest and verifies against
   the pinned CA bundle, and each bundle matches its genesis digest.
5. **Content:** the source commit is in this history, the manifest at that
   commit matches its digest, and every listed file matches its size and digest.
6. **Append-only history:** no commit reachable from the verified revision,
   including merges, modified or deleted a registry file. Pending entries and
   `witnesses.json` are exempt.
7. **Witnesses:** every witness's entry log is byte-identical to the local log.
   A missing, extra or different entry fails, and so does an unreachable
   witness.
8. **No stray files** in a study directory.

## M9 setup

- **Witnesses:** GitHub `main` plus the sponsor's local clone. Running `verify`
  locally compares the clone with GitHub. If anyone rewrites GitHub, including a
  cloud agent with HTTPS push access, the clone shows a divergence. A second
  remote, such as a bare repository on a backup disk, is cheap and recommended,
  because the local clone only witnesses when `verify` is run there.
- **Timestamp authorities:** DigiCert (`http://timestamp.digicert.com`) and
  Sectigo (`http://timestamp.sectigo.com`).
  - Both were checked live on 2026-11-19 UTC: each granted a token for a random
    digest, and the token verified against the pinned root.
  - The roots come from the Mozilla CA bundle:

    | File           | Root                                  | SHA-256 fingerprint (first 16 hex) | Expires |
    | -------------- | ------------------------------------- | ---------------------------------- | ------- |
    | `digicert.pem` | DigiCert Trusted Root G4              | `552F7BDCF1A7AF9E`                 | 2038    |
    | `sectigo.pem`  | USERTrust RSA Certification Authority | `E793C9B02FD8AA13`                 | 2038    |

  - Sectigo pins USERTrust rather than its self-signed Public Time Stamping Root
    R46. Sectigo's tokens list the cross-signed R46 in their ESS
    signing-certificate attribute, so OpenSSL rejects a chain that ends at the
    self-signed R46 with "ess cert id not found".
  - If an authority changes its chain, sealing aborts with `TIMESTAMP_INVALID`.
    Re-pinning then needs a new study or protocol version, because genesis binds
    the bundle digests.
- **Genesis:**

  ```sh
  lachesis-registry prepare genesis --study m9 --principal sponsor \
    --public-key ~/.ssh/pdlug_ed25519.pub \
    --tsa digicert=http://timestamp.digicert.com \
    --tsa sectigo=http://timestamp.sectigo.com \
    --external-root osf-63sh5=097d4848a264fc8484ca590c79388e3a00279a6310392205db7868104cee13b4
  lachesis-registry seal --study m9 --key ~/.ssh/pdlug_ed25519
  ```

  Record the signer fingerprint that `verify` prints in the charter. Anyone
  checking the registry compares it with `ssh-keygen -lf` out of band.

## What this does and does not prove

| Claim                                                    | Evidence                                     |
| -------------------------------------------------------- | -------------------------------------------- |
| These bytes existed by time T                            | RFC 3161 tokens                              |
| Earlier history was not rewritten later                  | hash chain, tokens, append-only check        |
| The sponsor selected this revision                       | SSH signature by the genesis key             |
| No sealed entry was quietly dropped                      | append-only check plus witnesses             |
| The author never saw gold before results were registered | gold custody (charter §9), not this registry |

The limits:

- A witness can only expose a rewrite of history it already holds.
- The signing key is the root of trust. If it is compromised, an attacker can
  seal new entries, though they still cannot backdate them.
- Key rotation is not implemented. Rotating keys would need a new study or a new
  version of the protocol.
