-- ==============================================================================
-- SchoolBus Connect - Mark Development Environment
-- Script: scripts/mark-dev-environment.sql
--
-- PURPOSE:
-- Creates the app_security.environment marker table and inserts 'dev'.
-- This script must ONLY be executed on development databases.
-- Production databases will lack this table/row, ensuring that seed.sql
-- and destructive dev test suites CAN NEVER execute against production.
-- ==============================================================================

CREATE SCHEMA IF NOT EXISTS app_security;

CREATE TABLE IF NOT EXISTS app_security.environment (
    name text PRIMARY KEY,
    marked_at timestamptz NOT NULL DEFAULT now()
);

-- Revoke all access to the environment marker table from untrusted roles
REVOKE ALL ON TABLE app_security.environment FROM anon, authenticated, PUBLIC;

INSERT INTO app_security.environment (name)
VALUES ('dev')
ON CONFLICT (name) DO NOTHING;
