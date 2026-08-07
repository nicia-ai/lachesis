import hashlib
import json
import subprocess
import sys
from pathlib import Path


INVENTORY_SPEC = (
    "c324343d65bbbf68659c443581eb686ace9c9b68:"
    "docs/m9b13g-external-supplement-readiness/attachment-inventory.json"
)


def git_show(spec: str) -> bytes:
    return subprocess.check_output(["git", "show", spec])


def octal_field(value: int, length: int) -> bytes:
    encoded = format(value, "o").rjust(length - 1, "0").encode("ascii") + b"\0"
    if len(encoded) != length:
        raise ValueError("numeric field overflow")
    return encoded


def make_header(path: str, kind: str, size: int) -> bytes:
    encoded_path = path.encode("utf-8")
    if len(encoded_path) > 100:
        raise ValueError("path requires an extension")
    block = bytearray(512)
    block[0 : len(encoded_path)] = encoded_path
    block[100:108] = octal_field(0o755 if kind == "directory" else 0o644, 8)
    block[108:116] = octal_field(0, 8)
    block[116:124] = octal_field(0, 8)
    block[124:136] = octal_field(size, 12)
    block[136:148] = octal_field(0, 12)
    block[148:156] = b"        "
    block[156] = ord("5" if kind == "directory" else "0")
    block[257:263] = b"ustar\0"
    block[263:265] = b"00"
    block[329:337] = octal_field(0, 8)
    block[337:345] = octal_field(0, 8)
    checksum = format(sum(block), "o").rjust(6, "0").encode("ascii") + b"\0 "
    block[148:156] = checksum
    return bytes(block)


def main() -> None:
    if len(sys.argv) != 2:
        raise ValueError("usage: independent-reproduce-archive.py OUTPUT_PATH")
    inventory = json.loads(git_show(INVENTORY_SPEC))
    files: list[tuple[str, bytes]] = []
    for entry in inventory["attachments"]:
        data = git_show(
            f'{entry["sourceGitCommit"]}:{entry["sourceRepositoryPath"]}'
        )
        if hashlib.sha256(data).hexdigest() != entry["rawSha256"]:
            raise ValueError(f'frozen source mismatch: {entry["path"]}')
        files.append((entry["path"], data))

    entries = [("independent-review-receipt/", "directory", b"")]
    entries += [
        (path, "regular-file", data)
        for path, data in files
        if path.startswith("independent-review-receipt/")
    ]
    entries += [("supplement/", "directory", b"")]
    entries += [
        (path, "regular-file", data)
        for path, data in files
        if path.startswith("supplement/")
    ]
    if [entry[0] for entry in entries] != sorted(entry[0] for entry in entries):
        raise ValueError("archive ordering")

    chunks: list[bytes] = []
    for path, kind, data in entries:
        chunks.append(make_header(path, kind, len(data)))
        if kind == "regular-file":
            chunks.append(data)
            chunks.append(bytes((-len(data)) % 512))
    chunks.append(bytes(1024))
    Path(sys.argv[1]).write_bytes(b"".join(chunks))


if __name__ == "__main__":
    main()
