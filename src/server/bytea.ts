import "server-only";

const HEX_BYTEA = /^\\x(?:[0-9a-f]{2})*$/i;

/** PostgREST returns bytea as "\x…" hex text. */
export function decodeBytea(value: string): Buffer {
  if (!HEX_BYTEA.test(value)) throw new Error("Unexpected bytea encoding");
  return Buffer.from(value.slice(2), "hex");
}
