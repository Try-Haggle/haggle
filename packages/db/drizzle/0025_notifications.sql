CREATE TABLE IF NOT EXISTS "notifications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "event_type" text NOT NULL,
  "category" text NOT NULL,
  "payload" jsonb NOT NULL,
  "read_at" timestamp with time zone,
  "idempotency_key" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "notifications_category_check" CHECK (category IN ('negotiation','account','listing'))
);
CREATE INDEX IF NOT EXISTS "notifications_user_created_idx" ON "notifications"("user_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "notifications_unread_idx" ON "notifications"("user_id") WHERE read_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "notifications_user_idempotency_uniq" ON "notifications"("user_id","idempotency_key");

CREATE TABLE IF NOT EXISTS "notification_preferences" (
  "user_id" uuid NOT NULL,
  "category" text NOT NULL,
  "channel" text NOT NULL,
  "enabled" boolean NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("user_id","category","channel"),
  CONSTRAINT "notification_preferences_category_check" CHECK (category IN ('negotiation','account','listing')),
  CONSTRAINT "notification_preferences_channel_check" CHECK (channel IN ('in_app','email'))
);

CREATE TABLE IF NOT EXISTS "email_deliveries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "to_email" text NOT NULL,
  "event_type" text NOT NULL,
  "provider" text NOT NULL DEFAULT 'resend',
  "provider_message_id" text,
  "status" text NOT NULL DEFAULT 'queued',
  "error_message" text,
  "attempts" integer NOT NULL DEFAULT 0,
  "idempotency_key" text NOT NULL,
  "attempted_at" timestamp with time zone NOT NULL DEFAULT now(),
  "delivered_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "email_deliveries_provider_check" CHECK (provider IN ('resend')),
  CONSTRAINT "email_deliveries_status_check" CHECK (status IN ('queued','sent','delivered','bounced','complained','failed'))
);
CREATE INDEX IF NOT EXISTS "email_deliveries_user_created_idx" ON "email_deliveries"("user_id", "created_at" DESC);
