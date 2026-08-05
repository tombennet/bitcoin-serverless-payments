import { bech32, bech32m, createBase58check } from "@scure/base";
import { sha256 } from "@noble/hashes/sha2.js";

/** Base58Check version bytes for mainnet P2PKH ("1...") and P2SH ("3...") */
const P2PKH_VERSION = 0x00;
const P2SH_VERSION = 0x05;

/**
 * Decode a mainnet SegWit address, enforcing the correct encoding for its
 * witness version: v0 must be bech32, v1+ must be bech32m.
 * @returns The witness version and program, or null if the address is invalid
 */
function decodeSegwitAddress(
  address: string
): { version: number; program: Uint8Array } | null {
  const candidate = address as `${string}1${string}`;

  for (const [codec, isValidVersion] of [
    [bech32, (v: number) => v === 0],
    [bech32m, (v: number) => v >= 1 && v <= 16],
  ] as const) {
    try {
      const decoded = codec.decode(candidate);
      if (decoded.prefix !== "bc") return null;

      const version = decoded.words[0];
      if (!isValidVersion(version)) continue;

      return { version, program: codec.fromWords(decoded.words.slice(1)) };
    } catch {
      // Not this codec
    }
  }

  return null;
}

/**
 * Validate a mainnet Bitcoin address by decoding it and verifying its
 * checksum, version and payload length. Catches derivation, encoding or
 * storage faults; it cannot confirm the address belongs to your wallet.
 */
export function isValidBitcoinAddress(address: unknown): address is string {
  if (typeof address !== "string" || address.length === 0) return false;

  if (address.startsWith("bc1")) {
    const decoded = decodeSegwitAddress(address);
    if (!decoded) return false;

    // v0: 20-byte (P2WPKH) or 32-byte (P2WSH) program. v1 (Taproot): 32 bytes.
    if (decoded.version === 0) {
      return decoded.program.length === 20 || decoded.program.length === 32;
    }
    if (decoded.version === 1) return decoded.program.length === 32;
    return false;
  }

  try {
    // Throws if the Base58Check checksum does not verify
    const payload = createBase58check(sha256).decode(address);
    if (payload.length !== 21) return false;
    return payload[0] === P2PKH_VERSION || payload[0] === P2SH_VERSION;
  } catch {
    return false;
  }
}

/**
 * Validates required environment variables for Bitcoin address functions
 * @returns Object containing validated xpub and derivationPath, or throws error
 */
export function validateBitcoinEnvironment(): {
  xpub: string;
  derivationPath: string;
} {
  const xpub = process.env.BITCOIN_XPUB;
  const derivationPath = process.env.BITCOIN_DERIVATION_PATH;

  if (!xpub) {
    throw new Error("BITCOIN_XPUB environment variable is required");
  }

  if (!derivationPath) {
    throw new Error("BITCOIN_DERIVATION_PATH environment variable is required");
  }

  // Validate that derivation path is at account level (ends with hardened derivation)
  // Expected format: m/purpose'/coin'/account' (e.g., m/84'/0'/0')
  // This path is used for purpose detection only - the XPUB should be at account level
  if (!derivationPath.match(/^m\/\d+'\/\d+'\/\d+'$/)) {
    throw new Error(
      "BITCOIN_DERIVATION_PATH must be at account level (e.g., m/84'/0'/0'). " +
        "This is used for purpose detection - the XPUB should be at the same account level."
    );
  }

  return { xpub, derivationPath };
}

/**
 * Creates a standardized error response for validation failures
 * @param message Error message
 * @returns Response object
 */
export function createValidationErrorResponse(message: string): Response {
  return new Response(message, {
    status: 500,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Content-Type": "application/json",
    },
  });
}
