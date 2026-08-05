/**
 * Tests for the client widget's handling of untrusted address data. Everything
 * reaching the render/QR sink — endpoint response, localStorage cache,
 * configured fallback — is treated as untrusted.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
// @ts-expect-error - plain JS module without type declarations
import BitcoinPay from "./bitcoin-pay.js";

const VALID_ADDRESS = "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu";
const OTHER_VALID_ADDRESS = "bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g";

// The payload from the security audit
const INJECTION_PAYLOAD = `bc1qxxx"><img src=x onerror=alert(document.domain)>`;

function createLocalStorageStub() {
  const entries = new Map<string, string>();
  return {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => entries.set(key, String(value)),
    removeItem: (key: string) => entries.delete(key),
    entries,
  };
}

describe("widget markup escaping", () => {
  const instance = new BitcoinPay();

  it("does not emit raw markup from the Bitcoin address", () => {
    const html = instance.createSingleWidgetHTML(
      INJECTION_PAYLOAD,
      undefined,
      instance.defaultConfig,
      "test123"
    );

    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x");
    // The attribute must not be broken out of either
    expect(html).not.toContain(`bitcoin:bc1qxxx">`);
  });

  it("does not emit raw markup from the Lightning address", () => {
    const html = instance.createDualWidgetHTML(
      VALID_ADDRESS,
      `me@example.com"><script>alert(1)</script>`,
      undefined,
      undefined,
      instance.defaultConfig,
      "test123"
    );

    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("renders a legitimate address unchanged", () => {
    const html = instance.createSingleWidgetHTML(
      VALID_ADDRESS,
      undefined,
      instance.defaultConfig,
      "test123"
    );

    expect(html).toContain(`<span>${VALID_ADDRESS}</span>`);
    expect(html).toContain(`href="bitcoin:${VALID_ADDRESS}"`);
  });
});

describe("address sourcing", () => {
  let storage: ReturnType<typeof createLocalStorageStub>;

  beforeEach(() => {
    storage = createLocalStorageStub();
    vi.stubGlobal("localStorage", storage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("discards a tampered cache entry and re-fetches", async () => {
    const instance = new BitcoinPay();

    // Simulate an attacker with write access to this origin's storage
    storage.setItem("addr", INJECTION_PAYLOAD);
    storage.setItem("ts", Date.now().toString());

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ address: OTHER_VALID_ADDRESS }),
      }))
    );

    const address = await instance.getBitcoinAddress(
      "https://example.test/endpoint",
      "addr",
      "ts",
      instance.defaultConfig,
      VALID_ADDRESS
    );

    expect(address).toBe(OTHER_VALID_ADDRESS);
    expect(globalThis.fetch).toHaveBeenCalled();
    expect(storage.getItem("addr")).toBe(OTHER_VALID_ADDRESS);
  });

  it("still serves a valid cache entry without re-fetching", async () => {
    const instance = new BitcoinPay();

    storage.setItem("addr", VALID_ADDRESS);
    storage.setItem("ts", Date.now().toString());
    vi.stubGlobal("fetch", vi.fn());

    const address = await instance.getBitcoinAddress(
      "https://example.test/endpoint",
      "addr",
      "ts",
      instance.defaultConfig,
      OTHER_VALID_ADDRESS
    );

    expect(address).toBe(VALID_ADDRESS);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("rejects a non-address from the endpoint and falls back", async () => {
    const instance = new BitcoinPay();

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ address: INJECTION_PAYLOAD }),
      }))
    );

    const address = await instance.getBitcoinAddress(
      "https://example.test/endpoint",
      "addr",
      "ts",
      instance.defaultConfig,
      VALID_ADDRESS
    );

    expect(address).toBe(VALID_ADDRESS);
    // A rejected address must never be cached
    expect(storage.getItem("addr")).toBeNull();
  });
});

describe("render configuration validation", () => {
  it("rejects a bitcoinFallbackAddress that is not a Bitcoin address", async () => {
    await expect(
      BitcoinPay.render({
        endpoint: "https://example.test/endpoint",
        selector: "#target",
        bitcoinFallbackAddress: INJECTION_PAYLOAD,
      })
    ).rejects.toThrow(/not a valid Bitcoin address/);
  });
});
