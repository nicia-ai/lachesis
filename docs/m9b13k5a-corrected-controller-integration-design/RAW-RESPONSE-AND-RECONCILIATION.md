# Raw response and reconciliation contract

Response validation starts with bounded raw bytes. Fatal UTF-8 decoding and a
pre-parse JSON scanner reject malformed encoding, duplicate object keys,
malformed framing, and invalid escapes. Strict nontransforming schemas then
freeze the reviewed JSON:API shapes: top-level `data`, resource `type` and `id`,
attributes, applicable relationships and links, collection pagination and
metadata, resource/provider identities, file fields, and Waterbutler upload
metadata. Exact raw and canonical response SHA-256 digests are retained.

Reconciliation accepts opaque verified transport receipts plus actual downloaded
raw bytes. It computes length and SHA-256 internally. URL comparison parses and
matches exact HTTPS scheme, `files.osf.io` host, default port policy, project,
provider, object id, path, filename, query cardinality, and object cardinality.
It rejects foreign/subdomain hosts, IPs, credentials, fragments, alternate
ports, percent-encoded paths, alternate resources/providers, path/query
ambiguity, duplicate objects, extra objects, missing objects, and downloaded
byte mismatches. No identity check uses substring or suffix matching.
