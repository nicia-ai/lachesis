# Independent rederivation

The accepted M9b.13k.3 checksum manifest was reverified before implementation.
After implementation, each non-executable inventory entry was reread from raw
filesystem bytes and checked for exact byte length and SHA-256. Eight entries
matched. The normalized executable was then rebuilt twice at independent private
paths; both 53,456-byte outputs were byte-identical with SHA-256
`39af7eecf5241261a54273241e420f223d05278e25e4e294b97cfd104467ba95`. The
helper-source SHA-256 was
`e0850bf5a7f1fa3fa9d634c5b46e3059371b0d20c2230ddab70ab4ebb5fd9737`.

The strict implementation inventory was reparsed, sorted by the unambiguous
`(kind, path)` pair, checked for duplicate paths, canonicalized, length-framed,
and hashed under protocol
`lachesis-m9b13k4-source-build-bound-ledger-identity/1`. The independently
rederived identity is:

`d52fadda1be127f610f838f12e7c361ad949d65e46c76e09e6e21e02ddca5ecf`

The test-source SHA-256 is
`2add8d2e8435456cbf204c0648e293574c483534fa813f3b1a3dcda3df0135ff`. The
inventory SHA-256 is
`309d3de43d0966df9f36d226ad93e5070b37d371b49b591ddbefc30ec141ab63`. The
build-protocol SHA-256 is
`98539e20e86242968773a1d536c4c48bf2121874c50b32c964a159ea17af936d`.

The implementation identity excludes its own inventory file and the later
package/checksum manifests. The package manifest excludes itself and the
checksum manifest. The checksum manifest excludes only itself.
