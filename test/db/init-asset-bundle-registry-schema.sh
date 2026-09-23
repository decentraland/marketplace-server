#!/bin/bash
set -e

# The slice of the asset-bundle-registry schema this service reads: its `profiles` table and the partial
# index the co-wear query relies on, as that service's migrations create them.
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    CREATE TABLE profiles (
        id varchar(255) PRIMARY KEY,
        pointer varchar(255) NOT NULL UNIQUE,
        timestamp bigint NOT NULL,
        content jsonb,
        metadata jsonb NOT NULL,
        local_timestamp bigint NOT NULL
    );
    CREATE INDEX idx_profiles_timestamp ON profiles (timestamp);
    CREATE INDEX idx_profiles_local_timestamp ON profiles (local_timestamp);
    CREATE INDEX idx_profiles_wearing_collections_v2 ON profiles (pointer)
      WHERE lower((metadata -> 'avatars' -> 0 -> 'avatar' -> 'wearables')::text) LIKE '%collections-v2%';
EOSQL
