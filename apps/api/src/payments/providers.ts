import {
  MockStripeAdapter,
  MockX402Adapter,
  PaymentService,
  ScaffoldDisputeRegistryContract,
  ScaffoldSettlementRouterContract,
  type BuyerAuthorizationMode,
  type PaymentIntent,
  type PaymentPartyWallet,
} from "@haggle/payment-core";
// Heavy modules not re-exported from the barrel — import via tsconfig paths.
import { RealX402Adapter } from "@haggle/payment-core/heavy/real-x402-adapter";
import { ViemDisputeRegistryContract, ViemSettlementRouterContract } from "@haggle/payment-core/heavy/viem-contracts";
import { createPublicClient, createWalletClient, http, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, baseSepolia } from "viem/chains";
import { createSettlementSigner } from "./settlement-signer.js";
import { RealStripeAdapter } from "./real-stripe-adapter.js";

interface WalletMapEntry {
  wallet_address: string;
  network?: string;
  custody?: PaymentPartyWallet["custody"];
}

function parseWalletMap(raw: string | undefined): Record<string, WalletMapEntry> {
  if (!raw) {
    return {};
  }
  try {
    return JSON.parse(raw) as Record<string, WalletMapEntry>;
  } catch {
    throw new Error(`invalid JSON in wallet map env var: ${raw.slice(0, 100)}`);
  }
}

function paymentWalletFromMap(
  actorId: string,
  entry: WalletMapEntry | undefined,
  fallbackNetwork: string,
  fallbackCustody: PaymentPartyWallet["custody"],
): PaymentPartyWallet {
  if (!entry?.wallet_address) {
    throw new Error(`missing payment wallet mapping for actor: ${actorId}`);
  }

  return {
    actor_id: actorId,
    wallet_address: entry.wallet_address,
    network: entry.network ?? fallbackNetwork,
    custody: entry.custody ?? fallbackCustody,
  };
}

function createStripeAdapterFromEnv() {
  const stripeMode = process.env.STRIPE_MODE ?? "mock";
  if (stripeMode !== "real") {
    return new MockStripeAdapter();
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secretKey) {
    throw new Error("STRIPE_MODE=real requires STRIPE_SECRET_KEY");
  }
  if (!webhookSecret) {
    throw new Error("STRIPE_MODE=real requires STRIPE_WEBHOOK_SECRET");
  }

  // Dynamic import avoided — stripe is a direct dependency of apps/api
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Stripe = require("stripe").default ?? require("stripe");
  const stripe = new Stripe(secretKey, { apiVersion: "2025-04-30.basil" });

  return new RealStripeAdapter({
    stripe,
    webhookSecret,
    defaultDestinationWallet: process.env.HAGGLE_STRIPE_DESTINATION_WALLET,
    destinationNetwork: "base",
  });
}

/**
 * Get the RealStripeAdapter instance if STRIPE_MODE=real, otherwise null.
 * Used by the webhook route to access constructWebhookEvent().
 */
export function getRealStripeAdapterOrNull(): RealStripeAdapter | null {
  const stripeMode = process.env.STRIPE_MODE ?? "mock";
  if (stripeMode !== "real") return null;
  const adapter = createStripeAdapterFromEnv();
  if (adapter instanceof RealStripeAdapter) return adapter;
  return null;
}

export function createPaymentServiceFromEnv() {
  const x402Mode = process.env.HAGGLE_X402_MODE ?? "mock";
  const stripeAdapter = createStripeAdapterFromEnv();

  if (x402Mode !== "real") {
    return new PaymentService({
      x402: new MockX402Adapter(),
      stripe: stripeAdapter,
    });
  }

  const facilitatorUrl = process.env.HAGGLE_X402_FACILITATOR_URL;
  const feeWallet = process.env.HAGGLE_X402_FEE_WALLET;
  if (!facilitatorUrl || !feeWallet) {
    throw new Error("real x402 mode requires HAGGLE_X402_FACILITATOR_URL and HAGGLE_X402_FEE_WALLET");
  }

  const network = process.env.HAGGLE_X402_NETWORK === "base-sepolia" ? "base-sepolia" : "base";
  const walletNetwork = process.env.HAGGLE_X402_WALLET_NETWORK ?? "eip155:8453";
  const rpcUrl = process.env.HAGGLE_BASE_RPC_URL;
  const routerAddress = process.env.HAGGLE_SETTLEMENT_ROUTER_ADDRESS as Address | undefined;
  const disputeRegistryAddress = process.env.HAGGLE_DISPUTE_REGISTRY_ADDRESS as Address | undefined;
  const relayerPrivateKey = process.env.HAGGLE_ROUTER_RELAYER_PRIVATE_KEY as `0x${string}` | undefined;
  const assetAddress = (process.env.HAGGLE_X402_USDC_ASSET_ADDRESS ?? "USDC") as Address | "USDC";
  const feeBps = Number(process.env.HAGGLE_X402_FEE_BPS ?? "250");
  const defaultBuyerAuthMode = (process.env.HAGGLE_X402_DEFAULT_BUYER_AUTH_MODE ?? "human_wallet") as BuyerAuthorizationMode;
  const sellerWalletMap = parseWalletMap(process.env.HAGGLE_X402_SELLER_WALLET_MAP);
  const buyerWalletMap = parseWalletMap(process.env.HAGGLE_X402_BUYER_WALLET_MAP);

  const chain = network === "base-sepolia" ? baseSepolia : base;
  const viemReady = Boolean(rpcUrl && routerAddress && relayerPrivateKey && assetAddress !== "USDC");

  const settlementRouter = viemReady
    ? (() => {
        const account = privateKeyToAccount(relayerPrivateKey!);
        const transport = http(rpcUrl!);
        const publicClient = createPublicClient({ chain, transport });
        const walletClient = createWalletClient({ account, chain, transport });
        return new ViemSettlementRouterContract(
          network,
          "USDC",
          routerAddress!,
          publicClient,
          walletClient,
          assetAddress as Address,
        );
      })()
    : new ScaffoldSettlementRouterContract(network, "USDC");

  const disputeRegistry =
    viemReady && disputeRegistryAddress
      ? (() => {
          const account = privateKeyToAccount(relayerPrivateKey!);
          const transport = http(rpcUrl!);
          const publicClient = createPublicClient({ chain, transport });
          const walletClient = createWalletClient({ account, chain, transport });
          return new ViemDisputeRegistryContract(network, disputeRegistryAddress, publicClient, walletClient);
        })()
      : new ScaffoldDisputeRegistryContract(network);

  const x402 = new RealX402Adapter({
    facilitator_url: facilitatorUrl,
    network,
    asset: "USDC",
    fee_policy: {
      fee_bps: feeBps,
      wallet: {
        actor_id: "haggle",
        wallet_address: feeWallet,
        network: walletNetwork,
        custody: "merchant_managed",
      },
    },
    settlement_router: settlementRouter,
    dispute_registry: disputeRegistry,
    async resolve_seller_payout_target(sellerId: string) {
      return {
        seller_id: sellerId,
        wallet: paymentWalletFromMap(sellerId, sellerWalletMap[sellerId], walletNetwork, "external"),
      };
    },
    async resolve_buyer_authorization(intent: PaymentIntent) {
      return {
        buyer_id: intent.buyer_id,
        mode: intent.buyer_authorization_mode ?? defaultBuyerAuthMode,
        wallet: paymentWalletFromMap(intent.buyer_id, buyerWalletMap[intent.buyer_id], walletNetwork, "external"),
      };
    },
    resolve_settlement_signature: createSettlementSigner({
      buyerAddressResolver: (intent) =>
        (buyerWalletMap[intent.buyer_id]?.wallet_address ?? intent.buyer_id) as Address,
      sellerAddressResolver: (intent) =>
        (sellerWalletMap[intent.seller_id]?.wallet_address ?? intent.seller_id) as Address,
    }),
  });

  return new PaymentService({
    x402,
    stripe: stripeAdapter,
  });
}

export function getX402EnvConfig() {
  return {
    mode: process.env.HAGGLE_X402_MODE ?? "mock",
    facilitatorUrl: process.env.HAGGLE_X402_FACILITATOR_URL,
    network: process.env.HAGGLE_X402_WALLET_NETWORK ?? "eip155:8453",
    assetAddress: process.env.HAGGLE_X402_USDC_ASSET_ADDRESS ?? "USDC",
    apiKeyId: process.env.CDP_API_KEY_ID,
    apiKeySecret: process.env.CDP_API_KEY_SECRET,
    baseRpcUrl: process.env.HAGGLE_BASE_RPC_URL,
    settlementRouterAddress: process.env.HAGGLE_SETTLEMENT_ROUTER_ADDRESS,
    disputeRegistryAddress: process.env.HAGGLE_DISPUTE_REGISTRY_ADDRESS,
  };
}
