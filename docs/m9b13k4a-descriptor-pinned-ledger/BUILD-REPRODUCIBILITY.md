# Build reproducibility

Two independently created mode-0700 build directories under `/private/tmp`
produced byte-identical 53,776-byte arm64 executables. Both normalized helper
digests were `fb8301df7125d4df8319c8898365fd74e7a00fbcd8e9ac30d6fb28e90261d3dd`.
The source digest was
`da8f24385504dc4c080bf13b7aab63cee0dada78d132eb100e68712f318389b7`.

The independently recorded toolchain was Apple clang 21.0.0 on Darwin 25.6.0,
arm64, with the SDK and exact arguments in `BUILD-PROTOCOL.json`. The wrapper
removed the original signature, source-bound the sole LC_UUID, ad-hoc resigned
under the fixed identifier, then hashed and metadata-checked the result.
