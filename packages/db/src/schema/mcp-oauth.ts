import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const MCP_OAUTH_SCOPES = [
  "agents",
  "listings",
  "negotiate",
  "orders",
  "disputes",
  "offline_access",
] as const;

export type McpOauthScope = (typeof MCP_OAUTH_SCOPES)[number];

export const mcpOauthClients = pgTable(
  "mcp_oauth_clients",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clientId: text("client_id").notNull(),
    clientSecretHash: text("client_secret_hash"),
    clientName: text("client_name").notNull(),
    redirectUris: text("redirect_uris").array().notNull(),
    tokenEndpointAuthMethod: text("token_endpoint_auth_method").notNull().default("none"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("mcp_oauth_clients_client_id_uidx").on(table.clientId),
    check(
      "mcp_oauth_clients_secret_hash_ck",
      sql`${table.clientSecretHash} IS NULL OR ${table.clientSecretHash} ~ '^[0-9a-f]{64}$'`,
    ),
  ],
);

export const mcpOauthAuthorizationCodes = pgTable(
  "mcp_oauth_authorization_codes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    codeHash: text("code_hash").notNull(),
    clientId: text("client_id").notNull(),
    userId: uuid("user_id").notNull(),
    redirectUri: text("redirect_uri").notNull(),
    codeChallenge: text("code_challenge").notNull(),
    codeChallengeMethod: text("code_challenge_method").notNull().default("S256"),
    scopes: text("scopes").array().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("mcp_oauth_codes_hash_uidx").on(table.codeHash),
    index("mcp_oauth_codes_expiry_idx").on(table.expiresAt),
    check("mcp_oauth_codes_hash_ck", sql`${table.codeHash} ~ '^[0-9a-f]{64}$'`),
    check("mcp_oauth_codes_challenge_method_ck", sql`${table.codeChallengeMethod} = 'S256'`),
  ],
);

export const mcpOauthAccessTokens = pgTable(
  "mcp_oauth_access_tokens",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tokenHash: text("token_hash").notNull(),
    refreshTokenHash: text("refresh_token_hash"),
    clientId: text("client_id").notNull(),
    userId: uuid("user_id").notNull(),
    scopes: text("scopes").array().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    refreshExpiresAt: timestamp("refresh_expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("mcp_oauth_tokens_hash_uidx").on(table.tokenHash),
    uniqueIndex("mcp_oauth_tokens_refresh_hash_uidx").on(table.refreshTokenHash),
    index("mcp_oauth_tokens_user_idx").on(table.userId),
    check("mcp_oauth_tokens_hash_ck", sql`${table.tokenHash} ~ '^[0-9a-f]{64}$'`),
    check(
      "mcp_oauth_tokens_refresh_hash_ck",
      sql`${table.refreshTokenHash} IS NULL OR ${table.refreshTokenHash} ~ '^[0-9a-f]{64}$'`,
    ),
  ],
);
