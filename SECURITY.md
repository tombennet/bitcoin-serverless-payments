# Security Policy

## Reporting a vulnerability

Report privately via [GitHub Security Advisories](https://github.com/bennet-org/bitcoin-serverless-donations/security/advisories/new) rather than opening a public issue. Include steps to reproduce and the impact you believe it has.

Fixes are released against the latest published version only.

## Scope

Most relevant, in rough order of severity:

- Address derivation in `functions/get-address/` — anything producing an address the operator cannot spend from, or that leaks the XPUB
- Anything causing a used address to be served again, defeating rotation
- The widget's handling of the address it receives, since it renders that address and encodes it into a QR code donors scan

## Documented behaviour, not vulnerabilities

- `bitcoinDonateText`, `lightningDonateText`, `copyButtonText` and `copiedText` are inserted as raw HTML (see [README](README.md))
- Used-address detection discloses your whole address pool to mempool.space (see [TECHNICAL.md](TECHNICAL.md))
- Address validation confirms an address is well formed, not that it belongs to you — always check derived addresses against your wallet before accepting donations

## For operators

An XPUB is read-only and never sent to clients, but anyone holding it can see every address you derive and its balance. Keep it in environment variables, never in client code.
