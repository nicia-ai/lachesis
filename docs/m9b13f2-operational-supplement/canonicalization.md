# Normative RFC 8785 canonicalization

Protocol: `lachesis-m9b13f2-rfc8785-json-canonicalization/1`

Every decision-relevant M9b.13f.2 canonical JSON digest and signature input uses
the JSON Canonicalization Scheme in RFC 8785. Input and output are UTF-8. Strict
JSON grammar is required. Duplicate object keys are rejected at every depth
before an ordinary parser can collapse them. The prototype-sensitive keys
`__proto__`, `prototype`, and `constructor` are rejected.

Accepted values must be I-JSON compatible. Lone Unicode surrogates, non-finite
numbers, integers outside `[-9007199254740991, 9007199254740991]`, and host
values without a JSON representation are rejected. RFC 8785 property ordering,
string escaping, and IEEE-754 binary64 number serialization apply recursively.
Canonical output has no whitespace outside strings and no trailing newline.

The digest of an accepted JSON value is exactly:

`SHA-256(UTF8(RFC8785(value)))`

Normal `JSON.parse` or `JSON.stringify` alone is not sufficient because it does
not reject duplicate keys before collapse or prove that the input lies inside
the accepted interoperable domain. Each accepted value has exactly one canonical
byte sequence.
