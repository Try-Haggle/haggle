-- Similar Listings Recommendation: Slice A - DB Setup
-- 실행 전 pgvector 확장이 활성화되어 있어야 함 (CREATE EXTENSION IF NOT EXISTS vector)

-- 1. listing_embeddings: 리스팅별 embedding 벡터 저장
CREATE TABLE "listing_embeddings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "published_listing_id" uuid NOT NULL REFERENCES "listings_published"("id") ON DELETE CASCADE,
  "text_embedding" vector(1536),
  "image_embedding" vector(512),
  "text_hash" text,
  "image_hash" text,
  "model_version" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "retry_count" integer DEFAULT 0 NOT NULL,
  "failed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "listing_embeddings_published_listing_id_unique" UNIQUE("published_listing_id")
);

-- HNSW indexes for fast ANN search
CREATE INDEX "idx_listing_embeddings_text" ON "listing_embeddings"
  USING hnsw ("text_embedding" vector_cosine_ops)
  WITH (m = 16, ef_construction = 200);

CREATE INDEX "idx_listing_embeddings_image" ON "listing_embeddings"
  USING hnsw ("image_embedding" vector_cosine_ops)
  WITH (m = 16, ef_construction = 200);

-- Retry target lookup index
CREATE INDEX "idx_listing_embeddings_retry" ON "listing_embeddings"("status", "retry_count")
  WHERE "status" = 'failed';

-- 2. tag_idf_cache: 태그 IDF 가중치 캐시
CREATE TABLE "tag_idf_cache" (
  "tag" text PRIMARY KEY NOT NULL,
  "doc_count" integer NOT NULL,
  "idf_score" numeric(8, 4) NOT NULL,
  "total_docs" integer NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- 3. buyer_interest_vectors: 유저별 관심사 벡터 캐시
CREATE TABLE "buyer_interest_vectors" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL UNIQUE,
  "interest_vector" vector(1536) NOT NULL,
  "based_on_count" integer NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- 4. recommendation_logs: 추천 노출/클릭 기록
CREATE TABLE "recommendation_logs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid,
  "context" text NOT NULL,
  "source_type" text NOT NULL,
  "source_listing_id" uuid,
  "recommended_listing_id" uuid NOT NULL,
  "position" integer NOT NULL,
  "composite_score" numeric(6, 4) NOT NULL,
  "signal_scores" jsonb NOT NULL,
  "clicked" boolean DEFAULT false NOT NULL,
  "clicked_at" timestamp with time zone,
  "negotiation_started" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX "idx_recommendation_logs_user" ON "recommendation_logs"("user_id");
CREATE INDEX "idx_recommendation_logs_created" ON "recommendation_logs"("created_at");

-- 5. category_relatedness: 카테고리 간 관련도 매핑
CREATE TABLE "category_relatedness" (
  "category_from" text NOT NULL,
  "category_to" text NOT NULL,
  "score" numeric(4, 2) NOT NULL,
  PRIMARY KEY ("category_from", "category_to")
);

-- 초기 데이터: 같은 카테고리만 1.0
INSERT INTO "category_relatedness" ("category_from", "category_to", "score") VALUES
  ('electronics', 'electronics', 1.00),
  ('fashion', 'fashion', 1.00),
  ('home', 'home', 1.00),
  ('sports', 'sports', 1.00),
  ('vehicles', 'vehicles', 1.00),
  ('other', 'other', 1.00);

-- 6. buyer_listings에 view_count 컬럼 추가
ALTER TABLE "buyer_listings" ADD COLUMN "view_count" integer DEFAULT 1 NOT NULL;
