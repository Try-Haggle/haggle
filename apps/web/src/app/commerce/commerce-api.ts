/**
 * Commerce API Integration Layer
 *
 * Maps commerce dashboard actions to real API calls.
 * All functions are safe to call in demo mode — callers should
 * skip the call when no real IDs exist.
 */

import { api } from "@/lib/api-client";

// ─── Response Types ─────────────────────────────────────────

export interface PaymentResponse {
  payment: {
    id: string;
    status: string;
    amount?: number;
    currency?: string;
  };
}

export interface DisputeResponse {
  dispute: {
    id: string;
    status: string;
    reason_code: string;
    opened_by: string;
  };
}

export interface ShipmentResponse {
  shipment: {
    id: string;
    status: string;
    carrier?: string;
    tracking_number?: string;
  };
}

export interface TrustScoreResponse {
  trust_score: {
    actor_id: string;
    overall_score: number;
    settlement_reliability: number;
  };
}

// ─── Payment Actions ────────────────────────────────────────

export async function preparePayment(approvalId: string): Promise<PaymentResponse> {
  return api.post<PaymentResponse>("/api/payments/prepare", {
    approval_id: approvalId,
  });
}

export async function getPaymentStatus(paymentId: string): Promise<PaymentResponse> {
  return api.get<PaymentResponse>(`/api/payments/${paymentId}`);
}

export async function quotePayment(paymentId: string): Promise<PaymentResponse> {
  return api.post<PaymentResponse>(`/api/payments/${paymentId}/quote`);
}

export async function authorizePayment(paymentId: string): Promise<PaymentResponse> {
  return api.post<PaymentResponse>(`/api/payments/${paymentId}/authorize`);
}

export async function settlePayment(paymentId: string): Promise<PaymentResponse> {
  return api.post<PaymentResponse>(`/api/payments/${paymentId}/settle`);
}

// ─── Dispute Actions ────────────────────────────────────────

export async function openDispute(
  orderId: string,
  reasonCode: string,
  description: string,
  openedBy: string,
): Promise<DisputeResponse> {
  return api.post<DisputeResponse>("/api/disputes", {
    order_id: orderId,
    reason_code: reasonCode,
    description,
    opened_by: openedBy,
  });
}

export async function getDisputeByOrder(orderId: string): Promise<DisputeResponse> {
  return api.get<DisputeResponse>(`/api/disputes/order/${orderId}`);
}

// ─── Shipment Actions ───────────────────────────────────────

export async function getShipmentByOrder(orderId: string): Promise<ShipmentResponse> {
  return api.get<ShipmentResponse>(`/api/shipments/order/${orderId}`);
}

// ─── Trust ──────────────────────────────────────────────────

export async function getTrustScore(userId: string): Promise<TrustScoreResponse> {
  return api.get<TrustScoreResponse>(`/api/trust/${userId}`);
}
