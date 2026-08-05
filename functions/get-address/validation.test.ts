/**
 * Tests for Bitcoin address validation: nothing reaches a donor unless it
 * decodes as a real mainnet address.
 */

import { describe, it, expect } from "vitest";
import { isValidBitcoinAddress } from "./validation.ts";
import { deriveValidatedAddress } from "./address-pool.ts";

// Official BIP test vectors, matching address-derivation.test.ts
const VALID_ADDRESSES = {
  "P2PKH (BIP44)": "1LqBGSKuX5yYUonjxT5qGfpUsXKYYWeabA",
  "P2SH (BIP49)": "37VucYSaXLCAsxYyAPfbSi9eh4iEcbShgf",
  "P2WPKH (BIP84)": "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu",
  "P2TR (BIP86)":
    "bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr",
};

describe("isValidBitcoinAddress", () => {
  Object.entries(VALID_ADDRESSES).forEach(([label, address]) => {
    it(`accepts ${label}`, () => {
      expect(isValidBitcoinAddress(address)).toBe(true);
    });
  });

  it("rejects addresses with a corrupted checksum", () => {
    Object.values(VALID_ADDRESSES).forEach((address) => {
      // Flip the final character to a different one from the same alphabet
      const last = address.slice(-1);
      const replacement = last === "q" ? "p" : "q";
      const corrupted = address.slice(0, -1) + replacement;

      expect(isValidBitcoinAddress(corrupted)).toBe(false);
    });
  });

  it("rejects HTML injection payloads", () => {
    // The payload from the security audit, which previously rendered as markup
    const payloads = [
      `bc1qxxx"><img src=x onerror=alert(document.domain)>`,
      `<script>alert(1)</script>`,
      `bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu<b>`,
      `javascript:alert(1)`,
    ];

    payloads.forEach((payload) => {
      expect(isValidBitcoinAddress(payload)).toBe(false);
    });
  });

  it("rejects testnet and non-address values", () => {
    const invalid = [
      "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx", // testnet
      "bcrt1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080", // regtest
      "",
      "   ",
      "not-an-address",
      "xpub6BosfCnifzxcFwrSzQiqu2DBVTshkCXacvNsWGYJVVhhawA7d4R5WSWGFNbi8Aw6ZRc1brxMyWMzG3DSSSSoekkudhUd9yLb6qx39T9nMdj",
      null,
      undefined,
      42,
      {},
    ];

    invalid.forEach((value) => {
      expect(isValidBitcoinAddress(value)).toBe(false);
    });
  });

  it("rejects a witness v0 address encoded with bech32m", () => {
    // Valid bech32m string, but witness v0 requires bech32. From BIP173/350
    // invalid-address vectors.
    expect(
      isValidBitcoinAddress("bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kemeawh")
    ).toBe(false);
  });
});

describe("deriveValidatedAddress", () => {
  it("returns the same addresses as unvalidated derivation", () => {
    const xpub =
      "zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs";

    expect(deriveValidatedAddress(xpub, 84, 0)).toBe(
      "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu"
    );
  });

  it("throws rather than returning an address it cannot validate", () => {
    expect(() => deriveValidatedAddress("not-an-xpub", 84, 0)).toThrow();
  });
});
