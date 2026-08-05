/**
 * Bitcoin Serverless Payments - Client Library
 * Self-custodial widget for accepting private, on-chain Bitcoin payments
 */

import generateQrSvg from "./qr.js";

/** Base58Check (P2PKH "1...", P2SH "3...") and Bech32/Bech32m (SegWit "bc1...") */
const BITCOIN_ADDRESS_PATTERN =
  /^(?:[13][a-km-zA-HJ-NP-Z1-9]{25,34}|bc1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{6,87})$/;

/**
 * Format check applied before an address is rendered, encoded into a QR code,
 * or cached. Rejects anything that could alter the surrounding markup, but
 * cannot tell you an address belongs to the intended recipient.
 */
function isValidBitcoinAddress(address) {
  return typeof address === "string" && BITCOIN_ADDRESS_PATTERN.test(address);
}

/** Escape a value for interpolation into markup */
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

class BitcoinPay {
  constructor() {
    this.version = "0.0.0"; // Auto-injected from package.json during build
    this.defaultConfig = {
      width: 200,
      height: 200,
      showCopyButton: true,
      copyButtonText: "Copy",
      copiedText: "Copied!",
      cacheDuration: 10 * 60 * 1000, // 10 minutes
      qrCodeOptions: {
        ecc: "H",
        logo: "btc", // 'btc' | 'lightning' | undefined
        bitcoinImage: "__BITCOIN_LOGO__",
        lightningImage: "__LIGHTNING_LOGO__",
      },
    };
  }

  /**
   * Static method to render the Bitcoin donation widget
   * @param {Object} config - Configuration object
   * @param {string} config.endpoint - The serverless function endpoint URL
   * @param {string} config.selector - CSS selector for the target element(s)
   * @param {string} config.bitcoinFallbackAddress - Fallback Bitcoin address to use if the serverless function fails
   * @param {string} config.bitcoinDonateText - Optional custom text to display above the Bitcoin address field
   * @param {string} config.lightningAddress - Optional Lightning address (e.g. "name@provider.com")
   * @param {string} config.lightningDonateText - Optional custom text to display above the Lightning address field
   * @param {Object} config.options - Optional configuration overrides
   * @returns {Promise<Array>} Array of results for each element (with status and value/reason)
   */
  static async render(config) {
    const {
      endpoint,
      selector,
      bitcoinFallbackAddress,
      bitcoinDonateText,
      lightningAddress,
      lightningDonateText,
      options = {},
    } = config;

    if (!endpoint) {
      throw new Error("BitcoinPay: endpoint is required");
    }

    if (!bitcoinFallbackAddress) {
      throw new Error("BitcoinPay: bitcoinFallbackAddress is required");
    }

    if (!isValidBitcoinAddress(bitcoinFallbackAddress)) {
      throw new Error(
        "BitcoinPay: bitcoinFallbackAddress is not a valid Bitcoin address"
      );
    }

    if (!selector) {
      throw new Error("BitcoinPay: selector is required");
    }

    const targetElements = document.querySelectorAll(selector);
    if (targetElements.length === 0) {
      throw new Error(`BitcoinPay: no elements found matching "${selector}"`);
    }

    const instance = new BitcoinPay();

    const finalConfig = { ...instance.defaultConfig, ...options };

    // Create stable cache keys based on endpoint (UTF-8 safe)
    const endpointHash = btoa(unescape(encodeURIComponent(endpoint))).replace(
      /[^a-zA-Z0-9]/g,
      ""
    );
    const addressKey = `btc-address-${endpointHash}`;
    const timestampKey = `btc-timestamp-${endpointHash}`;

    // Fetch the Bitcoin address once (shared across all elements)
    let address;
    try {
      address = await instance.getBitcoinAddress(
        endpoint,
        addressKey,
        timestampKey,
        finalConfig,
        bitcoinFallbackAddress
      );
    } catch (error) {
      console.error("BitcoinPay: Failed to fetch address", error);
      const errorHTML = `<div style="color: red; padding: 10px; border: 1px solid red; border-radius: 4px;">
        Failed to load Bitcoin payment widget. Please check your configuration.
      </div>`;
      targetElements.forEach((el) => {
        el.innerHTML = errorHTML;
      });
      throw error;
    }

    const renderPromises = Array.from(targetElements).map((targetElement) =>
      instance.renderToElement(
        targetElement,
        address,
        lightningAddress,
        bitcoinDonateText,
        lightningDonateText,
        finalConfig
      )
    );

    // Use allSettled so one failure doesn't break others
    const results = await Promise.allSettled(renderPromises);
    return results;
  }

  /**
   * Render widget to a single element
   * @private
   */
  async renderToElement(
    targetElement,
    address,
    lightningAddress,
    bitcoinDonateText,
    lightningDonateText,
    finalConfig
  ) {
    const instanceId = this.generateInstanceId();

    try {
      const widgetHTML = lightningAddress
        ? this.createDualWidgetHTML(
            address,
            lightningAddress,
            bitcoinDonateText,
            lightningDonateText,
            finalConfig,
            instanceId
          )
        : this.createSingleWidgetHTML(
            address,
            bitcoinDonateText,
            finalConfig,
            instanceId
          );
      targetElement.innerHTML = widgetHTML;

      if (lightningAddress) {
        await this.initializeDualWidget(
          address,
          lightningAddress,
          finalConfig,
          instanceId
        );
      } else {
        await this.initializeSingleWidget(address, finalConfig, instanceId);
      }

      return { success: true, element: targetElement };
    } catch (error) {
      console.error("BitcoinPay: Failed to initialize widget", error);
      targetElement.innerHTML = `<div style="color: red; padding: 10px; border: 1px solid red; border-radius: 4px;">
        Failed to load Bitcoin payment widget. Please check your configuration.
      </div>`;
      throw error;
    }
  }

  /**
   * Check if localStorage is available
   */
  isLocalStorageAvailable() {
    try {
      localStorage.setItem("test", "test");
      localStorage.removeItem("test");
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Copy text to clipboard with fallback for insecure origins
   */
  async copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch {
        // Fall back to legacy method
      }
    }

    // Legacy fallback: create temporary textarea
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();

    try {
      const success = document.execCommand("copy");
      return success;
    } catch {
      return false;
    } finally {
      document.body.removeChild(textarea);
    }
  }

  /**
   * Get Bitcoin address with caching
   */
  async getBitcoinAddress(
    endpoint,
    addressKey,
    timestampKey,
    config,
    fallbackAddress
  ) {
    // Validate cache duration (0 to 1 week)
    const validCacheDuration = Math.max(
      0,
      Math.min(config.cacheDuration, 604800000)
    );

    // The cache is untrusted: anything with write access to this origin's
    // storage could otherwise substitute an address and redirect payments.
    if (this.isLocalStorageAvailable()) {
      const storedAddress = localStorage.getItem(addressKey);
      const storedTimestamp = localStorage.getItem(timestampKey);

      if (storedAddress && storedTimestamp) {
        const timestamp = parseInt(storedTimestamp);
        const now = Date.now();
        if (now - timestamp < validCacheDuration) {
          if (isValidBitcoinAddress(storedAddress)) {
            return storedAddress;
          }
          console.warn("BitcoinPay: discarding invalid cached address");
          localStorage.removeItem(addressKey);
          localStorage.removeItem(timestampKey);
        }
      }
    }

    try {
      const response = await fetch(endpoint);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      if (!data.address) {
        throw new Error("Invalid response: no address field");
      }
      if (!isValidBitcoinAddress(data.address)) {
        throw new Error("Invalid response: address is not a Bitcoin address");
      }

      if (this.isLocalStorageAvailable()) {
        localStorage.setItem(addressKey, data.address);
        localStorage.setItem(timestampKey, Date.now().toString());
      }
      return data.address;
    } catch (err) {
      console.error("Failed to fetch Bitcoin address", err);
      if (fallbackAddress) {
        return fallbackAddress;
      }
      throw new Error(`Failed to fetch Bitcoin address: ${err.message}`);
    }
  }

  /**
   * Create the single Bitcoin widget HTML structure
   */
  createSingleWidgetHTML(address, bitcoinDonateText, config, instanceId) {
    const qrContainerId = `btc-qr-${instanceId}`;
    const buttonId = `btc-btn-${instanceId}`;

    // Falls back to device-detection prefixes handled in CSS
    const descriptionHTML = bitcoinDonateText
      ? bitcoinDonateText
      : `<span class="prefix-desktop">Scan with</span>
              <span class="prefix-touch">Tap to open</span>
              your Bitcoin wallet, or copy the on-chain address below.`;

    const safeAddress = escapeHtml(address);

    return `
      <div class="bitcoin-pay-widget">
        <div class="widget-layout">
          <a href="bitcoin:${safeAddress}" class="qr-container" aria-label="Open in Bitcoin wallet">
            <div id="${qrContainerId}" class="qr-code"></div>
          </a>
          <div class="content-area">
            <p class="description">
              ${descriptionHTML}
            </p>
            <div class="address-container">
              <div class="address-text">
                <span>${safeAddress}</span>
              </div>
              ${
                config.showCopyButton
                  ? `<button id="${buttonId}" class="copy-btn">${config.copyButtonText}</button>`
                  : ""
              }
            </div>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Create the dual Bitcoin/Lightning widget HTML structure
   */
  createDualWidgetHTML(
    address,
    lightningAddress,
    bitcoinDonateText,
    lightningDonateText,
    config,
    instanceId
  ) {
    const bitcoinQrId = `btc-qr-${instanceId}`;
    const lightningQrId = `lightning-qr-${instanceId}`;
    const bitcoinBtnId = `btc-btn-${instanceId}`;
    const lightningBtnId = `lightning-btn-${instanceId}`;

    // Falls back to device-detection prefixes handled in CSS
    const bitcoinDescriptionHTML = bitcoinDonateText
      ? bitcoinDonateText
      : `<span class="prefix-desktop">Scan with</span>
              <span class="prefix-touch">Tap to open</span>
              your Bitcoin wallet, or copy the on-chain address below.`;

    const lightningDescriptionHTML = lightningDonateText
      ? lightningDonateText
      : `<span class="prefix-desktop">Scan with</span>
              <span class="prefix-touch">Tap to open</span>
              your Lightning wallet, or copy my Lightning address below.`;

    const safeAddress = escapeHtml(address);
    const safeLightningAddress = escapeHtml(lightningAddress);

    return `
      <div class="bitcoin-pay-widget has-tabs">
        <div class="widget-content">
          <!-- Tab Navigation -->
          <div class="tab-navigation">
            <button id="bitcoin-tab-${instanceId}" class="tab-btn active" data-tab="bitcoin">
              <svg width="20" height="20" viewBox="0 0 64 64" fill="currentColor">
                <g transform="translate(0.00630876,-0.00301984)">
                  <path d="m63.033,39.744c-4.274,17.143-21.637,27.576-38.782,23.301-17.138-4.274-27.571-21.638-23.295-38.78,4.272-17.145,21.635-27.579,38.775-23.305,17.144,4.274,27.576,21.64,23.302,38.784z"/>
                  <path fill="#FFF" d="m46.103,27.444c0.637-4.258-2.605-6.547-7.038-8.074l1.438-5.768-3.511-0.875-1.4,5.616c-0.923-0.23-1.871-0.447-2.813-0.662l1.41-5.653-3.509-0.875-1.439,5.766c-0.764-0.174-1.514-0.346-2.242-0.527l0.004-0.018-4.842-1.209-0.934,3.75s2.605,0.597,2.55,0.634c1.422,0.355,1.679,1.296,1.636,2.042l-1.638,6.571c0.098,0.025,0.225,0.061,0.365,0.117-0.117-0.029-0.242-0.061-0.371-0.092l-2.296,9.205c-0.174,0.432-0.615,1.08-1.609,0.834,0.035,0.051-2.552-0.637-2.552-0.637l-1.743,4.019,4.569,1.139c0.85,0.213,1.683,0.436,2.503,0.646l-1.453,5.834,3.507,0.875,1.439-5.772c0.958,0.26,1.888,0.5,2.798,0.726l-1.434,5.745,3.511,0.875,1.453-5.823c5.987,1.133,10.489,0.676,12.384-4.739,1.527-4.36-0.076-6.875-3.226-8.515,2.294-0.529,4.022-2.038,4.483-5.155zm-8.022,11.249c-1.085,4.36-8.426,2.003-10.806,1.412l1.928-7.729c2.38,0.594,10.012,1.77,8.878,6.317zm1.086-11.312c-0.990,3.966-7.1,1.951-9.082,1.457l1.748-7.01c1.982,0.494,8.365,1.416,7.334,5.553z"/>
                </g>
              </svg>
              Bitcoin
            </button>
            <button id="lightning-tab-${instanceId}" class="tab-btn" data-tab="lightning">
              <svg width="20" height="20" viewBox="0 0 282 282" fill="currentColor">
                <g clip-path="url(#clip0)">
                  <circle cx="140.983" cy="141.003" r="141" />
                  <path d="M79.7609 144.047L173.761 63.0466C177.857 60.4235 181.761 63.0466 179.261 67.5466L149.261 126.547H202.761C202.761 126.547 211.261 126.547 202.761 133.547L110.261 215.047C103.761 220.547 99.261 217.547 103.761 209.047L132.761 151.547H79.7609C79.7609 151.547 71.2609 151.547 79.7609 144.047Z" fill="white"/>
                </g>
                <defs>
                  <clipPath id="clip0">
                    <rect width="282" height="282" fill="white"/>
                  </clipPath>
                </defs>
              </svg>
              Lightning
            </button>
          </div>

          <!-- Bitcoin Tab Content -->
          <div id="bitcoin-content-${instanceId}" class="tab-content active" data-tab="bitcoin">
            <div class="widget-layout">
              <a href="bitcoin:${safeAddress}" class="qr-container" aria-label="Open in Bitcoin wallet">
                <div id="${bitcoinQrId}" class="qr-code"></div>
              </a>
              <div class="content-area">
                <p class="description">
                  ${bitcoinDescriptionHTML}
                </p>
                <div class="address-container">
                  <div class="address-text">
                    <span>${safeAddress}</span>
                  </div>
                  ${
                    config.showCopyButton
                      ? `<button id="${bitcoinBtnId}" class="copy-btn">${config.copyButtonText}</button>`
                      : ""
                  }
                </div>
              </div>
            </div>
          </div>

          <!-- Lightning Tab Content -->
          <div id="lightning-content-${instanceId}" class="tab-content" data-tab="lightning">
            <div class="widget-layout">
              <a href="lightning:${safeLightningAddress}" class="qr-container" aria-label="Open in Lightning wallet">
                <div id="${lightningQrId}" class="qr-code"></div>
              </a>
              <div class="content-area">
                <p class="description">
                  ${lightningDescriptionHTML}
                </p>
                <div class="address-container">
                  <div class="address-text">
                    <span>${safeLightningAddress}</span>
                  </div>
                  ${
                    config.showCopyButton
                      ? `<button id="${lightningBtnId}" class="copy-btn">Copy</button>`
                      : ""
                  }
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Initialize single Bitcoin widget
   */
  async initializeSingleWidget(address, config, instanceId) {
    const qrContainerId = `btc-qr-${instanceId}`;
    const buttonId = `btc-btn-${instanceId}`;

    const qrContainer = document.getElementById(qrContainerId);
    if (qrContainer) {
      const logoHref =
        config.qrCodeOptions.logo === "btc"
          ? this.defaultConfig.qrCodeOptions.bitcoinImage
          : undefined;
      const svg = generateQrSvg({
        text: `bitcoin:${address}`,
        size: config.width,
        logoHref,
        alt: "Bitcoin address QR",
      });
      qrContainer.innerHTML = svg;
    }

    if (config.showCopyButton) {
      const copyButton = document.getElementById(buttonId);
      if (copyButton) {
        copyButton.addEventListener("click", async () => {
          const success = await this.copyToClipboard(address);
          const originalText = copyButton.textContent;

          if (success) {
            copyButton.textContent = config.copiedText;
          } else {
            copyButton.textContent = "Failed to copy";
          }

          setTimeout(() => {
            copyButton.textContent = originalText;
          }, 2000);
        });
      }
    }
  }

  /**
   * Initialize dual Bitcoin/Lightning widget
   */
  async initializeDualWidget(address, lightningAddress, config, instanceId) {
    const bitcoinQrId = `btc-qr-${instanceId}`;
    const lightningQrId = `lightning-qr-${instanceId}`;
    const bitcoinBtnId = `btc-btn-${instanceId}`;
    const lightningBtnId = `lightning-btn-${instanceId}`;

    const bitcoinQrContainer = document.getElementById(bitcoinQrId);
    if (bitcoinQrContainer) {
      const svg = generateQrSvg({
        text: `bitcoin:${address}`,
        size: config.width,
        logoHref: this.defaultConfig.qrCodeOptions.bitcoinImage,
        alt: "Bitcoin address QR",
      });
      bitcoinQrContainer.innerHTML = svg;
    }

    const lightningQrContainer = document.getElementById(lightningQrId);
    if (lightningQrContainer) {
      const svg = generateQrSvg({
        text: `lightning:${lightningAddress}`,
        size: config.width,
        logoHref: this.defaultConfig.qrCodeOptions.lightningImage,
        alt: "Lightning address QR",
      });
      lightningQrContainer.innerHTML = svg;
    }

    this.setupTabs(instanceId);

    if (config.showCopyButton) {
      const bitcoinCopyButton = document.getElementById(bitcoinBtnId);
      if (bitcoinCopyButton) {
        bitcoinCopyButton.addEventListener("click", async () => {
          const success = await this.copyToClipboard(address);
          const originalText = bitcoinCopyButton.textContent;

          if (success) {
            bitcoinCopyButton.textContent = config.copiedText;
          } else {
            bitcoinCopyButton.textContent = "Failed to copy";
          }

          setTimeout(() => {
            bitcoinCopyButton.textContent = originalText;
          }, 2000);
        });
      }

      const lightningCopyButton = document.getElementById(lightningBtnId);
      if (lightningCopyButton) {
        lightningCopyButton.addEventListener("click", async () => {
          const success = await this.copyToClipboard(lightningAddress);
          const originalText = lightningCopyButton.textContent;

          if (success) {
            lightningCopyButton.textContent = config.copiedText;
          } else {
            lightningCopyButton.textContent = "Failed to copy";
          }

          setTimeout(() => {
            lightningCopyButton.textContent = originalText;
          }, 2000);
        });
      }
    }
  }

  /**
   * Setup tab switching functionality
   */
  setupTabs(instanceId) {
    const tabButtons = document.querySelectorAll(
      `.tab-btn[id$="-${instanceId}"]`
    );
    const tabContents = document.querySelectorAll(
      `.tab-content[id$="-${instanceId}"]`
    );

    tabButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const targetTab = btn.getAttribute("data-tab");

        tabButtons.forEach((b) => {
          b.classList.remove("active");
        });
        btn.classList.add("active");

        tabContents.forEach((content) => {
          content.classList.remove("active");
          if (content.getAttribute("data-tab") === targetTab) {
            content.classList.add("active");
          }
        });
      });
    });
  }

  /**
   * Generate unique instance ID
   */
  generateInstanceId() {
    return Math.random().toString(36).substr(2, 9);
  }
}

// Make available globally for script tag usage
if (typeof window !== "undefined") {
  window.BitcoinPay = BitcoinPay;
}

// ESM exports
export { BitcoinPay };
export default BitcoinPay;
