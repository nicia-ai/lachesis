# Archive reproduction

Three clean archive builds produced the same 210432 bytes and SHA-256
`978c996fd5c55d559fa1c36a2f0eba2f7ef43e7fe27603c2dc7c74dc63f0201d`. One used the
checked-in Node builder; two fresh isolated builds used an independent Python
ustar writer. Temporary duplicate outputs were removed.

Python's standard tar reader and a separate raw-block parser then read the
committed archive without extracting paths to disk. They verified all 59
entries, header checksums, metadata, type flags, zero padding, and the two
terminal blocks. All 57 file payloads matched the frozen byte lengths and raw
SHA-256 identities. No PAX, GNU extension, link, device, or special entry was
present.
