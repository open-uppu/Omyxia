-- 0007_search_analytics/migration.sql
-- Add pg_trgm extension for fuzzy matching
-- Add SearchIndex and AnalyticsEvent tables with tsvector support

-- Enable pg_trgm extension for fuzzy matching
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Create SearchIndex table with tsvector column
CREATE TABLE IF NOT EXISTS "SearchIndex" (
    id           TEXT            NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    "tenantId"   TEXT            NOT NULL,
    "resourceType" TEXT          NOT NULL,
    "resourceId" TEXT            NOT NULL,
    title        TEXT,
    content      TSVECTOR        NOT NULL,
    metadata     JSONB           NOT NULL DEFAULT '{}'::jsonb,
    "indexedAt"  TIMESTAMP(6)    NOT NULL DEFAULT NOW(),
    "createdAt"  TIMESTAMP(6)    NOT NULL DEFAULT NOW(),
    "updatedAt"  TIMESTAMP(6)    NOT NULL DEFAULT NOW(),

    CONSTRAINT "SearchIndex_tenantId_resourceType_resourceId_key" UNIQUE ("tenantId", "resourceType", "resourceId")
);

-- Create indexes for SearchIndex
CREATE INDEX IF NOT EXISTS "SearchIndex_tenantId_idx" ON "SearchIndex" ("tenantId");
CREATE INDEX IF NOT EXISTS "SearchIndex_resourceType_idx" ON "SearchIndex" ("resourceType");
CREATE INDEX IF NOT EXISTS "SearchIndex_content_gin_idx" ON "SearchIndex" USING GIN (content);
CREATE INDEX IF NOT EXISTS "SearchIndex_title_trgm_idx" ON "SearchIndex" USING GIN (title gin_trgm_ops);

-- Create trigger function to update tsvector from title and metadata
CREATE OR REPLACE FUNCTION update_search_index_tsvector()
RETURNS TRIGGER AS $$
DECLARE
    search_text TEXT;
BEGIN
    -- Combine title and metadata JSON fields for search
    search_text := COALESCE(NEW.title, '') || ' ' ||
                   COALESCE(NEW.metadata->>'description', '') || ' ' ||
                   COALESCE(NEW.metadata->>'body', '') || ' ' ||
                   COALESCE(NEW.metadata->>'subject', '') || ' ' ||
                   COALESCE(NEW.metadata->>'name', '') || ' ' ||
                   COALESCE(NEW.metadata->>'email', '') || ' ' ||
                   COALESCE(NEW.metadata->>'company', '') || ' ' ||
                   COALESCE(NEW.metadata->>'firstName', '') || ' ' ||
                   COALESCE(NEW.metadata->>'lastName', '') || ' ' ||
                   COALESCE(NEW.metadata->>'thFirstName', '') || ' ' ||
                   COALESCE(NEW.metadata->>'thLastName', '') || ' ' ||
                   COALESCE(NEW.metadata->>'name', '') || ' ' ||
                   COALESCE(NEW.metadata->>'company', '') || ' ' ||
                   COALESCE(NEW.metadata->>'email', '');

    -- Use 'simple' config for Thai+English support (no stemming, case-insensitive)
    -- For Thai, we use 'simple' config which doesn't do stemming but is Thai-friendly
    -- For English, we could use 'english' but 'simple' works for both
    NEW.content := to_tsvector('simple', search_text);
    NEW."updatedAt" := NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to update tsvector on insert/update
DROP TRIGGER IF EXISTS trigger_update_search_index_tsvector ON "SearchIndex";
CREATE TRIGGER trigger_update_search_index_tsvector
    BEFORE INSERT OR UPDATE ON "SearchIndex"
    FOR EACH ROW EXECUTE FUNCTION update_search_index_tsvector();

-- Create trigger function to update indexedAt on update
CREATE OR REPLACE FUNCTION update_search_index_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW."updatedAt" := NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_search_index_updated_at ON "SearchIndex";
CREATE TRIGGER trigger_update_search_index_updated_at
    BEFORE UPDATE ON "SearchIndex"
    FOR EACH ROW EXECUTE FUNCTION update_search_index_updated_at();

-- Create AnalyticsEvent table
CREATE TABLE IF NOT EXISTS "AnalyticsEvent" (
    id             TEXT            NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    "tenantId"     TEXT            NOT NULL,
    "userId"       TEXT,
    "eventType"    TEXT            NOT NULL,
    "resourceType" TEXT,
    "resourceId"   TEXT,
    properties     JSONB           NOT NULL DEFAULT '{}'::jsonb,
    "occurredAt"   TIMESTAMP(6)    NOT NULL DEFAULT NOW(),
    "createdAt"    TIMESTAMP(6)    NOT NULL DEFAULT NOW()
);

-- Create indexes for AnalyticsEvent
CREATE INDEX IF NOT EXISTS "AnalyticsEvent_tenantId_idx" ON "AnalyticsEvent" ("tenantId");
CREATE INDEX IF NOT EXISTS "AnalyticsEvent_userId_idx" ON "AnalyticsEvent" ("userId");
CREATE INDEX IF NOT EXISTS "AnalyticsEvent_eventType_idx" ON "AnalyticsEvent" ("eventType");
CREATE INDEX IF NOT EXISTS "AnalyticsEvent_resourceType_idx" ON "AnalyticsEvent" ("resourceType");
CREATE INDEX IF NOT EXISTS "AnalyticsEvent_resourceType_resourceId_idx" ON "AnalyticsEvent" ("resourceType", "resourceId");
CREATE INDEX IF NOT EXISTS "AnalyticsEvent_occurredAt_idx" ON "AnalyticsEvent" ("occurredAt");
CREATE INDEX IF NOT EXISTS "AnalyticsEvent_tenantId_occurredAt_idx" ON "AnalyticsEvent" ("tenantId", "occurredAt");
CREATE INDEX IF NOT EXISTS "AnalyticsEvent_tenantId_eventType_occurredAt_idx" ON "AnalyticsEvent" ("tenantId", "eventType", "occurredAt");

-- Create indexes on Tenant model if not already present
-- (These should already exist based on the schema, but adding for completeness)
-- CREATE INDEX IF NOT EXISTS "Tenant_status_idx" ON "Tenant" ("status");