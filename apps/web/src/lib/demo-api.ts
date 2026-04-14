/**
 * Demo API client — wraps apiClient with skipAuth: true.
 * No authentication required for demo endpoints.
 */
import { api } from './api-client';
import type { DemoInitRequest, DemoInitResponse, DemoRoundResponse } from './demo-types';

const DEMO_OPTS = { skipAuth: true } as const;

export async function initDemo(params?: DemoInitRequest): Promise<DemoInitResponse> {
  return api.post<DemoInitResponse>(
    '/negotiations/demo/init',
    params ?? {},
    DEMO_OPTS,
  );
}

export async function executeRound(
  demoId: string,
  params: { seller_price: number; seller_message?: string },
): Promise<DemoRoundResponse> {
  return api.post<DemoRoundResponse>(
    `/negotiations/demo/${demoId}/round`,
    params,
    DEMO_OPTS,
  );
}

export async function getDemoState(demoId: string) {
  return api.get(`/negotiations/demo/${demoId}`, DEMO_OPTS);
}
