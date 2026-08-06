# M9b.13e.1 independent rederivation

Using local immutable Git objects, receipts, manifests, and registered bytes
only, the rederivation reproduced registration `63sh5`, its submission and
approval timestamps, active embargo, all 27 file sizes and SHA-256 values,
preregistration digest `097d4848…13b4`, manifest digest `5e53f4ae…189`, and
canonical receipt digest `ae33915d…f70b`.

The 18 fields `researchQuestion`, `bindings`, `treatment`, `control`,
`matching`, `population`, `primaryEndpoint`, `analysis`, `probeAdvancement`,
`financial`, `operationalSequence`, `countPricingKillGates`,
`operationalSecurity`, `disclosureAndRoles`, `nonclaims`, `audit`, `authority`,
and `inheritedDecisions` reproduce with zero changes at
`e5cd02100a1004849acc18f3f302e880580a38ef45a0733868826c32a23ff282`.

The exact failed M9b.13e review is preserved at commit
`ad6efa0b0f8ffa7b2c883aa816c316a0bd8792c0`, tree
`0ba350208524e198755baf0ac0b8b4aa6815f222`. The corrected contracts and private
validator are commit `49d9e7f7b919fb5a22f89fd87d48630dd3baf97b`, tree
`ac505ad37a3f049f8c61b767d56fd2e2c23a5a0f`.

All five review findings are corrected prospectively without changing M9b.13e or
making acquisition ready. The pure validator checks only a receipt contract; it
does not collect processes, access a network, run acquisition, or prove that a
future census is truthful.
