-- Supabase `seed.sql` — `supabase start` 직후 자동 실행되는 부트스트랩 SQL.
--
-- 역할:
--   - storage 버킷 RLS 정책 (config.toml의 [storage.buckets.*] 선언만으론 read만 자동 허용)
--   - 그 외 로컬에서만 필요한 부트스트랩 권한/정책
--
-- 멱등성:
--   모든 statement는 IF NOT EXISTS / ON CONFLICT / EXCEPTION 패턴으로 감싼다.
--   같은 파일이 여러 번 돌아도 깨지지 않아야 한다.

-- ─── storage.objects RLS 정책 ──────────────────────────────────
-- 버킷 자체는 config.toml [storage.buckets.*]가 만들어 두고, 여기선 행 단위 권한만.

DO $$ BEGIN
  CREATE POLICY "Public read listing-photos"
    ON storage.objects FOR SELECT
    USING (bucket_id = 'listing-photos');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Auth insert listing-photos"
    ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'listing-photos');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Auth update own listing-photos"
    ON storage.objects FOR UPDATE TO authenticated
    USING (bucket_id = 'listing-photos' AND owner = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Public read avatars"
    ON storage.objects FOR SELECT
    USING (bucket_id = 'avatars');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Auth insert avatars"
    ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'avatars');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Auth update own avatars"
    ON storage.objects FOR UPDATE TO authenticated
    USING (bucket_id = 'avatars' AND owner = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
