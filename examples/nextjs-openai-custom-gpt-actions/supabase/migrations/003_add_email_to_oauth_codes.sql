-- Add email column to oauth_codes table
alter table oauth_codes add column if not exists email text;

