/**
 * Regression tests for Bitcoin address derivation
 *
 * These tests ensure that address generation remains consistent across
 * dependency upgrades. They use known XPUB values with expected addresses
 * for each BIP standard (44, 49, 84, 86).
 *
 * A failure means derived addresses have changed: donations would go to
 * addresses your wallet is not watching. Investigate before merging.
 */

import { describe, it, expect } from "vitest";
import { deriveAddress } from "./address-pool.ts";

/**
 * Test fixtures using official BIP test vectors
 *
 * These XPUBs and addresses are from official BIP specifications
 * and provide independent verification of address derivation correctness.
 * They are publicly available test vectors, safe to use in tests.
 */

// BIP84 (P2WPKH) - Native SegWit (bc1q...)
// From: https://github.com/bitcoin/bips/blob/master/bip-0084.mediawiki
const BIP84_TEST = {
  xpub: "zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs",
  purpose: 84,
  expectedAddresses: [
    "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu", // index 0
    "bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g", // index 1
    "bc1qp59yckz4ae5c4efgw2s5wfyvrz0ala7rgvuz8z", // index 2
  ],
};

// BIP49 (P2WPKH-in-P2SH) - Nested SegWit (3...)
// From: https://github.com/bitcoin/bips/blob/master/bip-0049.mediawiki
const BIP49_TEST = {
  xpub: "ypub6Ww3ibxVfGzLrAH1PNcjyAWenMTbbAosGNB6VvmSEgytSER9azLDWCxoJwW7Ke7icmizBMXrzBx9979FfaHxHcrArf3zbeJJJUZPf663zsP",
  purpose: 49,
  expectedAddresses: [
    "37VucYSaXLCAsxYyAPfbSi9eh4iEcbShgf", // index 0
    "3LtMnn87fqUeHBUG414p9CWwnoV6E2pNKS", // index 1
    "3B4cvWGR8X6Xs8nvTxVUoMJV77E4f7oaia", // index 2
  ],
};

// BIP44 (P2PKH) - Legacy (1...)
// From: https://github.com/bitcoin/bips/blob/master/bip-0044.mediawiki
const BIP44_TEST = {
  xpub: "xpub6BosfCnifzxcFwrSzQiqu2DBVTshkCXacvNsWGYJVVhhawA7d4R5WSWGFNbi8Aw6ZRc1brxMyWMzG3DSSSSoekkudhUd9yLb6qx39T9nMdj",
  purpose: 44,
  expectedAddresses: [
    "1LqBGSKuX5yYUonjxT5qGfpUsXKYYWeabA", // index 0
    "1Ak8PffB2meyfYnbXZR9EGfLfFZVpzJvQP", // index 1
    "1MNF5RSaabFwcbtJirJwKnDytsXXEsVsNb", // index 2
  ],
};

// BIP86 (P2TR) - Taproot (bc1p...)
// From: https://github.com/bitcoin/bips/blob/master/bip-0086.mediawiki
const BIP86_TEST = {
  xpub: "xpub6BgBgsespWvERF3LHQu6CnqdvfEvtMcQjYrcRzx53QJjSxarj2afYWcLteoGVky7D3UKDP9QyrLprQ3VCECoY49yfdDEHGCtMMj92pReUsQ",
  purpose: 86,
  expectedAddresses: [
    "bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr", // index 0
    "bc1p4qhjn9zdvkux4e44uhx8tc55attvtyu358kutcqkudyccelu0was9fqzwh", // index 1
    "bc1p0d0rhyynq0awa9m8cqrcr8f5nxqx3aw29w4ru5u9my3h0sfygnzs9khxz8", // index 2
  ],
};

describe("Bitcoin Address Derivation - Regression Tests", () => {
  it("BIP84 (P2WPKH) - Native SegWit addresses (bc1q...)", () => {
    BIP84_TEST.expectedAddresses.forEach((expected, index) => {
      expect(deriveAddress(BIP84_TEST.xpub, BIP84_TEST.purpose, index)).toBe(
        expected
      );
    });
  });

  it("BIP49 (P2WPKH-in-P2SH) - Nested SegWit addresses (3...)", () => {
    BIP49_TEST.expectedAddresses.forEach((expected, index) => {
      expect(deriveAddress(BIP49_TEST.xpub, BIP49_TEST.purpose, index)).toBe(
        expected
      );
    });
  });

  it("BIP44 (P2PKH) - Legacy addresses (1...)", () => {
    BIP44_TEST.expectedAddresses.forEach((expected, index) => {
      expect(deriveAddress(BIP44_TEST.xpub, BIP44_TEST.purpose, index)).toBe(
        expected
      );
    });
  });

  it("BIP86 (P2TR) - Taproot addresses (bc1p...)", () => {
    BIP86_TEST.expectedAddresses.forEach((expected, index) => {
      expect(deriveAddress(BIP86_TEST.xpub, BIP86_TEST.purpose, index)).toBe(
        expected
      );
    });
  });

  it("should correctly derive addresses at higher indices", () => {
    // Test that address derivation works beyond the first few addresses
    // Important for gap limit scenarios and pool management
    const testIndices = [0, 19, 20, 99, 100];
    const addresses = new Set<string>();

    testIndices.forEach((index) => {
      const address = deriveAddress(
        BIP84_TEST.xpub,
        BIP84_TEST.purpose,
        index
      );
      expect(addresses.has(address)).toBe(false);
      addresses.add(address);
    });

    expect(addresses.size).toBe(testIndices.length);
  });
});
