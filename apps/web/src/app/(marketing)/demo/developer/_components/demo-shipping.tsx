"use client";

import { useCallback, useState } from "react";
import { api } from "@/lib/api-client";

/* ── Types ────────────────────────────── */

type ShippingStep =
  | "awaiting_shipment"
  | "label_creating"
  | "label_created"
  | "shipping"
  | "in_transit"
  | "delivering"
  | "delivered";

interface ShipmentData {
  id: string;
  status: string;
  carrier: string | null;
  tracking_number: string | null;
  delivered_at: string | null;
  events: Array<{
    id: string;
    status: string;
    occurred_at: string;
    carrier_raw_status?: string;
  }>;
}

interface DemoShippingProps {
  orderId: string;
  shipmentId: string | null;
  onShipmentUpdate: (shipment: ShipmentData) => void;
  onComplete: () => void;
}

/* ── Helpers ──────────────────────────── */

const STEPS: { key: ShippingStep; label: string }[] = [
  { key: "awaiting_shipment", label: "배송 대기" },
  { key: "label_creating", label: "라벨 생성" },
  { key: "label_created", label: "라벨 완료" },
  { key: "shipping", label: "발송 중" },
  { key: "in_transit", label: "배송 중" },
  { key: "delivering", label: "배달 중" },
  { key: "delivered", label: "배달 완료" },
];

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/* ── Component ────────────────────────── */

export function DemoShipping({ shipmentId, onShipmentUpdate, onComplete }: DemoShippingProps) {
  const [step, setStep] = useState<ShippingStep>(
    shipmentId ? "awaiting_shipment" : "awaiting_shipment",
  );
  const [shipment, setShipment] = useState<ShipmentData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentStepIdx = STEPS.findIndex((s) => s.key === step);

  const callApi = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | null> => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await fn();
      return result;
    } catch (err) {
      setError(err instanceof Error ? err.message : "API 호출 실패");
      return null;
    } finally {
      setIsLoading(false);
    }
  }, []);

  async function handleCreateLabel() {
    if (!shipmentId) return;
    setStep("label_creating");
    const result = await callApi(async () => {
      const res = await api.post<{ shipment: ShipmentData }>(`/shipments/${shipmentId}/label`);
      return res;
    });
    if (result) {
      setShipment(result.shipment);
      onShipmentUpdate(result.shipment);
      setStep("label_created");
    } else {
      setStep("awaiting_shipment");
    }
  }

  async function handleShip() {
    if (!shipmentId) return;
    setStep("shipping");
    const result = await callApi(async () => {
      const res = await api.post<{ shipment: ShipmentData }>(`/shipments/${shipmentId}/event`, {
        event_type: "ship",
        payload: { message: "Package picked up by carrier" },
      });
      return res;
    });
    if (result) {
      setShipment(result.shipment);
      onShipmentUpdate(result.shipment);
      setStep("in_transit");
    } else {
      setStep("label_created");
    }
  }

  async function handleDeliver() {
    if (!shipmentId) return;
    setStep("delivering");
    const result = await callApi(async () => {
      const res = await api.post<{ shipment: ShipmentData }>(`/shipments/${shipmentId}/event`, {
        event_type: "deliver",
        payload: { message: "Package delivered to recipient" },
      });
      return res;
    });
    if (result) {
      setShipment(result.shipment);
      onShipmentUpdate(result.shipment);
      setStep("delivered");
    } else {
      setStep("in_transit");
    }
  }

  return (
    <div
      className="rounded-xl border border-line bg-surface-raised overflow-hidden"
      style={{ animation: "fadeInUp 0.4s ease-out" }}
    >
      {/* Header */}
      <div className="border-b border-line px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-info-soft border border-info/30">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-info"
              aria-hidden="true"
            >
              <rect x="1" y="3" width="15" height="13" />
              <polygon points="16 8 20 8 23 11 23 16 16 16 16 8" />
              <circle cx="5.5" cy="18.5" r="2.5" />
              <circle cx="18.5" cy="18.5" r="2.5" />
            </svg>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-ink">배송 (Demo)</h3>
            <p className="text-[11px] text-ink-muted">
              Mock carrier로 배송 라이프사이클을 시뮬레이션합니다
            </p>
          </div>
        </div>
      </div>

      {/* Step Indicator */}
      <div className="px-5 pt-4 pb-2">
        <div className="flex items-center gap-1 overflow-x-auto">
          {STEPS.filter((_, i) => i % 2 === 0 || i === STEPS.length - 1).map((s, i, arr) => {
            const realIdx = STEPS.findIndex((x) => x.key === s.key);
            return (
              <div key={s.key} className="flex items-center">
                <div className="flex flex-col items-center">
                  <div
                    className={`flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-bold transition-all duration-300 ${
                      realIdx < currentStepIdx
                        ? "bg-success text-on-accent"
                        : realIdx === currentStepIdx
                          ? "bg-action-primary text-on-accent ring-2 ring-action-primary/30"
                          : "bg-surface-sunken text-ink-muted"
                    }`}
                  >
                    {realIdx < currentStepIdx ? (
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="3"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    ) : (
                      i + 1
                    )}
                  </div>
                  <span
                    className={`mt-1 text-[8px] whitespace-nowrap ${
                      realIdx === currentStepIdx ? "text-action-primary" : "text-ink-muted"
                    }`}
                  >
                    {s.label}
                  </span>
                </div>
                {i < arr.length - 1 && (
                  <div
                    className={`mx-1 h-px w-6 sm:w-8 transition-colors duration-300 ${
                      realIdx < currentStepIdx ? "bg-success" : "bg-surface-sunken"
                    }`}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Content */}
      <div className="px-5 pb-5 pt-2">
        {error && (
          <div className="rounded-lg border border-error/30 bg-error-soft px-3 py-2 mb-3 text-xs text-error">
            {error}
          </div>
        )}

        {/* Awaiting Shipment */}
        {step === "awaiting_shipment" && (
          <div className="space-y-4" style={{ animation: "fadeInUp 0.3s ease-out" }}>
            <div className="rounded-lg bg-surface-sunken border border-line p-4">
              <p className="text-xs text-ink-secondary mb-2">
                결제가 완료되어 배송 레코드가 자동 생성되었습니다.
              </p>
              <div className="space-y-1.5 text-xs">
                <div className="flex justify-between">
                  <span className="text-ink-muted">Shipment ID</span>
                  <span className="font-mono text-ink-secondary">
                    {shipmentId?.slice(0, 12)}...
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-ink-muted">Carrier</span>
                  <span className="text-ink-secondary">Mock (USPS Ground)</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-ink-muted">상태</span>
                  <span className="text-warning">LABEL_PENDING</span>
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={handleCreateLabel}
              disabled={isLoading}
              className="w-full rounded-lg bg-action-primary px-4 py-2.5 text-sm font-medium text-on-accent hover:bg-action-primary-hover transition-colors disabled:opacity-50 cursor-pointer"
            >
              {isLoading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  라벨 생성 중...
                </span>
              ) : (
                "배송 라벨 생성"
              )}
            </button>
            <p className="text-[10px] text-ink-muted text-center">
              POST /shipments/:id/label &rarr; Mock carrier가 라벨을 발행합니다
            </p>
          </div>
        )}

        {/* Label Created */}
        {step === "label_created" && (
          <div className="space-y-4" style={{ animation: "fadeInUp 0.3s ease-out" }}>
            <div className="rounded-lg bg-surface-sunken border border-success/20 p-4 space-y-2">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-success" />
                <span className="text-xs font-medium text-success">라벨 생성됨</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-ink-muted">Tracking #</span>
                <span className="font-mono text-action-primary">
                  {shipment?.tracking_number ?? "MOCK-TRK-001"}
                </span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-ink-muted">Carrier</span>
                <span className="text-ink-secondary">{shipment?.carrier ?? "USPS"}</span>
              </div>
            </div>
            <button
              type="button"
              onClick={handleShip}
              disabled={isLoading}
              className="w-full rounded-lg bg-action-primary px-4 py-2.5 text-sm font-medium text-on-accent hover:bg-action-primary-hover transition-colors disabled:opacity-50 cursor-pointer"
            >
              {isLoading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  발송 처리 중...
                </span>
              ) : (
                "발송 처리 (Mark Shipped)"
              )}
            </button>
            <p className="text-[10px] text-ink-muted text-center">
              POST /shipments/:id/event &rarr; event_type: &quot;ship&quot;
            </p>
          </div>
        )}

        {/* In Transit */}
        {step === "in_transit" && (
          <div className="space-y-4" style={{ animation: "fadeInUp 0.3s ease-out" }}>
            <div className="rounded-lg bg-surface-sunken border border-info/20 p-4 space-y-2">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-info animate-pulse" />
                <span className="text-xs font-medium text-info">배송 중</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-ink-muted">Tracking #</span>
                <span className="font-mono text-action-primary">
                  {shipment?.tracking_number ?? "MOCK-TRK-001"}
                </span>
              </div>

              {/* Event log */}
              {shipment?.events && shipment.events.length > 0 && (
                <div className="border-t border-line pt-2 mt-2 space-y-1.5">
                  {shipment.events.map((e) => (
                    <div key={e.id} className="flex items-center gap-2 text-[11px]">
                      <span className="w-1.5 h-1.5 rounded-full bg-ink-muted" />
                      <span className="text-ink-secondary">{e.status}</span>
                      <span className="text-ink-muted">{fmtTime(e.occurred_at)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={handleDeliver}
              disabled={isLoading}
              className="w-full rounded-lg bg-success px-4 py-2.5 text-sm font-medium text-on-accent hover:bg-success transition-colors disabled:opacity-50 cursor-pointer"
            >
              {isLoading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  배달 확인 중...
                </span>
              ) : (
                "배달 완료 확인"
              )}
            </button>
            <p className="text-[10px] text-ink-muted text-center">
              POST /shipments/:id/event &rarr; event_type: &quot;deliver&quot;
            </p>
          </div>
        )}

        {/* Delivered */}
        {step === "delivered" && (
          <div
            className="py-6 text-center space-y-4"
            style={{ animation: "fadeInUp 0.4s ease-out" }}
          >
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-success-soft border-2 border-success/30">
              <svg
                width="32"
                height="32"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-success"
                aria-hidden="true"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <div>
              <p className="text-lg font-bold text-ink">배달 완료!</p>
              <p className="text-sm text-ink-secondary mt-1">구매자 리뷰 기간(3일)이 시작됩니다</p>
            </div>

            {/* Event summary */}
            {shipment?.events && shipment.events.length > 0 && (
              <div className="rounded-lg bg-surface-sunken border border-line p-4 text-left max-w-sm mx-auto space-y-1.5">
                <p className="text-xs font-semibold text-ink-secondary mb-2">배송 이벤트 로그</p>
                {shipment.events.map((e) => (
                  <div key={e.id} className="flex items-center gap-2 text-[11px]">
                    <span className="w-1.5 h-1.5 rounded-full bg-success" />
                    <span className="text-ink-secondary">{e.status}</span>
                    <span className="text-ink-muted">{fmtTime(e.occurred_at)}</span>
                  </div>
                ))}
              </div>
            )}

            <div className="pt-2 space-y-2">
              <p className="text-[11px] text-ink-muted">
                3일 내 문제가 없으면 판매자에게 자동 정산됩니다
              </p>
              <button
                type="button"
                onClick={onComplete}
                className="rounded-lg bg-error-soft border border-error/30 px-6 py-2.5 text-sm font-medium text-error hover:bg-error-soft transition-colors cursor-pointer"
              >
                문제 신고하기 (분쟁 열기)
              </button>
            </div>
          </div>
        )}

        {/* Loading overlay for label_creating / shipping / delivering */}
        {(step === "label_creating" || step === "shipping" || step === "delivering") && (
          <div
            className="py-8 text-center space-y-4"
            style={{ animation: "fadeInUp 0.3s ease-out" }}
          >
            <div className="relative mx-auto w-12 h-12">
              <div className="absolute inset-0 rounded-full border-2 border-line" />
              <div className="absolute inset-0 rounded-full border-2 border-t-info animate-spin" />
            </div>
            <p className="text-sm text-ink-secondary">
              {step === "label_creating" && "배송 라벨 생성 중..."}
              {step === "shipping" && "발송 처리 중..."}
              {step === "delivering" && "배달 확인 중..."}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
