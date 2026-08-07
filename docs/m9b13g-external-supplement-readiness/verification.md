# M9b.13g verification

The final offline rederivation passed for this fail-closed readiness package. It
does not establish that an external submission mechanism is usable.

- Reproduced both pinned commit/tree pairs and their complete checksum manifests
  from Git objects.
- Reproduced all 57 raw attachment identities and all 33 applicable RFC 8785
  JSON identities.
- Confirmed exactly 45 `supplement/` and 12 `independent-review-receipt/` paths,
  sorted, normalized, relative, unique, and fixed at version one.
- Reproduced the prospective inventory raw SHA-256
  `dc6453dd9bad84f9ed772dc7667a6e3a1a51f60f6ed9f248874e04118399fdf2` and RFC
  8785 SHA-256
  `4a7193935b959b8f815839c80b87f2af6b60fd2928aaf09afa3ed8d547a9f725`.
- Ran all 36 deterministic hostile mutations: 35 rejected and the ambiguous
  response case produced `ambiguous-no-retry`.
- Rejected duplicate keys in every local JSON record and every JSON source
  attachment.
- Preserved the supplied prior receipt-review pass explicitly as supplied
  evidence; M9b.13g did not claim to rerun that independent review.
- Confirmed zero authenticated access and zero external mutation.

The checksum manifest covers every package file except itself. No submission,
approval, publication, view-only link, embargo change, or study authority is
granted. Registration `63sh5` remains unchanged. M9b remains NO-GO.
