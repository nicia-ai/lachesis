# Independent rederivation

The implementation inventory was independently read from raw filesystem bytes
after a clean TypeScript build. For each entry, the rederivation checked the
declared byte length and SHA-256. The runtime identity function reparsed the
strict inventory schema, sorted by the unambiguous `(kind, path)` pair, rejected
duplicates, canonicalized the value, and applied the source-bound protocol's
64-bit length-prefixed domain digest.

The rederived runtime identity is:

`8cf1bbec55feb8c7664d55897af46e13b710c40bf1a202c35eac6e64976577b1`

The test source SHA-256 is
`ef15419c7f7e97837e9f89ec734656fd5d023b09d985e91a262430a315f4e064`. The
inventory SHA-256 is
`170a31efd59d60ada3ecf3c01943b01e718b7dfae4d5dd52e6a0fc47781e4d3f`. The protocol
descriptor SHA-256 is
`0017dcd3d822d48b16639b045ccffcb53c995f39c7b8da8c6d9df0905cc76ee7`.

The implementation inventory excludes itself, this narrative, the package
manifest, and the checksum manifest. This prevents recursive self-binding. The
package checksum manifest independently binds the evidence files.

The implementation commit descends directly through the preserved review
evidence commit to the reviewed M9b.13k.2 seal. `git diff` against each sealed
predecessor shows only append-only M9b.13k.3 paths and the new review record.
