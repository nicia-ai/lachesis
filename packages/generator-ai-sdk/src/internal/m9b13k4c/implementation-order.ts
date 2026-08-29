export type M9b13k4cInventoryIdentity = Readonly<{
  kind: string;
  path: string;
}>;

const utf8Encoder = new TextEncoder();

export function m9b13k4cInventoryIdentityBytes(
  identity: M9b13k4cInventoryIdentity,
): Uint8Array {
  return utf8Encoder.encode(`${identity.kind}\u0000${identity.path}`);
}

export function compareM9b13k4cInventoryIdentities(
  left: M9b13k4cInventoryIdentity,
  right: M9b13k4cInventoryIdentity,
): number {
  const leftBytes = m9b13k4cInventoryIdentityBytes(left);
  const rightBytes = m9b13k4cInventoryIdentityBytes(right);
  const sharedLength = Math.min(leftBytes.byteLength, rightBytes.byteLength);
  for (let index = 0; index < sharedLength; index++) {
    const leftByte = leftBytes[index];
    const rightByte = rightBytes[index];
    if (leftByte === undefined || rightByte === undefined)
      throw new Error("m9b13k4c-byte-index-invalid");
    if (leftByte !== rightByte) return leftByte < rightByte ? -1 : 1;
  }
  if (leftBytes.byteLength === rightBytes.byteLength) return 0;
  return leftBytes.byteLength < rightBytes.byteLength ? -1 : 1;
}
