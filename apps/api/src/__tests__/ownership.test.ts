import type { FastifyReply, FastifyRequest } from "fastify";
import { describe, expect, it, vi } from "vitest";
import { createOwnershipMiddleware } from "../middleware/ownership.js";

describe("ownership middleware", () => {
  it("loads and attaches the order resource for an admin", async () => {
    const order = {
      id: "00000000-0000-4000-a000-000000000101",
      buyerId: "00000000-0000-4000-a000-000000000102",
      sellerId: "00000000-0000-4000-a000-000000000103",
    };
    const db = {
      query: {
        commerceOrders: {
          findFirst: vi.fn().mockResolvedValue(order),
        },
      },
    } as never;
    const request = {
      user: { id: "00000000-0000-4000-a000-000000000104", role: "admin" },
      params: { orderId: order.id },
    } as unknown as FastifyRequest;
    const reply = {
      code: vi.fn().mockReturnThis(),
      send: vi.fn(),
    } as unknown as FastifyReply;

    await createOwnershipMiddleware(db).requireOrderOwner()(request, reply);

    expect((request as unknown as Record<string, unknown>).orderResource).toBe(order);
    expect(reply.code).not.toHaveBeenCalled();
  });

  it("lets payment handlers run admin guards before loading the payment", async () => {
    const request = {
      user: { id: "00000000-0000-4000-a000-000000000104", role: "admin" },
      params: { id: "00000000-0000-4000-a000-000000000105" },
    } as unknown as FastifyRequest;
    const reply = {
      code: vi.fn().mockReturnThis(),
      send: vi.fn(),
    } as unknown as FastifyReply;

    await createOwnershipMiddleware({} as never).requirePaymentOwner()(request, reply);

    expect((request as unknown as Record<string, unknown>).paymentResource).toBeUndefined();
    expect(reply.code).not.toHaveBeenCalled();
  });
});
