# Stable-object reconciliation

Protocol: `lachesis-m9b13k5-stable-object-reconciliation/1`.

One canonical stable-object identity binds:

- provider-root upload relation and exact PUT URL;
- upload entity ID, path, filename, length, and digest;
- post-upload inventory entity ID, path, and download relation;
- parsed download entity ID and path;
- actual downloaded byte length and digest.

Provider-root and PUT relations must be byte-identical. Upload, inventory, and
parsed download IDs must be one exact string. Their paths must also be one exact
string. The download relation must terminate in that exact object ID. Filename,
length, and digest must equal the frozen artifact.

Only after all comparisons pass is the canonical evidence projection hashed. For
example, upload ID `file-identity` with download object `different-object`
rejects and produces no reconciled transition.
