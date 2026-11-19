# Lachesis research charter

Status: draft for sponsor approval. Once approved, this file is the standing
authority for agent work on Lachesis studies. Agents may not edit it; changes
come from the sponsor.

## 1. Purpose

Agents run the research. The sponsor sets direction and decides at milestones.
Rigor is internal: results go out as a preprint or technical report. External
registries are not required.

Rigor exists to stop the specific threats in §4. Process that does not address
one of those threats is out of scope.

## 2. Roles

| Role       | Who                                | Authority                                                                                                               |
| ---------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Sponsor    | Human                              | Approves this charter, material changes (§5), registrations (§6), paid-phase launches (§8) and milestone decisions.     |
| Author     | Agent session                      | Designs, implements, revises and prepares candidates. Never holds provider credentials or reads gold or outcomes early. |
| Reviewers  | Two fresh agent sessions           | Read-only review of one committed candidate (§7).                                                                       |
| Gold maker | Agent session separate from author | Builds gold and held-out material (§9).                                                                                 |
| Runner     | Code launched by the sponsor       | Executes only a registered revision within the registered spend ceilings.                                               |

## 3. What agents may do without asking

- Write and revise code, tests, protocols and analysis plans.
- Run offline checks, tests and simulations, including power and gate
  simulations.
- Run review jobs on committed candidates.
- Prepare registration packages for the sponsor to sign.
- Make operational changes that leave every §5 item unchanged.

## 4. Threats in scope

Every control must name the threat or threats below that it addresses.

- **T1: outcome-informed analysis.** Changing hypotheses, outcomes, exclusions
  or analysis after seeing results.
- **T2: leakage.** Gold, held-out cases or outcomes reaching the author, the
  system under test or a prompt.
- **T3: drift.** The executed code or protocol differs from the registered
  revision.
- **T4: spend overrun.** Exceeding the provider or phase ceilings.
- **T5: irreproducibility.** Results that cannot be regenerated from committed
  inputs and pinned versions.
- **T6: contamination.** Corpus content the model may already know, inflating
  either arm.

These are out of scope unless the sponsor adds them:

- Malicious processes under the same OS user, a compromised host, or toolchain
  supply-chain attacks.
- The sponsor replaying or forging their own approvals.
- Registry, upload or transport mechanics.

## 5. Changes that return to the sponsor

Any change to these, for a registered study, needs sponsor approval and a new
registration revision (§6):

- research question, hypotheses or claim boundary;
- primary estimand, primary outcome or its scoring rule;
- arms, model or provider for the system under test;
- sample size, allocation, probe or stopping gates;
- inclusion or exclusion rules, corpus source domains;
- analysis model, alpha or multiplicity handling;
- any spend ceiling.

Everything else is operational. Operational deviations are listed in the
milestone report and in the next registration revision's `DEVIATIONS.md`.

## 6. Registration

Registrations use the git-native registry in `docs/git-native-registry.md`. It
works on any git host or none. No external registry or server-side enforcement
is used.

- **Package:** `studies/<study>/registrations/<rev>/` holds the protocol, the
  analysis plan, `MANIFEST.json` (SHA-256 of every file), `DEVIATIONS.md` and
  the review receipts (§7).
- **Entry:** `registry/<study>/NNNN.json` binds the manifest digest, the source
  commit and the previous entry's digest, forming a hash chain.
- **Seal:** the sponsor signs each entry with an SSH key. Two independent RFC
  3161 authorities timestamp it. The sponsor pushes it to every witness remote.
  Agents prepare entries but hold no signing key.
- **Verification:** `verify-registry` checks the chain, signatures, timestamps,
  content, chronology and witness consistency offline.
- **Root for M9:** the genesis entry records the OSF M9b.12f preregistration
  `63sh5`, digest
  `097d4848a264fc8484ca590c79388e3a00279a6310392205db7868104cee13b4`.

Results are registered as `result` entries before any unblinded interpretation
is written.

## 7. Review

Each registration candidate gets two review jobs.

- **Independence:** fresh sessions, read-only access to the committed candidate,
  no author chat history, no gold or outcomes, no access to each other's
  findings until both are submitted.
- **Model families:** the two reviewers come from two different families, and
  neither is the author's family. The allowed families are Anthropic (Claude),
  OpenAI (GPT) and Google (Gemini). Each receipt records the actual provider and
  model. A same-family fallback is reported as a deviation and is not allowed
  for a registration that authorizes a paid phase.
  - For M9 the author agents have been OpenAI models (GPT-5.6, GPT-6.1 Sol,
    GPT-6.2 Sol), so the methods review runs on Anthropic and the execution
    review on Google.
- **Split:** one methods review (estimand, design, statistics, recomputed by
  code) and one execution review (clean-checkout reproduction, runner matches
  protocol, spend limits).
- **Findings:** each finding is `blocking` or `advisory`, with evidence.
  - A finding is blocking only if it names a concrete effect on the claim, the
    estimand, a §4 threat or a spend ceiling.
  - Anything else is advisory and does not hold up registration.
- **Rounds:** at most two review rounds per candidate. Unresolved blocking
  findings after round two go to the sponsor with both reviews attached.
- **Receipts:** every round's findings, including failed rounds, are committed
  in the package. A corrected candidate fixes only the finding. It does not add
  new mechanism.
- **Calibration:** before the first paid phase, each review prompt is run once
  on a packet with a seeded defect and once on a clean packet. The miss and
  false-block results go in the milestone report.

## 8. Spending and paid phases

- The sponsor holds provider credentials and launches each paid phase. Launch is
  the admission check: the sponsor confirms the registered tag, the ceiling and
  the phase.
- The runner enforces the registered per-phase ceilings in code and halts on any
  ambiguity or overage. Zero retries unless registered.
- M9 ceilings, approved 2026-11-18. Each scales the M9b.11 per-pair rates to a
  maximum of 264 primary pairs plus the probe:
  - provider project cap: $750.00;
  - operational ceiling: $690.09;
  - inference ceiling: $513.15.

  The registered M9b.12f values ($500.00, $460.06 and $342.10) remain in force
  until the next registration revision records the new ones.

## 9. Data custody

- The gold maker builds gold and held-out material in sessions with no access to
  the author's prompts, arm programs or outcomes.
- Gold digests are committed before any inference.
  - Gold content stays encrypted, with `age`, to a key the author does not hold
    until results are registered.
- **Contamination (T6):**
  - Every corpus document's publication or revision date falls after the first
    public availability of the pinned model snapshot under test, and before the
    registered corpus freeze date.
    - A model cannot have trained on text published after its release, so this
      rule needs no training-cutoff disclosure. A provider-stated cutoff, if one
      exists, may move the window earlier only with sponsor approval.
  - The snapshot release date, its source, and the freeze date are recorded in
    the registration.
  - If a family cannot meet the date window, its cases pass a closed-book screen
    instead. The gold maker asks the model under test with no retrieval, and any
    task it answers correctly is excluded before the case set is frozen. The
    screen has its own registered spend line.

## 10. Proportionality

- At most one consecutive milestone may produce only process or readiness
  artifacts without advancing a study step. A second needs sponsor approval.
- Tests and goldens pin what the claim depends on, not host OS, kernel or
  compiler versions.
- Prefer existing standards (git, SSH signatures, RFC 3161) over new services,
  bespoke protocols or host-specific features.

## 11. Milestone reports

Each milestone ends with a report of at most one page:

1. current scientific claim and status;
2. evidence since the last milestone, with commit and tag references;
3. deviations and unresolved findings;
4. spend to date and remaining ceiling;
5. the next decision the sponsor needs to make.

Human checkpoints for M9:

1. registered protocol and qualified runner;
2. probe disposition;
3. registered primary result or stop reason.

## 12. M9 state at adoption

- The M9b.13 implementation code (M9b.13a–M9b.13k.5a) is retired. This covers
  OSF automation and controls against out-of-scope threats, and its docs remain
  as history. Registration `63sh5` stays as the historical root. Its embargo
  must be lifted before a preprint cites it.
- M9b.13a–f made no change to the 18 registered study fields. Its operational
  supplement is registered as the first git revision under §6. Controls that
  address only out-of-scope threats (§4) are dropped and listed in
  `DEVIATIONS.md`.
- **Probe gate (decided):** the registered directional power gate is replaced by
  feasibility gates plus a blinded discordance check. See
  `docs/m9-probe-gate-analysis.md`. This is a §5 change and goes into the next
  registration revision.
- **Re-estimation ceiling (approved 2026-11-18, §5):** `N_max` = 264 primary
  pairs. That means an operational ceiling of
  $690.09 and a provider cap of
  $750.
  - Under the strong scenario this cuts the chance that probe noise stops a real
    effect from 37% to 8%.
  - The extra spend occurs only when the probe shows low discordance.
- **Registry:** `docs/git-native-registry.md`. The witnesses are GitHub `main`
  and the sponsor's local clone; a second remote is recommended. The sponsor's
  signing key is `~/.ssh/pdlug_ed25519`.
- **Proposed corpus source domains**, all public domain or CC0, dated and
  revision-bearing:
  - Federal Register documents and corrections: lookup, temporal/retraction,
    contradiction.
  - SEC EDGAR filings and amendments: aggregation, join, retraction.
  - Crossref metadata with Retraction Watch: retraction, multi-hop.
  - DailyMed label revisions: temporal, contradiction, insufficient evidence.

  Prompt-injection cases need a registered rule for how injected text is
  introduced into natural documents.
