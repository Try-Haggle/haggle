"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api-client";
import { createClient } from "@/lib/supabase/client";

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
}

const IS_PRODUCTION = process.env.NODE_ENV === "production";

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

// ─── Status config ───────────────────────────────────────────
const STATUS_COLORS: Record<string, string> = {
  PAYMENT_PENDING: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  CREATED: "bg-slate-500/20 text-slate-400 border-slate-500/30",
  QUOTED: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  AUTHORIZED: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  SETTLEMENT_PENDING: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  SETTLED: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  PAID: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  FULFILLMENT_PENDING: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  FULFILLMENT_ACTIVE: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  IN_TRANSIT: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  LABEL_PENDING: "bg-slate-500/20 text-slate-400 border-slate-500/30",
  LABEL_CREATED: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
  OUT_FOR_DELIVERY: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  DELIVERED: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  DELIVERY_EXCEPTION: "bg-red-500/20 text-red-400 border-red-500/30",
  IN_DISPUTE: "bg-red-500/20 text-red-400 border-red-500/30",
  OPEN: "bg-red-500/20 text-red-400 border-red-500/30",
  UNDER_REVIEW: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  CLOSED: "bg-slate-500/20 text-slate-400 border-slate-500/30",
  REFUNDED: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  FAILED: "bg-red-500/20 text-red-400 border-red-500/30",
  CANCELED: "bg-slate-500/20 text-slate-400 border-slate-500/30",
};

function StatusBadge({ status }: { status: string }) {
  const color = STATUS_COLORS[status] ?? "bg-slate-500/20 text-slate-400 border-slate-500/30";
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${color}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

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
              ? "bg-emerald-500 border-emerald-500"
              : status === "active"
                ? "bg-cyan-500 border-cyan-500 animate-pulse"
                : "bg-transparent border-slate-600"
          }`}
        />
        {!isLast && (
          <div
            className={`w-0.5 flex-1 min-h-[24px] ${
              status === "done" ? "bg-emerald-500/40" : "bg-slate-700"
            }`}
          />
        )}
      </div>
      <div className="pb-4">
        <p
          className={`text-sm font-medium ${
            status === "active"
              ? "text-cyan-400"
              : status === "done"
                ? "text-slate-300"
                : "text-slate-500"
          }`}
        >
          {label}
        </p>
        {detail && <p className="text-xs text-slate-500 mt-0.5">{detail}</p>}
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
}: {
  payment: PaymentIntent | null;
  onAction: (action: string) => void;
  loading: string | null;
  isProduction: boolean;
}) {
  if (!payment) {
    return (
      <SectionCard title="Payment" icon="creditcard">
        <p className="text-sm text-slate-400">No payment intent yet.</p>
        {!isProduction ? (
          <ActionButton label="Prepare Payment" action="prepare" onClick={onAction} loading={loading} />
        ) : (
          <InlineNotice tone="info">
            Payment must be created from an approved checkout session.
          </InlineNotice>
        )}
      </SectionCard>
    );
  }

  const nextAction = getNextPaymentAction(payment.status, isProduction);

  return (
    <SectionCard title="Payment" icon="creditcard">
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm text-slate-400">Status</span>
          <StatusBadge status={payment.status} />
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm text-slate-400">Amount</span>
          <span className="text-sm font-medium text-white">
            {formatCurrency(payment.amount.amount_minor, payment.amount.currency)}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm text-slate-400">Rail</span>
          <span className="text-sm text-slate-300">{payment.selected_rail.toUpperCase()}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm text-slate-400">ID</span>
          <span className="text-xs text-slate-500 font-mono">{payment.id.slice(0, 16)}...</span>
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
        {!nextAction && getPaymentStatusMessage(payment.status, isProduction) && (
          <InlineNotice tone="info">{getPaymentStatusMessage(payment.status, isProduction)}</InlineNotice>
        )}
        {payment.status === "SETTLED" && (
          <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-3 py-2 text-sm text-emerald-400">
            Payment settled successfully
          </div>
        )}
      </div>
    </SectionCard>
  );
}

function getNextPaymentAction(status: string, isProduction: boolean): { label: string; action: string; variant?: "primary" | "danger" } | null {
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

function getPaymentStatusMessage(status: string, isProduction: boolean): string | null {
  if (!isProduction) return null;
  switch (status) {
    case "QUOTED":
      return "Complete the rail-specific checkout flow to authorize and settle payment.";
    case "AUTHORIZED":
    case "SETTLEMENT_PENDING":
      return "Waiting for provider settlement confirmation.";
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
  shippingForm,
  rates,
  onShippingFormChange,
  onPrepareRates,
  onPurchaseRate,
}: {
  shipment: Shipment | null;
  onAction: (action: string) => void;
  loading: string | null;
  isProduction: boolean;
  shippingForm: ShippingFormState;
  rates: ShippingRate[];
  onShippingFormChange: (section: "fromAddress" | "parcel", field: string, value: string) => void;
  onPrepareRates: () => void;
  onPurchaseRate: (rateId: string) => void;
}) {
  if (!shipment) {
    return (
      <SectionCard title="Shipping" icon="truck">
        <p className="text-sm text-slate-400">
          Shipment will be created automatically after payment settles.
        </p>
      </SectionCard>
    );
  }

  const nextAction = getNextShippingAction(shipment.status, isProduction);

  return (
    <SectionCard title="Shipping" icon="truck">
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm text-slate-400">Status</span>
          <StatusBadge status={shipment.status} />
        </div>
        {shipment.tracking_number && (
          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-400">Tracking</span>
            <span className="text-sm font-mono text-slate-300">{shipment.tracking_number}</span>
          </div>
        )}
        {shipment.carrier && (
          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-400">Carrier</span>
            <span className="text-sm text-slate-300">{shipment.carrier}</span>
          </div>
        )}

        {shipment.status === "LABEL_PENDING" && (
          <ShippingFulfillmentForm
            form={shippingForm}
            rates={rates}
            loading={loading}
            onChange={onShippingFormChange}
            onPrepareRates={onPrepareRates}
            onPurchaseRate={onPurchaseRate}
          />
        )}

        {/* Event timeline */}
        {shipment.events.length > 0 && (
          <div className="border-t border-slate-800 pt-3 mt-3">
            <p className="text-xs text-slate-500 uppercase tracking-wider mb-2">Events</p>
            <div className="space-y-2">
              {shipment.events.map((evt) => (
                <div key={evt.id} className="flex items-start gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-cyan-500 mt-1.5 shrink-0" />
                  <div>
                    <p className="text-xs text-slate-300">{formatShipmentEventStatus(evt)}</p>
                    <p className="text-xs text-slate-500">{formatTime(evt.occurred_at)}</p>
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
          <InlineNotice tone="info">{getShippingStatusMessage(shipment.status, isProduction)}</InlineNotice>
        )}

        {shipment.status === "DELIVERED" && (
          <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-3 py-2 text-sm text-emerald-400">
            Delivered {shipment.delivered_at ? formatTime(shipment.delivered_at) : ""}
          </div>
        )}
      </div>
    </SectionCard>
  );
}

function getNextShippingAction(status: string, isProduction: boolean): { label: string; action: string } | null {
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
  return (event.canonical_status ?? event.status ?? event.event_type ?? "TRACKING_EVENT").replace(/_/g, " ");
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
    <div className="space-y-3 border-t border-slate-800 pt-3">
      <p className="text-xs text-slate-500 uppercase tracking-wider">Seller ship-from</p>
      <div className="grid grid-cols-2 gap-2">
        <TextInput value={form.fromAddress.name} placeholder="Name" onChange={(value) => onChange("fromAddress", "name", value)} />
        <TextInput value={form.fromAddress.phone} placeholder="Phone" onChange={(value) => onChange("fromAddress", "phone", value)} />
        <TextInput className="col-span-2" value={form.fromAddress.street1} placeholder="Street address" onChange={(value) => onChange("fromAddress", "street1", value)} />
        <TextInput className="col-span-2" value={form.fromAddress.street2} placeholder="Apt, suite" onChange={(value) => onChange("fromAddress", "street2", value)} />
        <TextInput value={form.fromAddress.city} placeholder="City" onChange={(value) => onChange("fromAddress", "city", value)} />
        <TextInput value={form.fromAddress.state} placeholder="State" maxLength={2} onChange={(value) => onChange("fromAddress", "state", value.toUpperCase())} />
        <TextInput value={form.fromAddress.zip} placeholder="ZIP" maxLength={5} onChange={(value) => onChange("fromAddress", "zip", value)} />
        <TextInput value={form.fromAddress.country} placeholder="Country" onChange={(value) => onChange("fromAddress", "country", value.toUpperCase())} />
      </div>

      <p className="text-xs text-slate-500 uppercase tracking-wider">Parcel</p>
      <div className="grid grid-cols-4 gap-2">
        <TextInput value={form.parcel.length_in} placeholder="L in" inputMode="decimal" onChange={(value) => onChange("parcel", "length_in", value)} />
        <TextInput value={form.parcel.width_in} placeholder="W in" inputMode="decimal" onChange={(value) => onChange("parcel", "width_in", value)} />
        <TextInput value={form.parcel.height_in} placeholder="H in" inputMode="decimal" onChange={(value) => onChange("parcel", "height_in", value)} />
        <TextInput value={form.parcel.weight_oz} placeholder="Oz" inputMode="decimal" onChange={(value) => onChange("parcel", "weight_oz", value)} />
      </div>

      <ActionButton label="Get Carrier Rates" action="prepare-shipping" onClick={onPrepareRates} loading={loading} />

      {rates.length > 0 && (
        <div className="space-y-2">
          {rates.map((rate) => {
            const rateId = rate.id ?? `${rate.carrier}-${rate.service}`;
            return (
              <button
                key={rateId}
                onClick={() => onPurchaseRate(rateId)}
                disabled={!!loading || !rate.id}
                className="w-full rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-left text-sm transition-colors hover:border-cyan-500/50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <span className="flex items-center justify-between gap-3">
                  <span className="text-slate-200">{rate.carrier} {rate.service}</span>
                  <span className="font-semibold text-white">{formatCurrency(rate.rate_minor)}</span>
                </span>
                <span className="mt-0.5 block text-xs text-slate-500">
                  {rate.est_delivery_days ? `${rate.est_delivery_days} business days` : "Delivery estimate unavailable"}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
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
            <span className="text-sm text-slate-400">Status</span>
            <StatusBadge status={dispute.status} />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-400">Reason</span>
            <span className="text-sm text-slate-300">{dispute.reason_code.replace(/_/g, " ")}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-400">Opened by</span>
            <span className="text-sm text-slate-300 capitalize">{dispute.opened_by}</span>
          </div>
          {dispute.evidence.length > 0 && (
            <div className="border-t border-slate-800 pt-3">
              <p className="text-xs text-slate-500 uppercase tracking-wider mb-2">Evidence ({dispute.evidence.length})</p>
              {dispute.evidence.map((e, i) => (
                <div key={i} className="text-xs text-slate-400 mb-1">
                  [{e.submitted_by}] {e.text ?? e.type}
                </div>
              ))}
            </div>
          )}
          <Link
            href={`/disputes/${dispute.id}`}
            className="block text-center text-sm text-cyan-400 hover:text-cyan-300 transition-colors pt-1"
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
      <p className="text-sm text-slate-400 mb-3">No dispute for this order.</p>
      <Link
        href={`/disputes/new?orderId=${orderId}`}
        className="block w-full text-center rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm font-medium text-red-400 hover:bg-red-500/20 transition-colors"
      >
        Report an Issue
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
          <p className="font-medium text-white">{buyerAddress.name}</p>
          <p className="text-slate-400">{buyerAddress.street1}</p>
          {buyerAddress.street2 && <p className="text-slate-400">{buyerAddress.street2}</p>}
          <p className="text-slate-400">
            {buyerAddress.city}, {buyerAddress.state} {buyerAddress.zip}
          </p>
          {buyerAddress.phone && <p className="text-slate-500">{buyerAddress.phone}</p>}
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
          <TextInput value={form.name} placeholder="Name" onChange={(value) => onChange("name", value)} />
          <TextInput value={form.phone} placeholder="Phone" onChange={(value) => onChange("phone", value)} />
          <TextInput className="col-span-2" value={form.street1} placeholder="Street address" onChange={(value) => onChange("street1", value)} />
          <TextInput className="col-span-2" value={form.street2} placeholder="Apt, suite" onChange={(value) => onChange("street2", value)} />
          <TextInput value={form.city} placeholder="City" onChange={(value) => onChange("city", value)} />
          <TextInput value={form.state} placeholder="State" maxLength={2} onChange={(value) => onChange("state", value.toUpperCase())} />
          <TextInput value={form.zip} placeholder="ZIP" maxLength={5} onChange={(value) => onChange("zip", value)} />
          <TextInput value={form.country} placeholder="Country" onChange={(value) => onChange("country", value.toUpperCase())} />
          <TextInput className="col-span-2" value={form.email} placeholder="Email" onChange={(value) => onChange("email", value)} />
        </div>
        <ActionButton label="Save Delivery Address" action="save-buyer-address" onClick={onSave} loading={loading} />
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
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
        <line x1="1" y1="10" x2="23" y2="10" />
      </svg>
    ),
    truck: (
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="1" y="3" width="15" height="13" />
        <polygon points="16 8 20 8 23 11 23 16 16 16 16 8" />
        <circle cx="5.5" cy="18.5" r="2.5" />
        <circle cx="18.5" cy="18.5" r="2.5" />
      </svg>
    ),
    shield: (
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      </svg>
    ),
    location: (
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 10c0 7-9 12-9 12S3 17 3 10a9 9 0 0 1 18 0z" />
        <circle cx="12" cy="10" r="3" />
      </svg>
    ),
  };

  return (
    <div className="rounded-xl border border-slate-800 bg-bg-card/50 overflow-hidden">
      <div className="flex items-center gap-2 px-5 py-3 border-b border-slate-800">
        <span className="text-slate-400">{icons[icon]}</span>
        <h2 className="text-sm font-semibold text-white">{title}</h2>
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
  const base = "w-full rounded-lg px-3 py-2.5 text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed";
  const styles =
    variant === "danger"
      ? "border border-red-500/30 bg-red-500/10 text-red-400 hover:bg-red-500/20"
      : "bg-cyan-500 text-white hover:bg-cyan-600";

  return (
    <button
      onClick={() => onClick(action)}
      disabled={!!loading}
      className={`${base} ${styles}`}
    >
      {isLoading ? `${label}...` : label}
    </button>
  );
}

function InlineNotice({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: "info" | "warning";
}) {
  const styles =
    tone === "warning"
      ? "border-amber-500/20 bg-amber-500/10 text-amber-300"
      : "border-cyan-500/20 bg-cyan-500/10 text-cyan-300";
  return (
    <div className={`rounded-lg border px-3 py-2 text-sm ${styles}`}>
      {children}
    </div>
  );
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
      className={`min-w-0 rounded-md border border-slate-700 bg-slate-950 px-2.5 py-2 text-sm text-white placeholder:text-slate-600 focus:border-cyan-500 focus:outline-none ${className}`}
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

function ActivityLog({ entries }: { entries: LogEntry[] }) {
  if (entries.length === 0) return null;
  return (
    <div className="rounded-xl border border-slate-800 bg-bg-card/50 overflow-hidden">
      <div className="flex items-center gap-2 px-5 py-3 border-b border-slate-800">
        <span className="text-slate-400">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
          </svg>
        </span>
        <h2 className="text-sm font-semibold text-white">Activity Log</h2>
      </div>
      <div className="p-5 max-h-64 overflow-y-auto space-y-2">
        {entries.map((entry, i) => (
          <div key={i} className="flex items-start gap-2 text-xs">
            <span
              className={`mt-0.5 shrink-0 w-1.5 h-1.5 rounded-full ${
                entry.status === "success"
                  ? "bg-emerald-500"
                  : entry.status === "error"
                    ? "bg-red-500"
                    : "bg-slate-500"
              }`}
            />
            <div className="flex-1 min-w-0">
              <span className="text-slate-500">{entry.time}</span>{" "}
              <span className="text-slate-300 font-medium">{entry.action}</span>
              <span className="text-slate-500"> {entry.detail}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────
export default function OrderDetailPage() {
  const params = useParams();
  const router = useRouter();
  const orderId = params.id as string;

  const [state, setState] = useState<OrderState>({
    order: null,
    payment: null,
    shipment: null,
    dispute: null,
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
    const data = await api.get<Record<string, OrderAddress>>(`/orders/${orderId}/addresses`).catch(() => null);
    setOrderAddresses(data ?? {});
  }, [orderId]);

  const loadOrder = useCallback(async () => {
    try {
      const data = await api.get<{
        order: OrderState["order"];
        payment: PaymentIntent | null;
        shipment: Shipment | null;
        dispute: Dispute | null;
      }>(`/demo/e2e/order/${orderId}`);

      setState({
        order: data.order,
        payment: data.payment,
        shipment: data.shipment,
        dispute: data.dispute,
      });
    } catch {
      // Fallback: try individual endpoints
      try {
        const orderData = await api.get<{ order: OrderState["order"] }>(`/commerce/orders/${orderId}`).catch(() => null);
        const paymentData = await api.get<{ payment: PaymentIntent }>(`/payments/by-order/${orderId}`).catch(() => null);
        const shipmentData = await api.get<{ shipment: Shipment }>(`/shipments/by-order/${orderId}`).catch(() => null);
        const disputeData = await api.get<{ dispute: Dispute }>(`/disputes/by-order/${orderId}`).catch(() => null);
        setState({
          order: orderData?.order ?? null,
          payment: paymentData?.payment ?? null,
          shipment: shipmentData?.shipment ?? null,
          dispute: disputeData?.dispute ?? null,
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
    supabase.auth.getUser().then(({ data }) => {
      setCurrentUserId(data.user?.id ?? null);
    }).catch(() => setCurrentUserId(null));
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
                responsiveness: { median_response_minutes: 30, p95_response_minutes: 120, reliable_fast_responder: true },
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
          });
          setState((s) => ({ ...s, payment: result.intent }));
          addLog("Payment", `Intent created: ${result.intent.id.slice(0, 16)}...`, "success");
          break;
        }
        case "quote": {
          addLog("Payment", "Getting quote...", "info");
          const result = await api.post<{ intent: PaymentIntent }>(`/payments/${state.payment!.id}/quote`);
          setState((s) => ({ ...s, payment: result.intent }));
          addLog("Payment", "Quote received", "success");
          break;
        }
        case "authorize": {
          addLog("Payment", "Authorizing...", "info");
          const result = await api.post<{ intent: PaymentIntent }>(`/payments/${state.payment!.id}/authorize`);
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
            addLog("Shipping", `Shipment auto-created: ${result.shipment.id.slice(0, 16)}...`, "success");
          }
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
        case "label": {
          addLog("Shipping", "Creating label...", "info");
          const result = await api.post<{ shipment: Shipment }>(`/shipments/${state.shipment.id}/label`);
          setState((s) => ({ ...s, shipment: result.shipment }));
          addLog("Shipping", "Label created", "success");
          await loadOrder();
          break;
        }
        case "ship": {
          addLog("Shipping", "Recording ship event...", "info");
          const result = await api.post<{ shipment: Shipment }>(`/shipments/${state.shipment.id}/event`, {
            event_type: "ship",
            payload: { message: "Package picked up by carrier" },
          });
          setState((s) => ({ ...s, shipment: result.shipment }));
          addLog("Shipping", "Marked as shipped (IN_TRANSIT)", "success");
          await loadOrder();
          break;
        }
        case "deliver": {
          addLog("Shipping", "Recording delivery...", "info");
          const result = await api.post<{ shipment: Shipment }>(`/shipments/${state.shipment.id}/event`, {
            event_type: "deliver",
            payload: { message: "Package delivered to recipient" },
          });
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

  function handleShippingFormChange(section: "fromAddress" | "parcel", field: string, value: string) {
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

  async function handlePurchaseRate(rateId: string) {
    if (!state.shipment) return;
    setLoading(`purchase-${rateId}`);
    try {
      addLog("Shipping", "Purchasing selected label...", "info");
      const result = await api.post<{ shipment: Shipment; label_url?: string; tracking_number?: string }>(
        `/shipments/${state.shipment.id}/purchase-label`,
        { rate_id: rateId },
      );
      setState((s) => ({ ...s, shipment: result.shipment }));
      setShippingRates([]);
      addLog("Shipping", `Label purchased${result.tracking_number ? `: ${result.tracking_number}` : ""}`, "success");
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
    setLoading("return-label");
    try {
      addLog("Shipping", "Creating return label...", "info");
      const result = await api.post<{ shipment: Shipment; tracking_number?: string | null }>(
        `/shipments/${state.shipment.id}/return-label`,
      );
      addLog("Shipping", `Return label created${result.tracking_number ? `: ${result.tracking_number}` : ""}`, "success");
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
        status: shipped || shipmentStatus === "LABEL_CREATED"
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
        status: disputeStatus === "CLOSED" || disputeStatus === "PARTIAL_REFUND" || disputeStatus?.startsWith("RESOLVED") ? "done" : "active",
        detail: disputeStatus?.replace(/_/g, " "),
      });
    }

    return steps;
  }

  // ─── Render ─────────────────────────────────────────────────
  if (initialLoading) {
    return (
      <main className="min-h-[calc(100vh-4rem)] flex items-center justify-center">
        <div className="text-slate-400 text-sm animate-pulse">Loading order...</div>
      </main>
    );
  }

  const timelineSteps = getTimelineSteps();

  return (
    <main className="min-h-[calc(100vh-4rem)] px-4 py-6 sm:p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <Link
            href="/buy/dashboard"
            className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-white transition-colors mb-3"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            Back
          </Link>
          <h1 className="text-xl font-bold text-white">Order Details</h1>
          <p className="text-sm text-slate-400 font-mono mt-0.5">{orderId}</p>
        </div>
        {state.order && (
          <div className="text-right">
            <p className="text-lg font-bold text-white">
              {formatCurrency(state.order.amountMinor, state.order.currency)}
            </p>
            <StatusBadge status={state.order.status} />
          </div>
        )}
      </div>

      {/* Timeline */}
      <div className="rounded-xl border border-slate-800 bg-bg-card/50 p-5 mb-6">
        <h2 className="text-sm font-semibold text-white mb-4">Progress</h2>
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
        <PaymentSection payment={state.payment} onAction={handlePaymentAction} loading={loading} isProduction={IS_PRODUCTION} />
        <ShippingSection
          shipment={state.shipment}
          onAction={handleShippingAction}
          loading={loading}
          isProduction={IS_PRODUCTION}
          shippingForm={shippingForm}
          rates={shippingRates}
          onShippingFormChange={handleShippingFormChange}
          onPrepareRates={handlePrepareShippingRates}
          onPurchaseRate={handlePurchaseRate}
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
          onClick={() => loadOrder()}
          className="text-sm text-slate-500 hover:text-slate-300 transition-colors"
        >
          Refresh data
        </button>
      </div>
    </main>
  );
}
