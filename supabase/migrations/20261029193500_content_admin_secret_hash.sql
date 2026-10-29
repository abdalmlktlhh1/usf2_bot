CREATE TABLE IF NOT EXISTS public.internal_service_secret_hashes (
  secret_name text PRIMARY KEY,
  secret_sha256 text NOT NULL CHECK (length(secret_sha256) = 64),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.internal_service_secret_hashes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.internal_service_secret_hashes FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.internal_service_secret_hashes TO service_role;
INSERT INTO public.internal_service_secret_hashes (secret_name, secret_sha256, updated_at)
VALUES ('content-admin', '8ef9610a5a0b4a7fbb3ff23b808f5e4f86d191a5c3ed3f50cfa93fef61f4b396', now())
ON CONFLICT (secret_name) DO UPDATE
SET secret_sha256 = EXCLUDED.secret_sha256, updated_at = now();
