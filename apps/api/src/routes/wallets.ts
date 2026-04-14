import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Database } from "@haggle/db";
import { eq, and, userWallets } from "@haggle/db";
import { requireAuth } from "../middleware/require-auth.js";

const createWalletSchema = z.object({
  wallet_address: z.string().regex(/^0x[0-9a-fA-F]{40}$/, "Invalid Ethereum address"),
  network: z.enum(["base", "base-sepolia"]),
  role: z.enum(["buyer", "seller", "both"]),
  is_primary: z.boolean().optional().default(false),
});

export function registerWalletRoutes(app: FastifyInstance, db: Database) {
  // POST /wallets — create wallet entry
  app.post("/wallets", { preHandler: [requireAuth] }, async (request, reply) => {
    const parsed = createWalletSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_WALLET_REQUEST", issues: parsed.error.issues });
    }

    const userId = request.user!.id;
    const { wallet_address, network, role, is_primary } = parsed.data;

    // If is_primary, unset other primary wallets for same user+network+role combination
    if (is_primary) {
      await db
        .update(userWallets)
        .set({ isPrimary: false })
        .where(
          and(
            eq(userWallets.userId, userId),
            eq(userWallets.network, network),
            eq(userWallets.role, role),
          ),
        );
    }

    try {
      const [wallet] = await db
        .insert(userWallets)
        .values({
          userId,
          walletAddress: wallet_address,
          network,
          role,
          isPrimary: is_primary,
        })
        .onConflictDoUpdate({
          target: [userWallets.userId, userWallets.network, userWallets.role],
          set: {
            walletAddress: wallet_address,
            isPrimary: is_primary,
            updatedAt: new Date(),
          },
        })
        .returning();

      return reply.code(201).send({ wallet });
    } catch (error) {
      return reply.code(500).send({
        error: "WALLET_CREATE_FAILED",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // GET /wallets — list user's wallets
  app.get("/wallets", { preHandler: [requireAuth] }, async (request, reply) => {
    const userId = request.user!.id;

    const wallets = await db
      .select()
      .from(userWallets)
      .where(eq(userWallets.userId, userId));

    return reply.send({ wallets });
  });

  // DELETE /wallets/:id — delete wallet (only own)
  app.delete<{ Params: { id: string } }>(
    "/wallets/:id",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const userId = request.user!.id;
      const walletId = request.params.id;

      const [deleted] = await db
        .delete(userWallets)
        .where(
          and(
            eq(userWallets.id, walletId),
            eq(userWallets.userId, userId),
          ),
        )
        .returning();

      if (!deleted) {
        return reply.code(404).send({ error: "WALLET_NOT_FOUND" });
      }

      return reply.send({ deleted: true, wallet: deleted });
    },
  );
}
