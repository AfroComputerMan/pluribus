-- docker/postgres/init.sql
-- Initial database setup for Pluribus

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";  -- For fuzzy text search
CREATE EXTENSION IF NOT EXISTS "pgcrypto"; -- For encryption functions

-- Grant permissions
GRANT ALL PRIVILEGES ON DATABASE pluribus TO pluribus;

-- Note: Tables are created via Drizzle migrations
-- This file is for extensions and initial setup only
