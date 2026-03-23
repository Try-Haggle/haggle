export interface X402PaymentRequirement {
  x402Version: 1;
  scheme: "exact";
  network: string;
  maxAmountRequired: string;
  resource: string;
  description: string;
  mimeType?: string;
  payTo: string;
  asset: string;
  maxTimeoutSeconds?: number;
  outputSchema?: Record<string, unknown>;
  extra?: Record<string, unknown>;
}

export interface X402PaymentRequiredEnvelope {
  accepts: X402PaymentRequirement[];
}

export interface X402PaymentPayloadEnvelope {
  x402Version: 1;
  scheme: "exact";
  network: string;
  payload: Record<string, unknown>;
  paymentRequirements?: X402PaymentRequirement;
}

export interface X402FacilitatorVerifyResponse {
  isValid: boolean;
  invalidReason?: string;
  metadata?: Record<string, unknown>;
}

export interface X402FacilitatorSettleResponse {
  success: boolean;
  txHash?: string;
  network: string;
  settlementReference?: string;
  metadata?: Record<string, unknown>;
}
