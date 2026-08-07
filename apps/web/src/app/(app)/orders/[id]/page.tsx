"use client";

import { HAGGLE_CONDITIONAL_SETTLEMENT_ABI } from "@haggle/contracts";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { type Address, getAddress, isAddress, isHex } from "viem";
import { useAccount, useChainId, useSwitchChain, useWriteContract } from "wagmi";
import {
  ActivityFeed,
  BackLink,
  Button,
  buttonVariants,
  type ActivityEvent as FeedEvent,
  Spinner,
  StatusBadge,
} from "@/components/ui";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { confirmConditionalSettlementFunding } from "@/lib/conditional-settlement-confirmation";
import { confirmConditionalSettlementRelease } from "@/lib/conditional-settlement-release-confirmation";
import { createPaymentDisclosureAck } from "@/lib/payment-disclosure";
import { createShipmentMutationHeaders } from "@/lib/shipment-idempotency";
import { canManageSellerShipping, SellerShippingGate } from "@/lib/shipping-role";
import { createClient } from "@/lib/supabase/client";
import {
  HAGGLE_CONDITIONAL_SETTLEMENT_ADDRESS,
  HAGGLE_SETTLEMENT_ASSET_PROFILE,
  HAGGLE_WALLET_CHAIN_ID,
} from "@/lib/wallet-network";
import { WalletProvider } from "@/lib/wallet-provider";

// ─── Types ───────────────────────────────────────────────────
interface PaymentIntent {
  id: string;
  order_id: string;
  seller_id: string;
  buyer_id: string;
  selected_rail: string;
  status: string;
  amount: { currency: string; amount_minor: number };
  created_at: string;
  updated_at: string;
}

interface Shipment {
  id: string;
  order_id: string;
  status: string;
  carrier: string | null;
  tracking_number: string | null;
  label_url?: string | null;
  label_qr_code_url?: string | null;
  label_qr_code_available?: boolean;
  metadata?: {
    shipping_execution_mode?: "integration_manual" | "physical_live";
    shipping_provider_environment?: "test" | "live";
    shipping_execution_mode_source?: "payment_checkout";
    shipping_execution_mode_payment_locked?: boolean;
    prepared_rate_quotes?: unknown[];
    easypost_test_tracker?: {
      fixture_type?: string;
      requested_status?: string;
      easypost_test_status_verified?: boolean;
    };
  };
  delivered_at: string | null;
  created_at: string;
  events: ShipmentEvent[];
}

interface ShippingRate {
  id?: string;
  carrier: string;
  service: string;
  rate: string;
  rate_minor: number;
  est_delivery_days: number | null;
}

interface ShippingFormState {
  fromAddress: {
    name: string;
    street1: string;
    street2: string;
    city: string;
    state: string;
    zip: string;
    country: string;
    phone: string;
  };
  parcel: {
    length_in: string;
    width_in: string;
    height_in: string;
    weight_oz: string;
  };
}

interface AddressFormState {
  name: string;
  street1: string;
  street2: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  phone: string;
  email: string;
}

interface OrderAddress extends AddressFormState {
  id: string;
  role: "buyer" | "seller";
}

interface ShipmentEvent {
  id: string;
  event_type?: string;
  canonical_status?: string;
  status?: string;
  occurred_at: string;
  message?: string;
}

interface Dispute {
  id: string;
  order_id: string;
  reason_code: string;
  status: string;
  opened_by: string;
  evidence: Array<{ type: string; text?: string; submitted_by: string }>;
  created_at: string;
  metadata?: Record<string, unknown>;
  resolution?: {
    outcome: "buyer_favor" | "seller_favor" | "partial_refund" | "no_action";
    summary: string;
  };
}

interface SettlementRelease {
  id: string;
  order_id: string;
  payment_intent_id: string;
  product_release_status: "PENDING_DELIVERY" | "BUYER_REVIEW" | "RELEASED";
  buffer_release_status: "HELD" | "ADJUSTING" | "RELEASED";
  buffer_amount: { currency: string; amount_minor: number };
  buyer_review_deadline?: string;
  buffer_release_deadline?: string;
}

interface ConditionalSettlementSummary {
  status: string | null;
  release_tx_hash: string | null;
}

interface SettlementReleaseState {
  release: SettlementRelease | null;
  phase: string | null;
  conditionalSettlement: ConditionalSettlementSummary | null;
}

interface ConditionalReleaseRequest {
  contract_call: {
    params: {
      settlementId: `0x${string}`;
      sellerWallet: Address;
      feeWallet: Address;
      sellerAmount: string;
      feeAmount: string;
      deadline: string;
      signerNonce: string;
    };
    signature: `0x${string}`;
  };
  typed_data: {
    domain: { chainId: number; verifyingContract?: string };
  };
}

interface OrderState {
  order: {
    id: string;
    status: string;
    amountMinor: number;
    currency: string;
    buyerId: string;
    sellerId: string;
    createdAt: string;
  } | null;
  payment: PaymentIntent | null;
  shipment: Shipment | null;
  dispute: Dispute | null;
  settlementRelease: SettlementReleaseState;
}

const IS_PRODUCTION = process.env.NODE_ENV === "production";
const IS_STAGING_SETTLEMENT_TEST = HAGGLE_SETTLEMENT_ASSET_PROFILE === "base-sepolia-husdc";

function toConditionalReleaseTuple(request: ConditionalReleaseRequest) {
  const params = request.contract_call.params;
  return {
    settlementId: params.settlementId,
    sellerWallet: getAddress(params.sellerWallet),
    feeWallet: getAddress(params.feeWallet),
    sellerAmount: BigInt(params.sellerAmount),
    feeAmount: BigInt(params.feeAmount),
    deadline: BigInt(params.deadline),
    signerNonce: BigInt(params.signerNonce),
  };
}

const EMPTY_SHIPPING_FORM: ShippingFormState = {
  fromAddress: {
    name: "",
    street1: "",
    street2: "",
    city: "",
    state: "",
    zip: "",
    country: "US",
    phone: "",
  },
  parcel: {
    length_in: "",
    width_in: "",
    height_in: "",
    weight_oz: "",
  },
};

const EMPTY_ADDRESS_FORM: AddressFormState = {
  name: "",
  street1: "",
  street2: "",
  city: "",
  state: "",
  zip: "",
  country: "US",
  phone: "",
  email: "",
};

function formatCurrency(minor: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  }).format(minor / 100);
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function isFulfillmentReady(orderStatus: string | undefined, shipment: Shipment | null): boolean {
  if (shipment) return true;
  return [
    "FULFILLMENT_PENDING",
    "FULFILLMENT_ACTIVE",
    "DELIVERED",
    "IN_DISPUTE",
    "CLOSED",
  ].includes(orderStatus ?? "");
}

// ─── Timeline Step ───────────────────────────────────────────
type StepStatus = "done" | "active" | "pending";

function TimelineStep({
  label,
  status,
  detail,
  isLast,
}: {
  label: string;
  status: StepStatus;
  detail?: string;
  isLast?: boolean;
}) {
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <div
          className={`w-3 h-3 rounded-full border-2 ${
            status === "done"
              ? "bg-success border-success"
              : status === "active"
                ? "bg-action-primary border-action-primary animate-pulse"
                : "bg-transparent border-line-strong"
          }`}
        />
        {!isLast && (
          <div
            className={`w-0.5 flex-1 min-h-[24px] ${
              status === "done" ? "bg-success/40" : "bg-line"
            }`}
          />
        )}
      </div>
      <div className="pb-4">
        <p
          className={`text-sm font-medium ${
            status === "active"
              ? "text-action-primary"
              : status === "done"
                ? "text-ink-secondary"
                : "text-ink-muted"
          }`}
        >
          {label}
        </p>
        {detail && <p className="text-xs text-ink-muted mt-0.5">{detail}</p>}
      </div>
    </div>
  );
}

// ─── Payment Section ─────────────────────────────────────────
function PaymentSection({
  payment,
  onAction,
  loading,
  isProduction,
  fulfillmentReady,
}: {
  payment: PaymentIntent | null;
  onAction: (action: string) => void;
  loading: string | null;
  isProduction: boolean;
  fulfillmentReady: boolean;
}) {
  if (!payment) {
    return (
      <SectionCard title="Payment" icon="creditcard">
        <p className="text-sm text-ink-secondary">No payment intent yet.</p>
        {!isProduction ? (
          <ActionButton
            label="Prepare Payment"
            action="prepare"
            onClick={onAction}
            loading={loading}
          />
        ) : (
          <InlineNotice tone="info">
            Payment must be created from an approved checkout session.
          </InlineNotice>
        )}
      </SectionCard>
    );
  }

  const needsFundingRecovery =
    isProduction &&
    payment.selected_rail === "x402" &&
    payment.status === "SETTLEMENT_PENDING" &&
    !fulfillmentReady;
  const nextAction = needsFundingRecovery
    ? { label: "Confirm funding", action: "confirm_funding", variant: "primary" as const }
    : getNextPaymentAction(payment.status, isProduction);

  return (
    <SectionCard title="Payment" icon="creditcard">
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm text-ink-secondary">Status</span>
          <StatusBadge domain="order" status={payment.status} />
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm text-ink-secondary">Amount</span>
          <span className="text-sm font-medium text-ink">
            {formatCurrency(payment.amount.amount_minor, payment.amount.currency)}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm text-ink-secondary">Rail</span>
          <span className="text-sm text-ink-secondary">{payment.selected_rail.toUpperCase()}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm text-ink-secondary">ID</span>
          <span className="text-xs text-ink-muted font-mono">{payment.id.slice(0, 16)}...</span>
        </div>
        {nextAction && (
          <ActionButton
            label={nextAction.label}
            action={nextAction.action}
            onClick={onAction}
            loading={loading}
            variant={nextAction.variant}
          />
        )}
        {!nextAction && getPaymentStatusMessage(payment.status, isProduction, fulfillmentReady) && (
          <InlineNotice tone="info">
            {getPaymentStatusMessage(payment.status, isProduction, fulfillmentReady)}
          </InlineNotice>
        )}
        {payment.status === "SETTLED" && (
          <div className="rounded-lg bg-success-soft border border-success/20 px-3 py-2 text-sm text-success">
            Payment settled successfully
          </div>
        )}
      </div>
    </SectionCard>
  );
}

function getNextPaymentAction(
  status: string,
  isProduction: boolean,
): { label: string; action: string; variant?: "primary" | "danger" } | null {
  switch (status) {
    case "CREATED":
      return { label: "Get Quote", action: "quote" };
    case "QUOTED":
      if (isProduction) return null;
      return { label: "Authorize Payment", action: "authorize", variant: "primary" };
    case "AUTHORIZED":
      if (isProduction) return null;
      return { label: "Settle Payment", action: "settle", variant: "primary" };
    case "SETTLEMENT_PENDING":
      if (isProduction) return null;
      return { label: "Confirm Settlement", action: "settle", variant: "primary" };
    default:
      return null;
  }
}

function getPaymentStatusMessage(
  status: string,
  isProduction: boolean,
  fulfillmentReady: boolean,
): string | null {
  if (!isProduction) return null;
  switch (status) {
    case "QUOTED":
      return "Complete the rail-specific checkout flow to authorize and settle payment.";
    case "AUTHORIZED":
      return "Waiting for provider settlement confirmation.";
    case "SETTLEMENT_PENDING":
      return fulfillmentReady
        ? "Funds are secured in conditional settlement. Fulfillment can proceed."
        : "Funding was submitted but still needs receipt confirmation.";
    default:
      return null;
  }
}

// ─── Shipping Section ────────────────────────────────────────
function ShippingSection({
  shipment,
  onAction,
  loading,
  isProduction,
  isSeller,
  testTrackingEnabled,
  shippingForm,
  rates,
  onShippingFormChange,
  onPrepareRates,
  onPurchaseRate,
  onSelectExecutionMode,
}: {
  shipment: Shipment | null;
  onAction: (action: string) => void;
  loading: string | null;
  isProduction: boolean;
  isSeller: boolean;
  testTrackingEnabled: boolean;
  shippingForm: ShippingFormState;
  rates: ShippingRate[];
  onShippingFormChange: (section: "fromAddress" | "parcel", field: string, value: string) => void;
  onPrepareRates: () => void;
  onPurchaseRate: (rateId: string) => void;
  onSelectExecutionMode: (mode: "integration_manual" | "physical_live") => void;
}) {
  if (!shipment) {
    return (
      <SectionCard title="Shipping" icon="truck">
        <p className="text-sm text-ink-secondary">
          Shipment will be created automatically after payment settles.
        </p>
      </SectionCard>
    );
  }

  const executionMode = shipment.metadata?.shipping_execution_mode ?? "integration_manual";
  const isPhysicalShipping = executionMode === "physical_live";
  const isPaymentModeLocked = shipment.metadata?.shipping_execution_mode_payment_locked === true;
  const nextAction = isSeller
    ? getNextShippingAction(
        shipment.status,
        isProduction,
        testTrackingEnabled && !isPhysicalShipping,
      )
    : null;

  return (
    <SectionCard title="Shipping" icon="truck">
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm text-ink-secondary">Status</span>
          <StatusBadge domain="order" status={shipment.status} />
        </div>
        <div className="rounded-lg border border-line bg-surface-sunken p-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-medium text-ink">Shipping test mode</p>
              <p className="text-xs text-ink-muted">
                {isPhysicalShipping
                  ? "Real addresses, paid EasyPost label, and carrier scans"
                  : "EasyPost test label with manually controlled delivery states"}
              </p>
            </div>
            <StatusBadge
              domain="order"
              status={isPhysicalShipping ? "PHYSICAL LIVE" : "INTEGRATION"}
            />
          </div>
          {isSeller &&
            !isPaymentModeLocked &&
            shipment.status === "LABEL_PENDING" &&
            rates.length === 0 && (
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Button
                  variant={isPhysicalShipping ? "secondary" : "primary"}
                  size="sm"
                  onClick={() => onSelectExecutionMode("integration_manual")}
                  disabled={Boolean(loading)}
                >
                  Integration
                </Button>
                <Button
                  variant={isPhysicalShipping ? "primary" : "secondary"}
                  size="sm"
                  onClick={() => onSelectExecutionMode("physical_live")}
                  disabled={Boolean(loading)}
                >
                  Physical shipping
                </Button>
              </div>
            )}
          {isPaymentModeLocked && (
            <p className="mt-2 text-ink-muted text-xs">Locked during checkout</p>
          )}
        </div>

        {isPhysicalShipping && (
          <InlineNotice tone="warning">
            Product payment uses hUSDC. Haggle's staging fiat budget pays this real EasyPost label,
            subject to the configured charge cap. Delivery advances only from verified carrier
            tracking.
          </InlineNotice>
        )}
        {shipment.tracking_number && (
          <div className="flex items-center justify-between">
            <span className="text-sm text-ink-secondary">Tracking</span>
            <span className="text-sm font-mono text-ink-secondary">{shipment.tracking_number}</span>
          </div>
        )}
        {shipment.carrier && (
          <div className="flex items-center justify-between">
            <span className="text-sm text-ink-secondary">Carrier</span>
            <span className="text-sm text-ink-secondary">{shipment.carrier}</span>
          </div>
        )}

        {shipment.metadata?.easypost_test_tracker?.fixture_type === "canned_tracking_code" && (
          <InlineNotice tone="info">
            This delivery state is an EasyPost test simulation, not a physical carrier scan.
          </InlineNotice>
        )}

        {(shipment.label_url || shipment.label_qr_code_url) && (
          <div className="border-t border-line pt-3 mt-3">
            <p className="text-xs text-ink-muted uppercase tracking-wider mb-2">Print options</p>
            <div className="flex flex-wrap gap-2">
              {shipment.label_url && (
                <a
                  href={shipment.label_url}
                  target="_blank"
                  rel="noreferrer"
                  className={buttonVariants({ variant: "secondary", size: "sm" })}
                >
                  Download label
                </a>
              )}
              {shipment.label_qr_code_url && (
                <a
                  href={shipment.label_qr_code_url}
                  target="_blank"
                  rel="noreferrer"
                  className={buttonVariants({ variant: "primary", size: "sm" })}
                >
                  Show USPS QR
                </a>
              )}
            </div>
            {shipment.label_qr_code_url && (
              <p className="mt-2 text-xs text-ink-muted">
                No printer needed: bring the packed item and QR code to a supported USPS location.
              </p>
            )}
          </div>
        )}

        {shipment.status === "LABEL_PENDING" && (
          <SellerShippingGate
            isSeller={isSeller}
            fallback={
              <InlineNotice tone="info">
                Waiting for the seller to enter the ship-from address, confirm the parcel details,
                and select a carrier rate.
              </InlineNotice>
            }
          >
            <ShippingFulfillmentForm
              form={shippingForm}
              rates={rates}
              loading={loading}
              onChange={onShippingFormChange}
              onPrepareRates={onPrepareRates}
              onPurchaseRate={onPurchaseRate}
            />
          </SellerShippingGate>
        )}

        {/* Event timeline */}
        {shipment.events.length > 0 && (
          <div className="border-t border-line pt-3 mt-3">
            <p className="text-xs text-ink-muted uppercase tracking-wider mb-2">Events</p>
            <div className="space-y-2">
              {shipment.events.map((evt) => (
                <div key={evt.id} className="flex items-start gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-action-primary mt-1.5 shrink-0" />
                  <div>
                    <p className="text-xs text-ink-secondary">{formatShipmentEventStatus(evt)}</p>
                    <p className="text-xs text-ink-muted">{formatTime(evt.occurred_at)}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {nextAction && (
          <ActionButton
            label={nextAction.label}
            action={nextAction.action}
            onClick={onAction}
            loading={loading}
          />
        )}

        {!nextAction && getShippingStatusMessage(shipment.status, isProduction) && (
          <InlineNotice tone="info">
            {getShippingStatusMessage(shipment.status, isProduction)}
          </InlineNotice>
        )}

        {shipment.status === "DELIVERED" && (
          <div className="rounded-lg bg-success-soft border border-success/20 px-3 py-2 text-sm text-success">
            Delivered {shipment.delivered_at ? formatTime(shipment.delivered_at) : ""}
          </div>
        )}
      </div>
    </SectionCard>
  );
}

function getNextShippingAction(
  status: string,
  isProduction: boolean,
  testTrackingEnabled: boolean,
): { label: string; action: string } | null {
  if (testTrackingEnabled) {
    switch (status) {
      case "LABEL_CREATED":
        return { label: "Simulate in transit (EasyPost)", action: "test-in-transit" };
      case "IN_TRANSIT":
        return { label: "Simulate out for delivery", action: "test-out-for-delivery" };
      case "OUT_FOR_DELIVERY":
        return { label: "Simulate delivered (EasyPost)", action: "test-delivered" };
    }
  }
  if (isProduction) return null;
  switch (status) {
    case "LABEL_CREATED":
      return { label: "Mark Shipped", action: "ship" };
    case "IN_TRANSIT":
      return { label: "Mark Delivered", action: "deliver" };
    case "OUT_FOR_DELIVERY":
      return { label: "Confirm Delivery", action: "deliver" };
    default:
      return null;
  }
}

function getShippingStatusMessage(status: string, isProduction: boolean): string | null {
  if (!isProduction) return null;
  switch (status) {
    case "LABEL_CREATED":
      return "Label purchased. Tracking updates are recorded from the carrier webhook.";
    case "IN_TRANSIT":
    case "OUT_FOR_DELIVERY":
      return "Waiting for the carrier to confirm the next tracking event.";
    default:
      return null;
  }
}

function formatShipmentEventStatus(event: ShipmentEvent): string {
  return (event.canonical_status ?? event.status ?? event.event_type ?? "TRACKING_EVENT").replace(
    /_/g,
    " ",
  );
}

function ShippingFulfillmentForm({
  form,
  rates,
  loading,
  onChange,
  onPrepareRates,
  onPurchaseRate,
}: {
  form: ShippingFormState;
  rates: ShippingRate[];
  loading: string | null;
  onChange: (section: "fromAddress" | "parcel", field: string, value: string) => void;
  onPrepareRates: () => void;
  onPurchaseRate: (rateId: string) => void;
}) {
  return (
    <div className="space-y-3 border-t border-line pt-3">
      <p className="text-xs text-ink-muted uppercase tracking-wider">Seller ship-from</p>
      <div className="grid grid-cols-2 gap-2">
        <TextInput
          value={form.fromAddress.name}
          placeholder="Name"
          onChange={(value) => onChange("fromAddress", "name", value)}
        />
        <TextInput
          value={form.fromAddress.phone}
          placeholder="Phone"
          onChange={(value) => onChange("fromAddress", "phone", value)}
        />
        <TextInput
          className="col-span-2"
          value={form.fromAddress.street1}
          placeholder="Street address"
          onChange={(value) => onChange("fromAddress", "street1", value)}
        />
        <TextInput
          className="col-span-2"
          value={form.fromAddress.street2}
          placeholder="Apt, suite"
          onChange={(value) => onChange("fromAddress", "street2", value)}
        />
        <TextInput
          value={form.fromAddress.city}
          placeholder="City"
          onChange={(value) => onChange("fromAddress", "city", value)}
        />
        <TextInput
          value={form.fromAddress.state}
          placeholder="State"
          maxLength={2}
          onChange={(value) => onChange("fromAddress", "state", value.toUpperCase())}
        />
        <TextInput
          value={form.fromAddress.zip}
          placeholder="ZIP"
          maxLength={5}
          onChange={(value) => onChange("fromAddress", "zip", value)}
        />
        <TextInput
          value={form.fromAddress.country}
          placeholder="Country"
          onChange={(value) => onChange("fromAddress", "country", value.toUpperCase())}
        />
      </div>

      <p className="text-xs text-ink-muted uppercase tracking-wider">Parcel</p>
      <div className="grid grid-cols-4 gap-2">
        <TextInput
          value={form.parcel.length_in}
          placeholder="L in"
          inputMode="decimal"
          onChange={(value) => onChange("parcel", "length_in", value)}
        />
        <TextInput
          value={form.parcel.width_in}
          placeholder="W in"
          inputMode="decimal"
          onChange={(value) => onChange("parcel", "width_in", value)}
        />
        <TextInput
          value={form.parcel.height_in}
          placeholder="H in"
          inputMode="decimal"
          onChange={(value) => onChange("parcel", "height_in", value)}
        />
        <TextInput
          value={form.parcel.weight_oz}
          placeholder="Oz"
          inputMode="decimal"
          onChange={(value) => onChange("parcel", "weight_oz", value)}
        />
      </div>

      <ActionButton
        label="Get Carrier Rates"
        action="prepare-shipping"
        onClick={onPrepareRates}
        loading={loading}
      />

      {rates.length > 0 && (
        <div className="space-y-2">
          {rates.map((rate) => {
            const rateId = rate.id ?? `${rate.carrier}-${rate.service}`;
            return (
              <button
                key={rateId}
                type="button"
                onClick={() => onPurchaseRate(rateId)}
                disabled={!!loading || !rate.id}
                className="w-full rounded-lg border border-line bg-surface-sunken/60 px-3 py-2 text-left text-sm transition-colors hover:border-action-primary/50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <span className="flex items-center justify-between gap-3">
                  <span className="text-ink">
                    {rate.carrier} {rate.service}
                  </span>
                  <span className="font-semibold text-ink">{formatCurrency(rate.rate_minor)}</span>
                </span>
                <span className="mt-0.5 block text-xs text-ink-muted">
                  {rate.est_delivery_days
                    ? `${rate.est_delivery_days} business days`
                    : "Delivery estimate unavailable"}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SettlementSection({
  settlement,
  payment,
  dispute,
  isBuyer,
  isSeller,
  isWalletConnected,
  walletAddress,
  loading,
  onAction,
}: {
  settlement: SettlementReleaseState;
  payment: PaymentIntent | null;
  dispute: Dispute | null;
  isBuyer: boolean;
  isSeller: boolean;
  isWalletConnected: boolean;
  walletAddress?: Address;
  loading: string | null;
  onAction: (action: string) => void;
}) {
  const release = settlement.release;
  if (!release) {
    return (
      <SectionCard title="Settlement" icon="creditcard">
        <p className="text-sm text-ink-secondary">Settlement starts after funding is confirmed.</p>
      </SectionCard>
    );
  }

  const conditionalStatus = settlement.conditionalSettlement?.status;
  const activeDispute = Boolean(
    dispute &&
      !["CLOSED", "PARTIAL_REFUND"].includes(dispute.status) &&
      !dispute.status.startsWith("RESOLVED"),
  );
  const releasePending = [
    "RELEASE_SUBMITTED",
    "RELEASE_PENDING",
    "RELEASE_CONFIRMATIONS_PENDING",
  ].includes(conditionalStatus ?? "");
  const releaseComplete =
    payment?.status === "SETTLED" || conditionalStatus === "RELEASE_CONFIRMED";

  return (
    <SectionCard title="Settlement" icon="creditcard">
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-ink-secondary">Release phase</span>
          <span className="text-xs font-medium text-ink text-right">
            {(settlement.phase ?? "UNKNOWN").replace(/_/g, " ")}
          </span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-ink-secondary">Contract</span>
          <span className="text-xs font-medium text-ink text-right">
            {(conditionalStatus ?? "NOT AVAILABLE").replace(/_/g, " ")}
          </span>
        </div>

        {activeDispute && (
          <InlineNotice tone="info">
            Settlement is locked while this dispute is active.
          </InlineNotice>
        )}

        {!activeDispute && isBuyer && release.product_release_status === "BUYER_REVIEW" && (
          <ActionButton
            label="Confirm item received"
            action="buyer-confirm-receipt"
            onClick={onAction}
            loading={loading}
            variant="primary"
          />
        )}

        {!activeDispute &&
          isSeller &&
          IS_STAGING_SETTLEMENT_TEST &&
          release.product_release_status === "RELEASED" &&
          release.buffer_release_status !== "RELEASED" && (
            <ActionButton
              label="Finalize test shipping cost"
              action="complete-test-buffer"
              onClick={onAction}
              loading={loading}
            />
          )}

        {!activeDispute &&
          isSeller &&
          settlement.phase === "FULLY_RELEASED" &&
          !releaseComplete && (
            <>
              {!isWalletConnected ? (
                <div className="flex justify-start">
                  <ConnectButton />
                </div>
              ) : (
                <ActionButton
                  label={releasePending ? "Confirm release transaction" : "Release hUSDC to seller"}
                  action={releasePending ? "confirm-contract-release" : "release-contract"}
                  onClick={onAction}
                  loading={loading}
                  variant="primary"
                />
              )}
              {walletAddress && (
                <p className="text-xs font-mono text-ink-muted">
                  Connected {walletAddress.slice(0, 8)}...{walletAddress.slice(-6)}
                </p>
              )}
            </>
          )}

        {releaseComplete && (
          <div className="rounded-lg bg-success-soft border border-success/20 px-3 py-2 text-sm text-success">
            Onchain settlement confirmed
          </div>
        )}
      </div>
    </SectionCard>
  );
}

// ─── Dispute Section ─────────────────────────────────────────
function DisputeSection({
  dispute,
  orderId,
  shipment,
  isBuyer,
  onReturnLabel,
  loading,
}: {
  dispute: Dispute | null;
  orderId: string;
  shipment: Shipment | null;
  isBuyer: boolean;
  onReturnLabel: () => void;
  loading: string | null;
}) {
  if (dispute) {
    const canCreateReturnLabel =
      isBuyer &&
      shipment?.status === "DELIVERED" &&
      (dispute.status === "RESOLVED_BUYER_FAVOR" || dispute.resolution?.outcome === "buyer_favor");

    return (
      <SectionCard title="Dispute" icon="shield">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-ink-secondary">Status</span>
            <StatusBadge domain="order" status={dispute.status} />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-ink-secondary">Reason</span>
            <span className="text-sm text-ink-secondary">
              {dispute.reason_code.replace(/_/g, " ")}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-ink-secondary">Opened by</span>
            <span className="text-sm text-ink-secondary capitalize">{dispute.opened_by}</span>
          </div>
          {dispute.evidence.length > 0 && (
            <div className="border-t border-line pt-3">
              <p className="text-xs text-ink-muted uppercase tracking-wider mb-2">
                Evidence ({dispute.evidence.length})
              </p>
              {dispute.evidence.map((e) => (
                <div
                  key={`${e.submitted_by}-${e.type}-${e.text ?? ""}`}
                  className="text-xs text-ink-secondary mb-1"
                >
                  [{e.submitted_by}] {e.text ?? e.type}
                </div>
              ))}
            </div>
          )}
          <Link
            href={`/disputes/${dispute.id}`}
            className="block text-center text-sm text-action-primary hover:text-action-primary-hover transition-colors pt-1"
          >
            View Full Dispute
          </Link>
          {canCreateReturnLabel && (
            <ActionButton
              label="Create Return Label"
              action="return-label"
              onClick={onReturnLabel}
              loading={loading}
            />
          )}
        </div>
      </SectionCard>
    );
  }

  return (
    <SectionCard title="Dispute" icon="shield">
      <p className="text-sm text-ink-secondary mb-3">No dispute for this order.</p>
      <Link
        href={`/disputes/new?orderId=${orderId}`}
        className={cn(
          buttonVariants({
            variant:
              shipment?.status === "DELIVERED" || shipment?.status === "DELIVERY_EXCEPTION"
                ? "destructive"
                : "secondary",
            size: "sm",
          }),
          "w-full",
        )}
      >
        {shipment?.status === "DELIVERED" || shipment?.status === "DELIVERY_EXCEPTION"
          ? "Report an Issue"
          : "Check Issue Eligibility"}
      </Link>
    </SectionCard>
  );
}

// ─── Address Section ─────────────────────────────────────────
function AddressSection({
  order,
  addresses,
  currentUserId,
  form,
  loading,
  onChange,
  onSave,
}: {
  order: OrderState["order"];
  addresses: Record<string, OrderAddress>;
  currentUserId: string | null;
  form: AddressFormState;
  loading: string | null;
  onChange: (field: keyof AddressFormState, value: string) => void;
  onSave: () => void;
}) {
  if (!order) return null;

  const buyerAddress = addresses.buyer;
  const isBuyer = currentUserId === order.buyerId;

  if (buyerAddress) {
    return (
      <SectionCard title="Delivery Address" icon="location">
        <div className="space-y-1 text-sm">
          <p className="font-medium text-ink">{buyerAddress.name}</p>
          <p className="text-ink-secondary">{buyerAddress.street1}</p>
          {buyerAddress.street2 && <p className="text-ink-secondary">{buyerAddress.street2}</p>}
          <p className="text-ink-secondary">
            {buyerAddress.city}, {buyerAddress.state} {buyerAddress.zip}
          </p>
          {buyerAddress.phone && <p className="text-ink-muted">{buyerAddress.phone}</p>}
        </div>
      </SectionCard>
    );
  }

  if (!isBuyer) {
    return (
      <SectionCard title="Delivery Address" icon="location">
        <InlineNotice tone="warning">
          Buyer shipping address is required before the seller can prepare carrier rates.
        </InlineNotice>
      </SectionCard>
    );
  }

  return (
    <SectionCard title="Delivery Address" icon="location">
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <TextInput
            value={form.name}
            placeholder="Name"
            onChange={(value) => onChange("name", value)}
          />
          <TextInput
            value={form.phone}
            placeholder="Phone"
            onChange={(value) => onChange("phone", value)}
          />
          <TextInput
            className="col-span-2"
            value={form.street1}
            placeholder="Street address"
            onChange={(value) => onChange("street1", value)}
          />
          <TextInput
            className="col-span-2"
            value={form.street2}
            placeholder="Apt, suite"
            onChange={(value) => onChange("street2", value)}
          />
          <TextInput
            value={form.city}
            placeholder="City"
            onChange={(value) => onChange("city", value)}
          />
          <TextInput
            value={form.state}
            placeholder="State"
            maxLength={2}
            onChange={(value) => onChange("state", value.toUpperCase())}
          />
          <TextInput
            value={form.zip}
            placeholder="ZIP"
            maxLength={5}
            onChange={(value) => onChange("zip", value)}
          />
          <TextInput
            value={form.country}
            placeholder="Country"
            onChange={(value) => onChange("country", value.toUpperCase())}
          />
          <TextInput
            className="col-span-2"
            value={form.email}
            placeholder="Email"
            onChange={(value) => onChange("email", value)}
          />
        </div>
        <ActionButton
          label="Save Delivery Address"
          action="save-buyer-address"
          onClick={onSave}
          loading={loading}
        />
      </div>
    </SectionCard>
  );
}

// ─── Shared Components ───────────────────────────────────────
function SectionCard({
  title,
  icon,
  children,
}: {
  title: string;
  icon: "creditcard" | "truck" | "shield" | "location";
  children: React.ReactNode;
}) {
  const icons: Record<string, React.ReactNode> = {
    creditcard: (
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        width="18"
        height="18"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
        <line x1="1" y1="10" x2="23" y2="10" />
      </svg>
    ),
    truck: (
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        width="18"
        height="18"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="1" y="3" width="15" height="13" />
        <polygon points="16 8 20 8 23 11 23 16 16 16 16 8" />
        <circle cx="5.5" cy="18.5" r="2.5" />
        <circle cx="18.5" cy="18.5" r="2.5" />
      </svg>
    ),
    shield: (
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        width="18"
        height="18"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      </svg>
    ),
    location: (
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        width="18"
        height="18"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M21 10c0 7-9 12-9 12S3 17 3 10a9 9 0 0 1 18 0z" />
        <circle cx="12" cy="10" r="3" />
      </svg>
    ),
  };

  return (
    <div className="rounded-xl border border-line bg-surface-raised/50 overflow-hidden">
      <div className="flex items-center gap-2 px-5 py-3 border-b border-line">
        <span className="text-ink-secondary">{icons[icon]}</span>
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function ActionButton({
  label,
  action,
  onClick,
  loading,
  variant = "primary",
}: {
  label: string;
  action: string;
  onClick: (action: string) => void;
  loading: string | null;
  variant?: "primary" | "danger";
}) {
  const isLoading = loading === action;
  return (
    <Button
      variant={variant === "danger" ? "destructive" : "primary"}
      size="sm"
      fullWidth
      loading={isLoading}
      disabled={!!loading}
      onClick={() => onClick(action)}
    >
      {isLoading ? `${label}...` : label}
    </Button>
  );
}

function InlineNotice({ children, tone }: { children: React.ReactNode; tone: "info" | "warning" }) {
  const styles =
    tone === "warning"
      ? "border-warning/20 bg-warning-soft text-warning"
      : "border-action-primary/20 bg-action-primary/10 text-action-primary";
  return <div className={`rounded-lg border px-3 py-2 text-sm ${styles}`}>{children}</div>;
}

function TextInput({
  value,
  placeholder,
  onChange,
  className = "",
  maxLength,
  inputMode,
}: {
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  className?: string;
  maxLength?: number;
  inputMode?: "decimal" | "numeric" | "text";
}) {
  return (
    <input
      value={value}
      placeholder={placeholder}
      maxLength={maxLength}
      inputMode={inputMode}
      onChange={(event) => onChange(event.target.value)}
      className={`min-w-0 rounded-md border border-line bg-surface-sunken px-2.5 py-2 text-sm text-ink placeholder:text-ink-muted focus:border-focus focus:outline-none ${className}`}
    />
  );
}

// ─── Activity Log ────────────────────────────────────────────
interface LogEntry {
  time: string;
  action: string;
  detail: string;
  status: "success" | "error" | "info";
}

const LOG_TONES: Record<LogEntry["status"], FeedEvent["tone"]> = {
  success: "success",
  error: "error",
  info: "default",
};

function ActivityLog({ entries }: { entries: LogEntry[] }) {
  if (entries.length === 0) return null;

  const feedEvents: FeedEvent[] = entries.map((entry) => ({
    id: `${entry.time}-${entry.action}`,
    label: (
      <span>
        <span className="font-medium text-ink-secondary">{entry.action}</span>
        <span className="text-ink-muted"> {entry.detail}</span>
      </span>
    ),
    time: entry.time,
    tone: LOG_TONES[entry.status],
  }));

  return (
    <div className="rounded-xl border border-line bg-surface-raised/50 overflow-hidden">
      <div className="flex items-center gap-2 px-5 py-3 border-b border-line">
        <span className="text-ink-secondary">
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            width="18"
            height="18"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
          </svg>
        </span>
        <h2 className="text-sm font-semibold text-ink">Activity Log</h2>
      </div>
      <div className="p-5 max-h-64 overflow-y-auto">
        <ActivityFeed events={feedEvents} />
      </div>
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────
function OrderDetailContent() {
  const params = useParams();
  const orderId = params.id as string;
  const { address: walletAddress, isConnected: isWalletConnected } = useAccount();
  const walletChainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();

  const [state, setState] = useState<OrderState>({
    order: null,
    payment: null,
    shipment: null,
    dispute: null,
    settlementRelease: { release: null, phase: null, conditionalSettlement: null },
  });
  const [loading, setLoading] = useState<string | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [shippingForm, setShippingForm] = useState<ShippingFormState>(EMPTY_SHIPPING_FORM);
  const [shippingRates, setShippingRates] = useState<ShippingRate[]>([]);
  const [addressForm, setAddressForm] = useState<AddressFormState>(EMPTY_ADDRESS_FORM);
  const [orderAddresses, setOrderAddresses] = useState<Record<string, OrderAddress>>({});
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  const addLog = useCallback(
    (action: string, detail: string, status: "success" | "error" | "info" = "info") => {
      const time = new Date().toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
      setLog((prev) => [{ time, action, detail, status }, ...prev]);
    },
    [],
  );

  // Load order data — use aggregated endpoint for efficiency
  const loadOrderAddresses = useCallback(async () => {
    const data = await api
      .get<Record<string, OrderAddress>>(`/orders/${orderId}/addresses`)
      .catch(() => null);
    setOrderAddresses(data ?? {});
  }, [orderId]);

  const loadOrder = useCallback(async () => {
    try {
      const [data, settlementData] = await Promise.all([
        api.get<{
          order: OrderState["order"];
          payment: PaymentIntent | null;
          shipment: Shipment | null;
          dispute: Dispute | null;
        }>(`/demo/e2e/order/${orderId}`),
        api
          .get<{
            release: SettlementRelease;
            phase: string;
            conditional_settlement?: ConditionalSettlementSummary;
          }>(`/settlement-releases/by-order/${orderId}`)
          .catch(() => null),
      ]);

      setState({
        order: data.order,
        payment: data.payment,
        shipment: data.shipment,
        dispute: data.dispute,
        settlementRelease: {
          release: settlementData?.release ?? null,
          phase: settlementData?.phase ?? null,
          conditionalSettlement: settlementData?.conditional_settlement ?? null,
        },
      });
    } catch {
      // Fallback: try individual endpoints
      try {
        const orderData = await api
          .get<{ order: OrderState["order"] }>(`/commerce/orders/${orderId}`)
          .catch(() => null);
        const paymentData = await api
          .get<{ payment: PaymentIntent }>(`/payments/by-order/${orderId}`)
          .catch(() => null);
        const shipmentData = await api
          .get<{ shipment: Shipment }>(`/shipments/by-order/${orderId}`)
          .catch(() => null);
        const disputeData = await api
          .get<{ dispute: Dispute }>(`/disputes/by-order/${orderId}`)
          .catch(() => null);
        const settlementData = await api
          .get<{
            release: SettlementRelease;
            phase: string;
            conditional_settlement?: ConditionalSettlementSummary;
          }>(`/settlement-releases/by-order/${orderId}`)
          .catch(() => null);
        setState({
          order: orderData?.order ?? null,
          payment: paymentData?.payment ?? null,
          shipment: shipmentData?.shipment ?? null,
          dispute: disputeData?.dispute ?? null,
          settlementRelease: {
            release: settlementData?.release ?? null,
            phase: settlementData?.phase ?? null,
            conditionalSettlement: settlementData?.conditional_settlement ?? null,
          },
        });
      } catch {
        // Silently handle
      }
    } finally {
      await loadOrderAddresses();
      setInitialLoading(false);
    }
  }, [loadOrderAddresses, orderId]);

  useEffect(() => {
    loadOrder();
  }, [loadOrder]);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth
      .getUser()
      .then(({ data }) => {
        setCurrentUserId(data.user?.id ?? null);
      })
      .catch(() => setCurrentUserId(null));
  }, []);

  // ─── Payment Actions ────────────────────────────────────────
  async function handlePaymentAction(action: string) {
    if (!state.payment && action !== "prepare") return;
    setLoading(action);

    try {
      switch (action) {
        case "prepare": {
          addLog("Payment", "Preparing payment intent...", "info");
          const result = await api.post<{ intent: PaymentIntent }>("/payments/prepare", {
            settlement_approval: {
              id: `sa_${orderId}`,
              approval_state: "APPROVED",
              seller_policy: {
                mode: "AUTO_WITHIN_POLICY",
                fulfillment_sla: { shipment_input_due_days: 3 },
                responsiveness: {
                  median_response_minutes: 30,
                  p95_response_minutes: 120,
                  reliable_fast_responder: true,
                },
              },
              terms: {
                listing_id: `lst_demo`,
                seller_id: state.order?.sellerId ?? "seller_demo",
                buyer_id: state.order?.buyerId ?? "buyer_demo",
                final_amount_minor: state.order?.amountMinor ?? 50000,
                currency: "USD",
                selected_payment_rail: "x402",
              },
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
            payment_disclosure_ack: createPaymentDisclosureAck({ stripeFallback: true }),
          });
          setState((s) => ({ ...s, payment: result.intent }));
          addLog("Payment", `Intent created: ${result.intent.id.slice(0, 16)}...`, "success");
          break;
        }
        case "quote": {
          addLog("Payment", "Getting quote...", "info");
          const result = await api.post<{ intent: PaymentIntent }>(
            `/payments/${state.payment!.id}/quote`,
          );
          setState((s) => ({ ...s, payment: result.intent }));
          addLog("Payment", "Quote received", "success");
          break;
        }
        case "authorize": {
          addLog("Payment", "Authorizing...", "info");
          const result = await api.post<{ intent: PaymentIntent }>(
            `/payments/${state.payment!.id}/authorize`,
          );
          setState((s) => ({ ...s, payment: result.intent }));
          addLog("Payment", "Payment authorized", "success");
          break;
        }
        case "settle": {
          addLog("Payment", "Settling payment...", "info");
          const result = await api.post<{
            intent: PaymentIntent;
            shipment?: Shipment;
            settlement_release?: unknown;
          }>(`/payments/${state.payment!.id}/settle`);
          setState((s) => ({
            ...s,
            payment: result.intent,
            shipment: result.shipment ?? s.shipment,
          }));
          addLog("Payment", "Payment settled!", "success");
          if (result.shipment) {
            addLog(
              "Shipping",
              `Shipment auto-created: ${result.shipment.id.slice(0, 16)}...`,
              "success",
            );
          }
          await loadOrder();
          break;
        }
        case "confirm_funding": {
          addLog("Payment", "Confirming the existing funding transaction...", "info");
          await confirmConditionalSettlementFunding(state.payment!.id);
          addLog("Payment", "Funding confirmed; fulfillment is ready", "success");
          await loadOrder();
          break;
        }
      }
    } catch (err) {
      addLog("Payment", err instanceof Error ? err.message : "Action failed", "error");
    } finally {
      setLoading(null);
    }
  }

  // ─── Shipping Actions ───────────────────────────────────────
  async function handleShippingAction(action: string) {
    if (!state.shipment) return;
    setLoading(action);

    try {
      switch (action) {
        case "test-in-transit":
        case "test-out-for-delivery":
        case "test-delivered": {
          const status =
            action === "test-in-transit"
              ? "in_transit"
              : action === "test-out-for-delivery"
                ? "out_for_delivery"
                : "delivered";
          addLog("Shipping", `Verifying EasyPost test status: ${status}...`, "info");
          const result = await api.post<{
            shipment: Shipment;
            provider_verification: { tracker_id?: string; tracking_code?: string };
          }>(`/shipments/${state.shipment.id}/test-tracker`, { status });
          setState((current) => ({ ...current, shipment: result.shipment }));
          addLog(
            "Shipping",
            `EasyPost verified ${status}${result.provider_verification.tracker_id ? ` (${result.provider_verification.tracker_id})` : ""}`,
            "success",
          );
          await loadOrder();
          break;
        }
        case "label": {
          addLog("Shipping", "Creating label...", "info");
          const result = await api.post<{ shipment: Shipment }>(
            `/shipments/${state.shipment.id}/label`,
          );
          setState((s) => ({ ...s, shipment: result.shipment }));
          addLog("Shipping", "Label created", "success");
          await loadOrder();
          break;
        }
        case "ship": {
          addLog("Shipping", "Recording ship event...", "info");
          const result = await api.post<{ shipment: Shipment }>(
            `/shipments/${state.shipment.id}/event`,
            {
              event_type: "ship",
              payload: { message: "Package picked up by carrier" },
            },
          );
          setState((s) => ({ ...s, shipment: result.shipment }));
          addLog("Shipping", "Marked as shipped (IN_TRANSIT)", "success");
          await loadOrder();
          break;
        }
        case "deliver": {
          addLog("Shipping", "Recording delivery...", "info");
          const result = await api.post<{ shipment: Shipment }>(
            `/shipments/${state.shipment.id}/event`,
            {
              event_type: "deliver",
              payload: { message: "Package delivered to recipient" },
            },
          );
          setState((s) => ({ ...s, shipment: result.shipment }));
          addLog("Shipping", "Delivered!", "success");
          await loadOrder();
          break;
        }
      }
    } catch (err) {
      addLog("Shipping", err instanceof Error ? err.message : "Action failed", "error");
    } finally {
      setLoading(null);
    }
  }

  async function handleSettlementAction(action: string) {
    const release = state.settlementRelease.release;
    if (!release) return;
    setLoading(action);

    try {
      if (action === "buyer-confirm-receipt") {
        addLog("Settlement", "Confirming buyer receipt...", "info");
        await api.post(`/orders/${orderId}/confirm-delivery`, { confirmed: true });
        addLog("Settlement", "Buyer receipt confirmed", "success");
        await loadOrder();
        return;
      }

      if (action === "complete-test-buffer") {
        addLog("Settlement", "Finalizing the EasyPost test APV buffer...", "info");
        await api.post(`/settlement-releases/by-order/${orderId}/complete-test-buffer`, {});
        addLog("Settlement", "Test shipping cost finalized", "success");
        await loadOrder();
        return;
      }

      if (!walletAddress || !isWalletConnected) {
        throw new Error("Connect the seller payout wallet before releasing settlement.");
      }
      if (walletChainId !== HAGGLE_WALLET_CHAIN_ID) {
        await switchChainAsync({ chainId: HAGGLE_WALLET_CHAIN_ID });
      }

      if (action === "confirm-contract-release") {
        const storedHash = state.settlementRelease.conditionalSettlement?.release_tx_hash;
        if (!storedHash || !isHex(storedHash) || storedHash.length !== 66) {
          throw new Error("No submitted release transaction is available to confirm.");
        }
        addLog("Settlement", "Checking release transaction finality...", "info");
        await confirmConditionalSettlementRelease(release.id, storedHash as `0x${string}`);
        addLog("Settlement", "Onchain settlement confirmed", "success");
        await loadOrder();
        return;
      }

      if (action !== "release-contract") return;
      addLog("Settlement", "Requesting a signed release instruction...", "info");
      const request = await api.post<ConditionalReleaseRequest>(
        `/settlement-releases/${release.id}/conditional-release-request`,
        { seller_wallet_address: walletAddress },
      );
      const verifyingContract = request.typed_data.domain.verifyingContract;
      if (
        request.typed_data.domain.chainId !== HAGGLE_WALLET_CHAIN_ID ||
        !verifyingContract ||
        !isAddress(verifyingContract) ||
        !HAGGLE_CONDITIONAL_SETTLEMENT_ADDRESS ||
        getAddress(verifyingContract) !== getAddress(HAGGLE_CONDITIONAL_SETTLEMENT_ADDRESS)
      ) {
        throw new Error("The release instruction targets an unexpected contract or network.");
      }
      if (getAddress(request.contract_call.params.sellerWallet) !== getAddress(walletAddress)) {
        throw new Error("Connect the seller wallet recorded for this settlement.");
      }

      addLog("Settlement", "Submitting the hUSDC release transaction...", "info");
      const txHash = await writeContractAsync({
        address: HAGGLE_CONDITIONAL_SETTLEMENT_ADDRESS,
        abi: HAGGLE_CONDITIONAL_SETTLEMENT_ABI,
        functionName: "release",
        args: [toConditionalReleaseTuple(request), request.contract_call.signature],
        chainId: HAGGLE_WALLET_CHAIN_ID,
      });
      await api.post(`/settlement-releases/${release.id}/conditional-release-execution`, {
        tx_hash: txHash,
        settlement_id: request.contract_call.params.settlementId,
        contract_address: HAGGLE_CONDITIONAL_SETTLEMENT_ADDRESS,
        chain_id: HAGGLE_WALLET_CHAIN_ID,
      });
      addLog("Settlement", `Release submitted: ${txHash.slice(0, 12)}...`, "success");
      await confirmConditionalSettlementRelease(release.id, txHash);
      addLog("Settlement", "Onchain settlement confirmed", "success");
      await loadOrder();
    } catch (err) {
      addLog(
        "Settlement",
        err instanceof Error ? err.message : "Settlement action failed",
        "error",
      );
    } finally {
      setLoading(null);
    }
  }

  function handleShippingFormChange(
    section: "fromAddress" | "parcel",
    field: string,
    value: string,
  ) {
    setShippingForm((current) => ({
      ...current,
      [section]: {
        ...current[section],
        [field]: value,
      },
    }));
  }

  function numericParcelValue(value: string): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new Error("Parcel dimensions and weight must be greater than zero.");
    }
    return parsed;
  }

  async function handlePrepareShippingRates() {
    if (!state.shipment) return;
    setLoading("prepare-shipping");
    try {
      addLog("Shipping", "Requesting carrier rates...", "info");
      const result = await api.post<{ shipment: Shipment; rates: ShippingRate[] }>(
        `/shipments/${state.shipment.id}/prepare`,
        {
          from_address: {
            name: shippingForm.fromAddress.name,
            street1: shippingForm.fromAddress.street1,
            street2: shippingForm.fromAddress.street2 || undefined,
            city: shippingForm.fromAddress.city,
            state: shippingForm.fromAddress.state,
            zip: shippingForm.fromAddress.zip,
            country: shippingForm.fromAddress.country || "US",
            phone: shippingForm.fromAddress.phone || undefined,
          },
          parcel: {
            length_in: numericParcelValue(shippingForm.parcel.length_in),
            width_in: numericParcelValue(shippingForm.parcel.width_in),
            height_in: numericParcelValue(shippingForm.parcel.height_in),
            weight_oz: numericParcelValue(shippingForm.parcel.weight_oz),
          },
        },
      );
      setState((s) => ({ ...s, shipment: result.shipment ?? s.shipment }));
      setShippingRates(result.rates ?? []);
      addLog("Shipping", `${result.rates?.length ?? 0} carrier rates returned`, "success");
    } catch (err) {
      addLog("Shipping", err instanceof Error ? err.message : "Rate request failed", "error");
    } finally {
      setLoading(null);
    }
  }

  async function handleSelectShippingExecutionMode(
    executionMode: "integration_manual" | "physical_live",
  ) {
    if (!state.shipment) return;
    setLoading(`shipping-mode-${executionMode}`);
    try {
      const result = await api.post<{ shipment: Shipment }>(
        `/shipments/${state.shipment.id}/execution-mode`,
        { execution_mode: executionMode },
      );
      setState((current) => ({ ...current, shipment: result.shipment }));
      setShippingRates([]);
      addLog(
        "Shipping",
        executionMode === "physical_live"
          ? "Physical shipping selected: live label charges and carrier scans are enabled"
          : "Integration mode selected: test label and controlled tracking are enabled",
        "success",
      );
    } catch (err) {
      addLog("Shipping", err instanceof Error ? err.message : "Mode selection failed", "error");
    } finally {
      setLoading(null);
    }
  }

  async function handlePurchaseRate(rateId: string) {
    if (!state.shipment) return;
    const isPhysicalShipping = state.shipment.metadata?.shipping_execution_mode === "physical_live";
    if (
      isPhysicalShipping &&
      !window.confirm(
        "This purchases a live EasyPost label using Haggle's staging fiat budget. It does not spend hUSDC for postage. Continue?",
      )
    ) {
      return;
    }
    setLoading(`purchase-${rateId}`);
    try {
      addLog("Shipping", "Purchasing selected label...", "info");
      const result = await api.post<{
        shipment: Shipment;
        label_url?: string;
        tracking_number?: string;
      }>(
        `/shipments/${state.shipment.id}/purchase-label`,
        { rate_id: rateId, acknowledge_live_charge: isPhysicalShipping },
        {
          headers: createShipmentMutationHeaders("purchase-label", state.shipment.id, rateId),
        },
      );
      setState((s) => ({ ...s, shipment: result.shipment }));
      setShippingRates([]);
      addLog(
        "Shipping",
        `Label purchased${result.tracking_number ? `: ${result.tracking_number}` : ""}`,
        "success",
      );
      await loadOrder();
    } catch (err) {
      addLog("Shipping", err instanceof Error ? err.message : "Label purchase failed", "error");
    } finally {
      setLoading(null);
    }
  }

  function handleAddressFormChange(field: keyof AddressFormState, value: string) {
    setAddressForm((current) => ({ ...current, [field]: value }));
  }

  async function handleSaveBuyerAddress() {
    if (!state.order) return;
    setLoading("save-buyer-address");
    try {
      addLog("Shipping", "Saving delivery address...", "info");
      await api.post(`/orders/${state.order.id}/addresses`, {
        role: "buyer",
        name: addressForm.name,
        street1: addressForm.street1,
        street2: addressForm.street2 || undefined,
        city: addressForm.city,
        state: addressForm.state,
        zip: addressForm.zip,
        country: addressForm.country || "US",
        phone: addressForm.phone || undefined,
        email: addressForm.email || undefined,
      });
      await loadOrderAddresses();
      addLog("Shipping", "Delivery address saved", "success");
    } catch (err) {
      addLog("Shipping", err instanceof Error ? err.message : "Address save failed", "error");
    } finally {
      setLoading(null);
    }
  }

  async function handleCreateReturnLabel() {
    if (!state.shipment) return;
    const isPhysicalShipping = state.shipment.metadata?.shipping_execution_mode === "physical_live";
    if (
      isPhysicalShipping &&
      !window.confirm(
        "This purchases a live EasyPost return label using Haggle's staging fiat budget. Continue?",
      )
    ) {
      return;
    }
    setLoading("return-label");
    try {
      addLog("Shipping", "Creating return label...", "info");
      const result = await api.post<{ shipment: Shipment; tracking_number?: string | null }>(
        `/shipments/${state.shipment.id}/return-label`,
        { acknowledge_live_charge: isPhysicalShipping },
      );
      addLog(
        "Shipping",
        `Return label created${result.tracking_number ? `: ${result.tracking_number}` : ""}`,
        "success",
      );
    } catch (err) {
      addLog("Shipping", err instanceof Error ? err.message : "Return label failed", "error");
    } finally {
      setLoading(null);
    }
  }

  // ─── Compute timeline ───────────────────────────────────────
  function getTimelineSteps() {
    const paymentStatus = state.payment?.status;
    const shipmentStatus = state.shipment?.status;
    const disputeStatus = state.dispute?.status;

    const paymentDone = paymentStatus === "SETTLED";
    const shipped = ["IN_TRANSIT", "OUT_FOR_DELIVERY", "DELIVERED"].includes(shipmentStatus ?? "");
    const delivered = shipmentStatus === "DELIVERED";
    const hasDispute = !!disputeStatus;

    const steps: Array<{ label: string; status: StepStatus; detail?: string }> = [
      {
        label: "Payment",
        status: paymentDone ? "done" : paymentStatus ? "active" : "pending",
        detail: paymentStatus ? paymentStatus.replace(/_/g, " ") : "Awaiting payment",
      },
      {
        label: "Shipping Label",
        status:
          shipped || shipmentStatus === "LABEL_CREATED"
            ? "done"
            : paymentDone && shipmentStatus === "LABEL_PENDING"
              ? "active"
              : "pending",
        detail: shipmentStatus === "LABEL_CREATED" || shipped ? "Created" : undefined,
      },
      {
        label: "In Transit",
        status: shipped ? (delivered ? "done" : "active") : "pending",
        detail: shipped && !delivered ? "On the way" : undefined,
      },
      {
        label: "Delivered",
        status: delivered ? "done" : "pending",
        detail: state.shipment?.delivered_at ? formatTime(state.shipment.delivered_at) : undefined,
      },
    ];

    if (hasDispute) {
      steps.push({
        label: "Dispute",
        status:
          disputeStatus === "CLOSED" ||
          disputeStatus === "PARTIAL_REFUND" ||
          disputeStatus?.startsWith("RESOLVED")
            ? "done"
            : "active",
        detail: disputeStatus?.replace(/_/g, " "),
      });
    }

    return steps;
  }

  // ─── Render ─────────────────────────────────────────────────
  if (initialLoading) {
    return (
      <main className="min-h-[calc(100vh-4rem)] flex items-center justify-center gap-2 text-ink-secondary text-sm">
        <Spinner size="sm" />
        Loading order...
      </main>
    );
  }

  const timelineSteps = getTimelineSteps();

  return (
    <main className="min-h-[calc(100vh-4rem)] px-4 py-6 sm:p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <BackLink href="/buy/dashboard" className="mb-3">
            Back
          </BackLink>
          <h1 className="text-xl font-bold text-ink">Order Details</h1>
          <p className="text-sm text-ink-secondary font-mono mt-0.5">{orderId}</p>
        </div>
        {state.order && (
          <div className="text-right">
            <p className="text-lg font-bold text-ink">
              {formatCurrency(state.order.amountMinor, state.order.currency)}
            </p>
            <StatusBadge domain="order" status={state.order.status} />
          </div>
        )}
      </div>

      {/* Timeline */}
      <div className="rounded-xl border border-line bg-surface-raised/50 p-5 mb-6">
        <h2 className="text-sm font-semibold text-ink mb-4">Progress</h2>
        <div>
          {timelineSteps.map((step, i) => (
            <TimelineStep
              key={step.label}
              label={step.label}
              status={step.status}
              detail={step.detail}
              isLast={i === timelineSteps.length - 1}
            />
          ))}
        </div>
      </div>

      {/* Action Panels */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 mb-6">
        <AddressSection
          order={state.order}
          addresses={orderAddresses}
          currentUserId={currentUserId}
          form={addressForm}
          loading={loading}
          onChange={handleAddressFormChange}
          onSave={handleSaveBuyerAddress}
        />
        <PaymentSection
          payment={state.payment}
          onAction={handlePaymentAction}
          loading={loading}
          isProduction={IS_PRODUCTION}
          fulfillmentReady={isFulfillmentReady(state.order?.status, state.shipment)}
        />
        <ShippingSection
          shipment={state.shipment}
          onAction={handleShippingAction}
          loading={loading}
          isProduction={IS_PRODUCTION}
          isSeller={canManageSellerShipping(currentUserId, state.order?.sellerId)}
          testTrackingEnabled={IS_STAGING_SETTLEMENT_TEST}
          shippingForm={shippingForm}
          rates={shippingRates}
          onShippingFormChange={handleShippingFormChange}
          onPrepareRates={handlePrepareShippingRates}
          onPurchaseRate={handlePurchaseRate}
          onSelectExecutionMode={handleSelectShippingExecutionMode}
        />
        <SettlementSection
          settlement={state.settlementRelease}
          payment={state.payment}
          dispute={state.dispute}
          isBuyer={currentUserId === state.order?.buyerId}
          isSeller={currentUserId === state.order?.sellerId}
          isWalletConnected={isWalletConnected}
          walletAddress={walletAddress}
          loading={loading}
          onAction={handleSettlementAction}
        />
        <DisputeSection
          dispute={state.dispute}
          orderId={orderId}
          shipment={state.shipment}
          isBuyer={currentUserId === state.order?.buyerId}
          onReturnLabel={handleCreateReturnLabel}
          loading={loading}
        />
      </div>

      {/* Activity Log */}
      <ActivityLog entries={log} />

      {/* Refresh button */}
      <div className="mt-4 text-center">
        <button
          type="button"
          onClick={() => loadOrder()}
          className="text-sm text-ink-muted hover:text-ink-secondary transition-colors"
        >
          Refresh data
        </button>
      </div>
    </main>
  );
}

export default function OrderDetailPage() {
  return (
    <WalletProvider>
      <OrderDetailContent />
    </WalletProvider>
  );
}
