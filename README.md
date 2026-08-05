# Bitcoin Serverless Donations

Accept private, on-chain Bitcoin payments with no database, no middlemen, and no server maintenance. Payments go directly to your own wallet.

This repository contains both the serverless backend and an npm package for the frontend.

![Bitcoin Serverless Donations widget](/src/img/preview.png)

## Quick Start

### Backend

One click deployment to Netlify — set your environment variables and deploy.

[![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/bennet-org/bitcoin-serverless-donations#BITCOIN_XPUB=your_extended_public_key&BITCOIN_DERIVATION_PATH=your_account_path)

### Frontend

Add the CDN script and stylesheet, then call `BitcoinPay.render()`:

```html
<link
  rel="stylesheet"
  href="https://cdn.jsdelivr.net/npm/bitcoin-serverless-donations@latest/dist/bitcoin-pay.min.css"
/>
<script src="https://cdn.jsdelivr.net/npm/bitcoin-serverless-donations@latest/dist/bitcoin-pay.min.js"></script>

<div id="bitcoin-donate"></div>

<script>
  BitcoinPay.render({
    endpoint: "https://your-site.netlify.app/.netlify/functions/get-address",
    selector: "#bitcoin-donate",
    bitcoinFallbackAddress: "bc1q...",
    lightningAddress: "yourname@provider.com",
  }).catch((error) => {
    console.error("Failed to render Bitcoin widget:", error);
  });
</script>
```

For a complete walkthrough, see [the tutorial on my blog](https://bennet.org/resources/private-serverless-bitcoin-donations/). Until [Silent Payments](https://bennet.org/learn/silent-payments-bitcoin-privacy/) gain widespread adoption, address rotation remains a solid approach to maintaining privacy when accepting donations.

## Backend Setup

1. **Clone and install**
   ```bash
   git clone https://github.com/bennet-org/bitcoin-serverless-donations.git
   cd bitcoin-serverless-donations
   npm install
   ```
2. **Set your environment variables in `.env`**:

   ```bash
   BITCOIN_XPUB="xpub6..."
   BITCOIN_DERIVATION_PATH="m/84'/0'/0'"
   ```

3. **Test locally** — verify that derived addresses match your wallet software
   ```bash
   npm run dev
   ```
4. **Deploy to Netlify** and set both environment variables in your deployment settings. Your endpoint will be at:

   ```
   /.netlify/functions/get-address
   ```

### Derivation Paths

| Standard               | Path          | Address format           | XPUB prefix |
| ---------------------- | ------------- | ------------------------ | ----------- |
| BIP86 (P2TR)           | `m/86'/0'/0'` | Taproot, `bc1p...`       | `xpub`      |
| BIP84 (P2WPKH)         | `m/84'/0'/0'` | Native SegWit, `bc1q...` | `zpub`      |
| BIP49 (P2WPKH-in-P2SH) | `m/49'/0'/0'` | Nested SegWit, `3...`    | `ypub`      |
| BIP44 (P2PKH)          | `m/44'/0'/0'` | Legacy, `1...`           | `xpub`      |

Your XPUB should be from the **account level** (e.g., `m/84'/0'/0'`). The function derives receiving addresses (`/0/index`) from there. Make sure values are enclosed in quotes, e.g. `BITCOIN_DERIVATION_PATH="m/84'/0'/0'"`.

**Always verify that your first few generated addresses match your wallet software.** This is critical to ensure you can actually receive funds.

For implementation details and cache management, see [TECHNICAL.md](TECHNICAL.md).

## Frontend Setup

### Loading the library

The Quick Start example above uses the CDN. Alternatively, install via npm for use with a bundler:

```bash
npm install bitcoin-serverless-donations
```

```javascript
import { BitcoinPay } from "bitcoin-serverless-donations";
import "bitcoin-serverless-donations/css";
```

### Options

`BitcoinPay.render()` accepts the following:

| Option                   | Description                                                                        |
| ------------------------ | ---------------------------------------------------------------------------------- |
| `selector`               | CSS selector for the target element(s), e.g. `#bitcoin-donate`                     |
| `endpoint`               | Full URL of your backend function                                                  |
| `bitcoinFallbackAddress` | Address to use if the backend is unavailable                                       |
| `bitcoinDonateText`      | Custom HTML above the Bitcoin address field                                        |
| `lightningAddress`       | [Lightning address](https://lightningaddress.com/) for dual Bitcoin/Lightning mode |
| `lightningDonateText`    | Custom HTML above the Lightning address field                                      |

You can render multiple widgets by using a class selector (e.g. `.donation-widget`) or by calling `BitcoinPay.render()` multiple times. See [bitcoin-pay.js](/src/bitcoin-pay.js) for the full API.

> **Note:** `bitcoinDonateText`, `lightningDonateText`, `copyButtonText` and `copiedText` are inserted as raw HTML, so markup in them renders. Don't pass user-supplied or otherwise untrusted content to them.

### Styling

Customise the widget with CSS custom properties. Dark mode is supported automatically via `prefers-color-scheme`.

```css
.bitcoin-pay-widget {
  --btc-pay-primary: #2563eb;
  --btc-pay-primary-hover: #1d4ed8;
  --btc-pay-border-radius: 4px;
}
```

See [bitcoin-pay.css](/src/bitcoin-pay.css) for all available variables.

## Contributing

Pull requests welcome. Please make sure tests pass before submitting.

## License

MIT — see [LICENSE](LICENSE).
