import {
  MockStripeAdapter,
  MockX402Adapter,
  PaymentService,
  RealX402Adapter,
  ScaffoldDisputeRegistryContract,
  ScaffoldSettlementRouterContract,
  ViemDisputeRegistryContract,
  ViemSettlementRouterContract,
  type BuyerAuthorizationMode,
  type PaymentPartyWallet,
} from "@haggle/payment-core";
import { createPublicClient, createWalletClient, http, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, baseSepolia } from "viem/chains";

interface WalletMapEntry {
  wallet_address: string;
  network?: string;
  custody?: PaymentPartyWallet["custody"];
}

function parseWalletMap(raw: string | undefined): Record<string, WalletMapEntry> {
  if (!raw) {
    return {};
  }
  const parsed = JSON.parse(raw) as Record<string, WalletMapEntry>;
  return parsed;
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

export function createPaymentServiceFromEnv() {
  const x402Mode = process.env.HAGGLE_X402_MODE ?? "mock";

  if (x402Mode !== "real") {
    return new PaymentService({
      x402: new MockX402Adapter(),
      stripe: new MockStripeAdapter(),
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
    async resolve_seller_payout_target(sellerId) {
      return {
        seller_id: sellerId,
        wallet: paymentWalletFromMap(sellerId, sellerWalletMap[sellerId], walletNetwork, "external"),
      };
    },
    async resolve_buyer_authorization(intent) {
      return {
        buyer_id: intent.buyer_id,
        mode: intent.buyer_authorization_mode ?? defaultBuyerAuthMode,
        wallet: paymentWalletFromMap(intent.buyer_id, buyerWalletMap[intent.buyer_id], walletNetwork, "external"),
      };
    },
  });

  return new PaymentService({
    x402,
    stripe: new MockStripeAdapter(),
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
