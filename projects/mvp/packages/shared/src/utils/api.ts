import type { ApiResponse } from "../types/api.js";

export function createApiResponse<T>(data: T): ApiResponse<T> {
  return { success: true, data };
}

export function createApiError(
  code: string,
  message: string,
  details?: unknown,
): ApiResponse<never> {
  return { success: false, error: { code, message, details } };
}
