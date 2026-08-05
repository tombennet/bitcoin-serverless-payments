/**
 * Tests for address pool rotation. Two properties keep an already-paid address
 * from being served again: activity that cannot be verified is never treated
 * as "unused", and concurrent invocations cannot clobber one another.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

const fake = vi.hoisted(() => {
  let entry: { value: string; etag: string } | null = null;
  let counter = 0;

  const store = {
    async getWithMetadata(_key: string) {
      if (!entry) return null;
      return { data: JSON.parse(entry.value), etag: entry.etag, metadata: {} };
    },
    async set(_key: string, data: string, options?: any) {
      if (options?.onlyIfNew && entry) return { modified: false };
      if (
        options?.onlyIfMatch &&
        (!entry || entry.etag !== options.onlyIfMatch)
      ) {
        return { modified: false };
      }
      entry = { value: data, etag: `etag-${++counter}` };
      return { modified: true, etag: entry.etag };
    },
  };

  return {
    store,
    reset: () => {
      entry = null;
      counter = 0;
    },
    peek: () => (entry ? JSON.parse(entry.value) : null),
    overwrite: (state: unknown) => {
      entry = { value: JSON.stringify(state), etag: `etag-${++counter}` };
    },
  };
});

vi.mock("@netlify/blobs", () => ({ getStore: () => fake.store }));

const { AddressPoolManager } = await import("./address-pool.ts");

const XPUB =
  "zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs";
const PATH = "m/84'/0'/0'";
const FIRST_ADDRESS = "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu";

const ROTATION_INTERVAL = 10 * 60 * 1000;

/** mempool.space response for an address with no transactions */
function unusedResponse() {
  return {
    ok: true,
    json: async () => ({
      chain_stats: { tx_count: 0 },
      mempool_stats: { tx_count: 0 },
    }),
  };
}

describe("AddressPoolManager", () => {
  beforeEach(() => {
    fake.reset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("initialises a pool and serves its first address", async () => {
    const manager = new AddressPoolManager(XPUB, PATH);
    expect(await manager.getCurrentAddress()).toBe(FIRST_ADDRESS);
    expect(fake.peek().pool).toHaveLength(5);
  });

  it("serves the current address without rotating inside the interval", async () => {
    const manager = new AddressPoolManager(XPUB, PATH);
    await manager.getCurrentAddress();

    vi.stubGlobal("fetch", vi.fn());
    expect(await manager.getCurrentAddress()).toBe(FIRST_ADDRESS);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("rotates to the next address once the interval has elapsed", async () => {
    const manager = new AddressPoolManager(XPUB, PATH);
    await manager.getCurrentAddress();

    const state = fake.peek();
    state.lastRotation = Date.now() - ROTATION_INTERVAL - 1;
    fake.overwrite(state);

    vi.stubGlobal("fetch", vi.fn(async () => unusedResponse()));

    const address = await manager.getCurrentAddress();
    expect(address).not.toBe(FIRST_ADDRESS);
    expect(address).toBe(state.pool[1].address);
  });

  it("does not rotate when address activity cannot be verified", async () => {
    const manager = new AddressPoolManager(XPUB, PATH);
    await manager.getCurrentAddress();

    const state = fake.peek();
    state.lastRotation = Date.now() - ROTATION_INTERVAL - 1;
    fake.overwrite(state);
    const etagBefore = fake.peek();

    // mempool.space unreachable: activity is indeterminate
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network unreachable");
      })
    );

    // Keeps serving the address already in use rather than guessing
    expect(await manager.getCurrentAddress()).toBe(FIRST_ADDRESS);
    // ...and leaves stored state untouched, so no index is burned
    expect(fake.peek()).toEqual(etagBefore);
  });

  it("does not rotate on an unexpected mempool.space response shape", async () => {
    const manager = new AddressPoolManager(XPUB, PATH);
    await manager.getCurrentAddress();

    const state = fake.peek();
    state.lastRotation = Date.now() - ROTATION_INTERVAL - 1;
    fake.overwrite(state);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ error: "banned" }) }))
    );

    expect(await manager.getCurrentAddress()).toBe(FIRST_ADDRESS);
  });

  it("yields to a concurrent invocation that rotated first", async () => {
    const manager = new AddressPoolManager(XPUB, PATH);
    await manager.getCurrentAddress();

    const state = fake.peek();
    state.lastRotation = Date.now() - ROTATION_INTERVAL - 1;
    fake.overwrite(state);

    const winnerAddress = state.pool[3].address;

    // A second invocation completes its rotation while ours is mid-flight
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        fake.overwrite({
          ...state,
          currentIndex: 3,
          lastRotation: Date.now(),
        });
        return unusedResponse();
      })
    );

    // Our conditional write loses, so we serve the winner's address
    expect(await manager.getCurrentAddress()).toBe(winnerAddress);
    expect(fake.peek().currentIndex).toBe(3);
  });

  it("reinitialises when stored state is corrupt", async () => {
    fake.overwrite({ currentIndex: 9, lastRotation: "nope", pool: [] });

    const manager = new AddressPoolManager(XPUB, PATH);
    expect(await manager.getCurrentAddress()).toBe(FIRST_ADDRESS);
    expect(fake.peek().pool).toHaveLength(5);
  });

  it("reinitialises when stored state contains an invalid address", async () => {
    fake.overwrite({
      currentIndex: 0,
      lastRotation: Date.now(),
      pool: [
        {
          index: 0,
          address: `bc1qxxx"><script>alert(1)</script>`,
          lastCheck: Date.now(),
          hasActivity: false,
        },
      ],
    });

    const manager = new AddressPoolManager(XPUB, PATH);
    expect(await manager.getCurrentAddress()).toBe(FIRST_ADDRESS);
  });
});
