# Transport capability contract

Production and loopback transports are distinct opaque capabilities. The pure
model can construct only a registry-backed loopback capability. JSON cloning,
object spreading, private-file import, or a production-shaped object does not
register a capability. The production constructor and live effect-admission
constant are absent.

Future production behavior is frozen as follows:

- Node HTTPS only, with exact logical hosts, SNI, Host header, methods, paths,
  and queries from the request-sequence capability;
- no redirect, retry, caller routing override, proxy override, or callback that
  selects security behavior;
- one request at a time;
- bounded streaming response collection with the API/upload ceilings;
- controller-owned monotonic deadline and abort signal;
- prompt request and socket destruction on abort or failure;
- sanitized receipts containing identities, counts, status, and byte digests,
  never authorization data or raw secrets.

A production transport cannot enter synthetic runtime, and a loopback transport
cannot enter live runtime. Future integration must test both substitutions
before it may prepare activation.
