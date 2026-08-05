# Technical Documentation

Implementation details for the Bitcoin address pool system. For setup instructions, see [README.md](README.md).

## Address Derivation

Addresses are derived from your XPUB using the [noble](https://github.com/paulmillr/noble-curves) and [scure](https://github.com/paulmillr/scure-bip32) cryptographic libraries — audited, zero-dependency packages also used by bitcoinjs-lib, ethers.js, and viem. Derivation is deterministic: the same XPUB always produces the same addresses in the same order.

BIP44 (P2PKH), BIP49 (P2WPKH-in-P2SH), BIP84 (P2WPKH), and BIP86 (P2TR) are all supported. The address type is detected automatically from your derivation path.

## Address Pool Management

The function maintains a pool of 5 addresses, persisted in Netlify Blobs:

```typescript
{
  currentIndex: number;   // Current rotation position within `pool`
  lastRotation: number;   // Timestamp of last rotation
  pool: Array<{
    index: number;        // Derivation index (m/0/index)
    address: string;      // Derived address
    lastCheck: number;    // Timestamp of last activity check
    hasActivity: boolean; // Whether the address has been paid
  }>;
}
```

Every 10 minutes, the pool rotates to the next address. Before serving it, the function checks the mempool.space API to see if the address has received any transactions. If it has, the function skips to the next unused address and replaces the used one with a freshly derived address.

Rotation is all-or-nothing: if any address's activity cannot be determined, it is abandoned and the pool keeps serving its current address. State is written conditionally, so when several invocations hit the rotation boundary at once, one wins and the rest adopt its result.

The cache key is a hash of your XPUB and derivation path, so changing either automatically invalidates the pool.

### Manual Cache Clearing

**Via Netlify CLI:**

```bash
netlify blobs:delete address-pool pool-state-<hash>
```

**Via Netlify Dashboard:** go to Project > Blobs > `address-pool` and delete the relevant blob. The pool regenerates automatically on the next invocation.

## API

`GET /.netlify/functions/get-address`

```json
{ "address": "bc1q..." }
```

Returns `200` on success, `500` on error (invalid XPUB, derivation failure, etc.).

## Error Handling

- **mempool.space unavailable**: rotation is skipped and the current address keeps being served. An address of unknown status is never treated as unused.
- **Invalid XPUB**: returns 500 with a validation message
- **Corrupted pool state**: reinitialises with fresh addresses
- **Invalid address format**: derived addresses are checksum-verified before being stored or served; a failure returns 500
- **Concurrent invocations**: one rotation wins; the others serve its result

Apart from environment-variable errors, responses are generic — details go to the function log.

## Security

- Your XPUB is stored as an environment variable and never exposed to clients
- An XPUB only grants read-only access — funds cannot be spent
- 10-minute rotation and used-address detection prevent address reuse
- Addresses are checksum-validated before being served, and validated again client-side before being rendered or encoded into a QR code

### Privacy note: mempool.space

Used-address detection queries `mempool.space`, disclosing every address in your pool to a third party who can then link them to each other and to your traffic. Paid addresses are already public, but the *grouping* is not. To avoid this, point `checkAddressActivity` at your own Electrum or Esplora instance.
