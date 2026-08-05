import type { Context } from "@netlify/functions";
import { AddressPoolManager } from "./address-pool.js";
import {
  validateBitcoinEnvironment,
  createValidationErrorResponse,
} from "./validation.js";

export default async (req: Request, context: Context) => {
  try {
    // Validate required environment variables
    const { xpub, derivationPath } = validateBitcoinEnvironment();

    // Initialize address pool manager with both xpub and derivation path
    const poolManager = new AddressPoolManager(xpub, derivationPath);

    // Get the current address (handles rotation logic internally)
    const address = await poolManager.getCurrentAddress();

    // Log pool statistics for debugging if DEBUG_LOGS is enabled
    if (process.env.DEBUG_LOGS === "true") {
      const poolStats = await poolManager.getPoolStats();
      console.log("Address Pool Stats:", JSON.stringify(poolStats, null, 2));
    }

    return new Response(JSON.stringify({ address }), {
      status: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/json",
      },
    });
  } catch (error) {
    console.error("Error in get-address function:", error);

    const message = error instanceof Error ? error.message : String(error);

    // Misconfiguration: the detail is useful to whoever deployed this
    if (message.includes("environment variable is required")) {
      return createValidationErrorResponse(message);
    }

    // Everything else stays in the log rather than going to unauthenticated callers
    return new Response(
      JSON.stringify({ error: "Unable to generate a Bitcoin address" }),
      {
        status: 500,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Content-Type": "application/json",
        },
      }
    );
  }
};
