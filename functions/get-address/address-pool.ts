import { getStore } from "@netlify/blobs";
import { HDKey } from "@scure/bip32";
import { bech32, bech32m, createBase58check } from "@scure/base";
import { sha256 } from "@noble/hashes/sha2.js";
import { ripemd160 } from "@noble/hashes/legacy.js";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { utf8ToBytes, concatBytes, bytesToHex } from "@noble/hashes/utils.js";
import { isValidBitcoinAddress } from "./validation.js";

export interface AddressPoolEntry {
  index: number;
  address: string;
  lastCheck: number;
  hasActivity: boolean;
}

export interface AddressPoolState {
  currentIndex: number;
  lastRotation: number;
  pool: AddressPoolEntry[];
}

const POOL_SIZE = 5;
const ROTATION_INTERVAL = 10 * 60 * 1000; // 10 minutes
const STORE_NAME = "address-pool";
const ACTIVITY_CHECK_TIMEOUT = 5000; // 5s per mempool.space request

/**
 * Raised when an address's on-chain activity could not be determined. Kept
 * distinct from "unused" so an unverifiable address is never served as fresh.
 */
export class ActivityCheckError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ActivityCheckError";
  }
}

/**
 * Generate a hash of the environment configuration for cache key versioning
 */
function generateEnvironmentHash(xpub: string, derivationPath: string): string {
  const configString = `${xpub}:${derivationPath}`;
  const hash = sha256(utf8ToBytes(configString));
  return bytesToHex(hash).slice(0, 16); // Use first 16 chars for shorter keys
}

/** BIP340/BIP341 tagged hash: H_tag(m) = sha256(sha256(tag)||sha256(tag)||m) */
function taggedHash(tag: string, m: Uint8Array): Uint8Array {
  const t = utf8ToBytes(tag);
  const th = sha256(t);
  return sha256(concatBytes(th, th, m));
}

/** BIP86 output key = P + H_TapTweak(P)*G (no script tree) -> return x-only(Q) */
function taprootTweakXOnly(internalXOnly: Uint8Array): Uint8Array {
  const tweak = taggedHash("TapTweak", internalXOnly);
  const tweakBig = BigInt("0x" + bytesToHex(tweak));

  // Lift x-only to even-Y point per BIP340: use compressed key 0x02||X
  const P = secp256k1.Point.fromHex("02" + bytesToHex(internalXOnly));

  // Q = P + tweak*G   (handle rare tweak==0 gracefully)
  const Q =
    tweakBig === 0n ? P : P.add(secp256k1.Point.BASE.multiply(tweakBig));

  // Return x-only bytes of Q (drop 0x02/0x03)
  return Q.toBytes(true).slice(1);
}

/**
 * Get version bytes for HDKey based on BIP purpose
 */
function getVersionBytes(purpose: number): {
  public: number;
  private: number;
} {
  switch (purpose) {
    case 44:
      return { public: 0x488b21e, private: 0x488ade4 }; // xpub / xprv
    case 49:
      return { public: 0x49d7cb2, private: 0x49d7878 }; // ypub / yprv
    case 84:
      return { public: 0x4b24746, private: 0x4b2430c }; // zpub / zprv
    case 86:
      return { public: 0x488b21e, private: 0x488ade4 }; // xpub / xprv
    default:
      throw new Error(
        `Unsupported purpose: ${purpose}. Supported: 44 (P2PKH), 49 (P2WPKH-in-P2SH), 84 (P2WPKH), 86 (P2TR)`
      );
  }
}

/**
 * Derive a Bitcoin address from an extended public key at the given index
 */
export function deriveAddress(
  xpub: string,
  purpose: number,
  index: number
): string {
  // Try to create HDKey without version strings first (let it auto-detect)
  let hdkey: HDKey;
  try {
    hdkey = HDKey.fromExtendedKey(xpub);
  } catch {
    // If auto-detection fails, try with explicit version strings
    const versions = getVersionBytes(purpose);
    hdkey = HDKey.fromExtendedKey(xpub, versions);
  }

  // Derive the child key for this address index
  // XPUB is at account level, so we derive to change level (0 for receiving) then to address index
  // Note: We can only derive non-hardened children from XPUB
  const child = hdkey.derive(`m/0/${index}`);

  if (!child.publicKey) {
    throw new Error(`Failed to derive public key for index ${index}`);
  }

  const base58check = createBase58check(sha256);
  const HASH160 = (buf: Uint8Array) => ripemd160(sha256(buf));

  switch (purpose) {
    case 44: {
      // Legacy P2PKH: base58check(version + HASH160(pubkey))
      const payload = new Uint8Array([0x00, ...HASH160(child.publicKey)]);
      return base58check.encode(payload);
    }
    case 49: {
      // P2WPKH-in-P2SH: base58check(version + HASH160(redeemScript))
      const redeemScript = new Uint8Array([
        0x00,
        0x14,
        ...HASH160(child.publicKey),
      ]);
      const payload = new Uint8Array([0x05, ...HASH160(redeemScript)]);
      return base58check.encode(payload);
    }
    case 84: {
      // Native SegWit (P2WPKH): bech32 encode witness v0 + HASH160(pubkey)
      const words = bech32.toWords(HASH160(child.publicKey));
      words.unshift(0x00); // witness version 0
      return bech32.encode("bc", words);
    }
    case 86: {
      // Taproot (P2TR)
      const xOnlyInternal = child.publicKey.slice(1, 33);
      const xOnlyTweaked = taprootTweakXOnly(xOnlyInternal);
      const words = bech32m.toWords(xOnlyTweaked);
      words.unshift(0x01); // v1
      return bech32m.encode("bc", words);
    }
    default:
      throw new Error(
        `Unsupported purpose: ${purpose}. Supported: 44 (P2PKH), 49 (P2WPKH-in-P2SH), 84 (P2WPKH), 86 (P2TR)`
      );
  }
}

/**
 * Derive an address and verify it decodes before it can be stored or served.
 * Throws rather than risk publishing an address donors can pay but you cannot see.
 */
export function deriveValidatedAddress(
  xpub: string,
  purpose: number,
  index: number
): string {
  const address = deriveAddress(xpub, purpose, index);

  if (!isValidBitcoinAddress(address)) {
    throw new Error(
      `Derived address at index ${index} failed validation. ` +
        `Check that BITCOIN_XPUB and BITCOIN_DERIVATION_PATH describe the same account.`
    );
  }

  return address;
}

export class AddressPoolManager {
  private store: ReturnType<typeof getStore>;
  private xpub: string;
  private derivationPath: string;
  private environmentHash: string;
  private cacheKey: string;

  constructor(xpub: string, derivationPath: string) {
    this.store = getStore(STORE_NAME);
    this.xpub = xpub;
    this.derivationPath = derivationPath;
    this.environmentHash = generateEnvironmentHash(xpub, derivationPath);
    this.cacheKey = `pool-state-${this.environmentHash}`;
  }

  /**
   * Detect purpose from derivation path
   */
  private detectPurpose(): number {
    // Extract purpose from derivation path (e.g., m/84'/0'/0' -> 84)
    const match = this.derivationPath.match(/m\/(\d+)'/);
    if (match) {
      return parseInt(match[1], 10);
    }
    // Default to BIP84 if no purpose found
    return 84;
  }

  /**
   * Check if an address has activity on mempool.space
   * @throws {ActivityCheckError} if activity could not be determined
   */
  private async checkAddressActivity(address: string): Promise<boolean> {
    let data: any;

    try {
      const response = await fetch(
        `https://mempool.space/api/address/${address}`,
        { signal: AbortSignal.timeout(ACTIVITY_CHECK_TIMEOUT) }
      );

      if (!response.ok) {
        throw new Error(`Mempool API error: ${response.status}`);
      }

      data = await response.json();
    } catch (error) {
      // Network failure, timeout or rate limit: refuse to guess
      throw new ActivityCheckError(
        `Could not determine activity for address ${address}`,
        { cause: error }
      );
    }

    const chainTxCount = data?.chain_stats?.tx_count;
    const mempoolTxCount = data?.mempool_stats?.tx_count;

    if (typeof chainTxCount !== "number" || typeof mempoolTxCount !== "number") {
      throw new ActivityCheckError(
        `Unexpected mempool.space response shape for address ${address}`
      );
    }

    return chainTxCount > 0 || mempoolTxCount > 0;
  }

  /**
   * Get the current pool state from Netlify Blobs, with its etag so writes can
   * be made conditional on nothing else having changed it.
   */
  private async readPoolState(): Promise<{
    state: AddressPoolState | null;
    etag?: string;
  }> {
    try {
      const result = await this.store.getWithMetadata(this.cacheKey, {
        type: "json",
      });

      if (!result) return { state: null };

      return {
        state: result.data as AddressPoolState,
        etag: result.etag,
      };
    } catch (error) {
      console.error("Failed to get pool state:", error);
      return { state: null };
    }
  }

  /**
   * Save pool state, but only if the stored entry still matches the etag we
   * read, so concurrent invocations cannot clobber one another.
   * @returns Whether this write won the race
   */
  private async savePoolState(
    state: AddressPoolState,
    etag?: string
  ): Promise<boolean> {
    try {
      const result = await this.store.set(
        this.cacheKey,
        JSON.stringify(state),
        etag ? { onlyIfMatch: etag } : { onlyIfNew: true }
      );
      return result.modified;
    } catch (error) {
      console.error("Failed to save pool state:", error);
      throw error;
    }
  }

  /** Read the address a pool state is serving, verifying it on the way out */
  private currentAddressOf(state: AddressPoolState): string {
    const entry = state.pool[state.currentIndex];

    if (!entry || !isValidBitcoinAddress(entry.address)) {
      throw new Error(
        `Pool state is corrupt: no valid address at index ${state.currentIndex}`
      );
    }

    return entry.address;
  }

  /**
   * Check that stored state is structurally sound and every address decodes.
   * Storage is untrusted: a truncated or hand-edited blob must not reach a donor.
   */
  private isUsablePoolState(state: unknown): state is AddressPoolState {
    if (!state || typeof state !== "object") return false;

    const candidate = state as AddressPoolState;

    if (!Array.isArray(candidate.pool) || candidate.pool.length === 0) {
      return false;
    }
    if (
      !Number.isInteger(candidate.currentIndex) ||
      candidate.currentIndex < 0 ||
      candidate.currentIndex >= candidate.pool.length
    ) {
      return false;
    }
    if (typeof candidate.lastRotation !== "number") return false;

    return candidate.pool.every((entry) =>
      isValidBitcoinAddress(entry?.address)
    );
  }

  /**
   * Initialize a new address pool. Written with `onlyIfNew`, so a concurrent
   * invocation that created the pool first wins. When replacing state known to
   * be corrupt, the write is conditional on that entry instead.
   */
  private async initializePool(
    replacingEtag?: string
  ): Promise<AddressPoolState> {
    const purpose = this.detectPurpose();
    const pool: AddressPoolEntry[] = [];

    for (let i = 0; i < POOL_SIZE; i++) {
      pool.push({
        index: i,
        address: deriveValidatedAddress(this.xpub, purpose, i),
        lastCheck: Date.now(),
        hasActivity: false,
      });
    }

    const state: AddressPoolState = {
      currentIndex: 0,
      lastRotation: Date.now(),
      pool,
    };

    const won = await this.savePoolState(state, replacingEtag);

    if (!won) {
      const { state: existing } = await this.readPoolState();
      if (this.isUsablePoolState(existing)) return existing;
    }

    return state;
  }

  /**
   * Replace used addresses in the pool with fresh ones
   * Removes used addresses and adds fresh ones to the end, maintaining sequential generation
   *
   * @param selectedAddress The address rotation picked, if any. currentIndex is
   *   re-anchored to it so we serve the address we verified, not merely the first unused one.
   */
  private replaceUsedAddresses(
    state: AddressPoolState,
    selectedAddress: string | null
  ): AddressPoolState {
    const usedAddresses = state.pool.filter((entry) => entry.hasActivity);
    const unusedAddresses = state.pool.filter((entry) => !entry.hasActivity);

    if (usedAddresses.length === 0) {
      return state;
    }

    // Find the highest index in the pool to continue from
    const maxIndex = Math.max(...state.pool.map((entry) => entry.index));
    let nextIndex = maxIndex + 1;

    const purpose = this.detectPurpose();

    // Start with unused addresses, then add fresh ones to the end
    const newPool = [...unusedAddresses];

    // Generate fresh addresses for each used address
    for (const _usedEntry of usedAddresses) {
      newPool.push({
        index: nextIndex,
        address: deriveValidatedAddress(this.xpub, purpose, nextIndex),
        lastCheck: Date.now(),
        hasActivity: false,
      });
      nextIndex++;
    }

    // Fall back to the first entry, which is freshly derived and so unused
    const selectedPosition = selectedAddress
      ? newPool.findIndex((entry) => entry.address === selectedAddress)
      : -1;

    return {
      ...state,
      pool: newPool,
      currentIndex: selectedPosition >= 0 ? selectedPosition : 0,
    };
  }

  /**
   * Get the current address to serve, handling rotation logic. Rotation is
   * all-or-nothing: if activity cannot be verified, or another invocation
   * rotated first, stored state is left alone.
   */
  async getCurrentAddress(): Promise<string> {
    const { state: stored, etag } = await this.readPoolState();

    if (!stored) {
      return this.currentAddressOf(await this.initializePool());
    }

    if (!this.isUsablePoolState(stored)) {
      console.error("Stored pool state is unusable - reinitialising");
      return this.currentAddressOf(await this.initializePool(etag));
    }

    const now = Date.now();

    if (now - stored.lastRotation < ROTATION_INTERVAL) {
      return this.currentAddressOf(stored);
    }

    let rotated: AddressPoolState;
    try {
      rotated = await this.rotate(stored, now);
    } catch (error) {
      if (error instanceof ActivityCheckError) {
        console.error(
          "Skipping rotation - address activity could not be verified:",
          error.message
        );
        return this.currentAddressOf(stored);
      }
      throw error;
    }

    const won = await this.savePoolState(rotated, etag);

    if (!won) {
      // Another invocation rotated first; serve its result rather than overwrite
      const { state: fresh } = await this.readPoolState();
      if (fresh) return this.currentAddressOf(fresh);
    }

    return this.currentAddressOf(rotated);
  }

  /**
   * Advance to the next unused address, replacing any found to have activity.
   * Operates on a copy so a failed rotation leaves no half-updated state.
   * @throws {ActivityCheckError} if any address's activity is indeterminate
   */
  private async rotate(
    state: AddressPoolState,
    now: number
  ): Promise<AddressPoolState> {
    const working: AddressPoolState = {
      ...state,
      pool: state.pool.map((entry) => ({ ...entry })),
    };

    let selectedAddress: string | null = null;
    let candidateIndex = (working.currentIndex + 1) % working.pool.length;

    for (let i = 0; i < working.pool.length; i++) {
      const entry = working.pool[candidateIndex];

      const hasActivity = await this.checkAddressActivity(entry.address);

      entry.hasActivity = hasActivity;
      entry.lastCheck = now;

      if (!hasActivity) {
        selectedAddress = entry.address;
        working.currentIndex = candidateIndex;
        break;
      }

      candidateIndex = (candidateIndex + 1) % working.pool.length;
    }

    const next = this.replaceUsedAddresses(working, selectedAddress);
    next.lastRotation = now;
    return next;
  }

  /**
   * Get pool statistics for debugging
   */
  async getPoolStats(): Promise<{
    poolSize: number;
    usedAddresses: number;
    unusedAddresses: number;
    lastRotation: number;
    timeUntilNextRotation: number;
    currentAddress: string;
    poolEntries: Array<{
      index: number;
      address: string;
      hasActivity: boolean;
      lastCheck: number;
    }>;
  }> {
    const { state } = await this.readPoolState();

    if (!state) {
      return {
        poolSize: 0,
        usedAddresses: 0,
        unusedAddresses: 0,
        lastRotation: 0,
        timeUntilNextRotation: 0,
        currentAddress: "",
        poolEntries: [],
      };
    }

    const usedAddresses = state.pool.filter(
      (entry) => entry.hasActivity
    ).length;
    const unusedAddresses = state.pool.length - usedAddresses;
    const timeUntilNextRotation = Math.max(
      0,
      ROTATION_INTERVAL - (Date.now() - state.lastRotation)
    );
    const currentAddress = state.pool[state.currentIndex]?.address || "";

    return {
      poolSize: state.pool.length,
      usedAddresses,
      unusedAddresses,
      lastRotation: state.lastRotation,
      timeUntilNextRotation,
      currentAddress,
      poolEntries: state.pool.map((entry) => ({
        index: entry.index,
        address: entry.address,
        hasActivity: entry.hasActivity,
        lastCheck: entry.lastCheck,
      })),
    };
  }

  /**
   * Force a pool rotation (useful for testing)
   */
  async forceRotation(): Promise<string> {
    const { state, etag } = await this.readPoolState();

    if (!state) {
      throw new Error("No pool state found");
    }

    // Force rotation by setting lastRotation to a time that would trigger rotation
    state.lastRotation = Date.now() - ROTATION_INTERVAL - 1;
    await this.savePoolState(state, etag);

    // Get the new address (this will trigger rotation)
    return await this.getCurrentAddress();
  }
}
