-- =============================================================================
-- Ramon Inteligência Financeira — schema PostgreSQL (produção)
-- Espelha o contrato do Store em memória usado no MVP. Schemas por domínio.
-- Rollback: 0001_init.down.sql
-- =============================================================================
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS identity;
CREATE SCHEMA IF NOT EXISTS consent;
CREATE SCHEMA IF NOT EXISTS connections;
CREATE SCHEMA IF NOT EXISTS raw;
CREATE SCHEMA IF NOT EXISTS finance;
CREATE SCHEMA IF NOT EXISTS portfolio;
CREATE SCHEMA IF NOT EXISTS tax;
CREATE SCHEMA IF NOT EXISTS simulation;
CREATE SCHEMA IF NOT EXISTS alerts;
CREATE SCHEMA IF NOT EXISTS documents;
CREATE SCHEMA IF NOT EXISTS ai;
CREATE SCHEMA IF NOT EXISTS audit;
CREATE SCHEMA IF NOT EXISTS billing;

-- ---------------------------------------------------------------- identity (PII separada)
CREATE TABLE identity.users (
  id text PRIMARY KEY, email citext UNIQUE NOT NULL, password_hash text NOT NULL,
  roles text[] NOT NULL DEFAULT '{titular}', plan text NOT NULL DEFAULT 'free',
  theme text NOT NULL DEFAULT 'system' CHECK (theme IN ('light','dark','system')),
  accepted_terms_version text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz);
CREATE TABLE identity.profiles (user_id text PRIMARY KEY REFERENCES identity.users(id) ON DELETE CASCADE,
  name text NOT NULL, phone text, data jsonb NOT NULL DEFAULT '{}');
CREATE TABLE identity.sessions (token_hash text PRIMARY KEY, user_id text NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  device text, expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now());

-- ---------------------------------------------------------------- consent
CREATE TABLE consent.consents (
  id text PRIMARY KEY, owner_id text NOT NULL REFERENCES identity.users(id),
  institution_id text NOT NULL, scope text[] NOT NULL, purpose text NOT NULL,
  status text NOT NULL CHECK (status IN ('pendente','ativo','revogado','expirado')),
  created_at timestamptz NOT NULL, expires_at timestamptz NOT NULL, confirmed_at timestamptz, revoked_at timestamptz);
CREATE TABLE consent.events (id bigserial PRIMARY KEY, consent_id text NOT NULL REFERENCES consent.consents(id),
  event text NOT NULL, at timestamptz NOT NULL DEFAULT now());

-- ---------------------------------------------------------------- connections
CREATE TABLE connections.institutions (id text PRIMARY KEY, name text NOT NULL, type text NOT NULL, participant boolean NOT NULL,
  coverage jsonb NOT NULL, last_test date, status text NOT NULL, priority text NOT NULL, matrix_version text NOT NULL);
CREATE TABLE connections.connections (
  id text PRIMARY KEY, owner_id text NOT NULL REFERENCES identity.users(id), institution_id text NOT NULL REFERENCES connections.institutions(id),
  consent_id text NOT NULL REFERENCES consent.consents(id), scope text[] NOT NULL, mode text NOT NULL,
  last_sync_at timestamptz, next_refresh_at timestamptz, error_code text, data_quality_score numeric(4,3),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE connections.sync_runs (id text PRIMARY KEY, connection_id text NOT NULL REFERENCES connections.connections(id),
  started_at timestamptz NOT NULL, finished_at timestamptz, result text NOT NULL, stats jsonb NOT NULL DEFAULT '{}', correlation_id text);

-- ---------------------------------------------------------------- raw vault (imutável)
CREATE TABLE raw.raw_payloads (
  id text PRIMARY KEY, owner_id text NOT NULL, source text NOT NULL, kind text NOT NULL,
  checksum text NOT NULL, parser_version text NOT NULL, storage_key text, body jsonb,
  received_at timestamptz NOT NULL DEFAULT now(), UNIQUE (owner_id, checksum));
CREATE RULE raw_no_update AS ON UPDATE TO raw.raw_payloads DO INSTEAD NOTHING;

-- ---------------------------------------------------------------- linhagem comum
CREATE TYPE public.lineage AS (source text, institution text, raw_id text, ingested_at timestamptz,
  competence date, verified_at timestamptz, parser_version text, reconciliation text, quality numeric);

-- ---------------------------------------------------------------- finance
CREATE TABLE finance.accounts (id text PRIMARY KEY, owner_id text NOT NULL, institution text NOT NULL, kind text NOT NULL,
  name text NOT NULL, balance numeric(18,2) NOT NULL, lineage public.lineage NOT NULL);
CREATE TABLE finance.categories (code text PRIMARY KEY, name text NOT NULL, kind text NOT NULL);
CREATE TABLE finance.transactions (id text PRIMARY KEY, owner_id text NOT NULL, account_id text NOT NULL REFERENCES finance.accounts(id),
  date date NOT NULL, description text NOT NULL, amount numeric(18,2) NOT NULL, category text NOT NULL,
  fingerprint text NOT NULL, lineage public.lineage NOT NULL, UNIQUE (owner_id, fingerprint));
CREATE INDEX ON finance.transactions (owner_id, date);

-- ---------------------------------------------------------------- portfolio
CREATE TABLE portfolio.assets (id text PRIMARY KEY, ticker text, name text NOT NULL, asset_class text NOT NULL, isin text);
CREATE TABLE portfolio.custodians (id text PRIMARY KEY, name text NOT NULL);
CREATE TABLE portfolio.trades (id text PRIMARY KEY, owner_id text NOT NULL, date date NOT NULL, ticker text NOT NULL,
  asset_class text NOT NULL, side char(1) NOT NULL CHECK (side IN ('C','V')), quantity numeric(20,6) NOT NULL CHECK (quantity > 0),
  price numeric(20,8) NOT NULL CHECK (price > 0), fees numeric(18,2) NOT NULL DEFAULT 0, daytrade boolean NOT NULL DEFAULT false,
  broker text NOT NULL, fingerprint text NOT NULL, lineage public.lineage NOT NULL, UNIQUE (owner_id, fingerprint));
CREATE TABLE portfolio.positions (id text PRIMARY KEY, owner_id text NOT NULL, asset_id text NOT NULL, custodian text NOT NULL,
  value numeric(18,2) NOT NULL, invested numeric(18,2) NOT NULL, as_of date NOT NULL, liquidity_days int NOT NULL, lineage public.lineage NOT NULL);
CREATE TABLE portfolio.events (id text PRIMARY KEY, owner_id text NOT NULL, asset_id text NOT NULL, kind text NOT NULL, date date NOT NULL, data jsonb NOT NULL);

-- ---------------------------------------------------------------- tax (regras versionadas e imutáveis)
CREATE TABLE tax.rules (code text PRIMARY KEY, title text NOT NULL, type text NOT NULL, jurisdiction text NOT NULL);
CREATE TABLE tax.rule_versions (code text NOT NULL REFERENCES tax.rules(code), version text NOT NULL,
  validity_start date NOT NULL, validity_end date, status text NOT NULL CHECK (status IN ('draft','pending','validated','deprecated')),
  parameters jsonb NOT NULL, formula text NOT NULL, exceptions jsonb NOT NULL, sources jsonb NOT NULL, tests jsonb NOT NULL,
  validated_at date, PRIMARY KEY (code, version),
  CHECK (status <> 'validated' OR (jsonb_array_length(sources) > 0 AND jsonb_array_length(tests) > 0)));
CREATE TABLE tax.events (id text PRIMARY KEY, owner_id text NOT NULL, date date NOT NULL, ticker text, modality text NOT NULL,
  kind text NOT NULL, sale_value numeric(18,2), cost_basis numeric(18,2), result numeric(18,2), rule_code text, rule_version text,
  confidence numeric(4,3) NOT NULL, status text NOT NULL, notes jsonb NOT NULL DEFAULT '[]');
CREATE TABLE tax.results (id text PRIMARY KEY, owner_id text NOT NULL, year int NOT NULL, reference_date date NOT NULL,
  snapshot_hash text NOT NULL, rule_versions jsonb NOT NULL, payload jsonb NOT NULL, kind text NOT NULL DEFAULT 'estimativa',
  created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE tax.paid_darfs (owner_id text NOT NULL, competence char(7) NOT NULL, amount numeric(18,2) NOT NULL,
  paid_at date, document_id text, PRIMARY KEY (owner_id, competence));

-- ---------------------------------------------------------------- simulation
CREATE TABLE simulation.simulations (id text PRIMARY KEY, owner_id text NOT NULL, kind text NOT NULL,
  inputs jsonb NOT NULL, results jsonb NOT NULL, premises jsonb NOT NULL, rule_versions jsonb NOT NULL,
  reproducibility_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());

-- ---------------------------------------------------------------- alerts
CREATE TABLE alerts.alerts (id text NOT NULL, owner_id text NOT NULL, code text NOT NULL, title text NOT NULL, detail text NOT NULL,
  category text NOT NULL, impact numeric, urgency numeric, relevance numeric, confidence numeric, priority numeric,
  severity text NOT NULL, status text NOT NULL DEFAULT 'novo', evidence jsonb, rule jsonb, due_date date, PRIMARY KEY (owner_id, id));
CREATE TABLE alerts.history (id bigserial PRIMARY KEY, owner_id text NOT NULL, alert_id text NOT NULL, from_status text, to_status text NOT NULL,
  at timestamptz NOT NULL DEFAULT now(), correlation_id text);

-- ---------------------------------------------------------------- documents
CREATE TABLE documents.documents (id text PRIMARY KEY, owner_id text NOT NULL, filename text NOT NULL, mime text NOT NULL,
  size bigint NOT NULL, checksum text NOT NULL, kind text NOT NULL, status text NOT NULL, storage_key text NOT NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE documents.extractions (id text PRIMARY KEY, document_id text NOT NULL REFERENCES documents.documents(id), data jsonb NOT NULL, created_at timestamptz DEFAULT now());
CREATE TABLE documents.validations (id text PRIMARY KEY, document_id text NOT NULL REFERENCES documents.documents(id), result text NOT NULL, notes text);

-- ---------------------------------------------------------------- ai (sem credenciais bancárias)
CREATE TABLE ai.threads (id text PRIMARY KEY, owner_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE ai.messages (id text PRIMARY KEY, thread_id text NOT NULL REFERENCES ai.threads(id), owner_id text NOT NULL, question text NOT NULL,
  intent text NOT NULL, guardrail text, answer text NOT NULL, confidence numeric, provider text NOT NULL, consistency_ok boolean NOT NULL,
  latency_ms int, correlation_id text, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE ai.tool_calls (id bigserial PRIMARY KEY, message_id text NOT NULL REFERENCES ai.messages(id), tool text NOT NULL, status text NOT NULL, latency_ms numeric);
CREATE TABLE ai.evidence (id bigserial PRIMARY KEY, message_id text NOT NULL REFERENCES ai.messages(id), label text, value text, source text);

-- ---------------------------------------------------------------- audit (append-only, encadeado)
CREATE TABLE audit.audit_log (id text PRIMARY KEY, seq bigint NOT NULL, owner_id text NOT NULL, at timestamptz NOT NULL,
  actor text NOT NULL, resource text NOT NULL, action text NOT NULL, before jsonb, after jsonb, origin text, reason text,
  correlation_id text, prev_hash char(64) NOT NULL, hash char(64) NOT NULL, UNIQUE (owner_id, seq));
CREATE RULE audit_no_update AS ON UPDATE TO audit.audit_log DO INSTEAD NOTHING;
CREATE RULE audit_no_delete AS ON DELETE TO audit.audit_log DO INSTEAD NOTHING;

-- ---------------------------------------------------------------- billing
CREATE TABLE billing.plans (code text PRIMARY KEY, name text NOT NULL, price_month numeric(10,2) NOT NULL, status text NOT NULL DEFAULT 'hipotese_em_teste');
CREATE TABLE billing.entitlements (plan_code text REFERENCES billing.plans(code), feature text NOT NULL, PRIMARY KEY (plan_code, feature));
CREATE TABLE billing.subscriptions (id text PRIMARY KEY, owner_id text NOT NULL, plan_code text NOT NULL REFERENCES billing.plans(code),
  status text NOT NULL, started_at timestamptz NOT NULL, ends_at timestamptz, gateway_ref text);

-- ---------------------------------------------------------------- isolamento por titular (RLS)
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT table_schema, table_name FROM information_schema.columns
           WHERE column_name = 'owner_id' AND table_schema NOT IN ('audit') LOOP
    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', t.table_schema, t.table_name);
    EXECUTE format($p$CREATE POLICY owner_isolation ON %I.%I USING (owner_id = current_setting('app.owner_id', true))$p$, t.table_schema, t.table_name);
  END LOOP;
END $$;
COMMIT;
