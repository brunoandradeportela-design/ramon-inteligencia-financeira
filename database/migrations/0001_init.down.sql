BEGIN;
DROP SCHEMA IF EXISTS billing, audit, ai, documents, alerts, simulation, tax, portfolio, finance, raw, connections, consent, identity CASCADE;
DROP TYPE IF EXISTS public.lineage;
COMMIT;
