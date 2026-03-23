export type CommerceDomain =
  | "payment"
  | "shipping"
  | "dispute";

export interface CommerceEventEnvelope<TPayload = Record<string, unknown>> {
  id: string;
  type: string;
  version: string;
  domain: CommerceDomain;
  subject_id: string;
  occurred_at: string;
  idempotency_key: string;
  provider?: string;
  payload: TPayload;
}

export interface CommerceServiceInfo {
  service: CommerceDomain;
  version: string;
  base_url?: string;
  supports_webhooks: boolean;
  supports_pull_queries: boolean;
}
