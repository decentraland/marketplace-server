#!/bin/bash
set -e

# Connect to the default database to create the "builder" database
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" <<-EOSQL
    CREATE DATABASE builder;
EOSQL

# Connect to the "builder" database to create the tables
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "builder" <<-EOSQL
    CREATE TABLE items (
        id uuid PRIMARY KEY,
        name text NOT NULL,
        description text,
        eth_address text NOT NULL,
        collection_id uuid,
        blockchain_item_id text,
        price text,
        beneficiary text,
        rarity text,
        type text NOT NULL,
        data json NOT NULL,
        created_at timestamp without time zone NOT NULL,
        updated_at timestamp without time zone NOT NULL,
        metrics json NOT NULL DEFAULT '{"meshes":0,"bodies":0,"materials":0,"textures":0,"triangles":0,"entities":0}'::json,
        thumbnail text NOT NULL,
        contents json NOT NULL,
        total_supply integer NOT NULL DEFAULT 0,
        urn_suffix text,
        local_content_hash text,
        video text,
        utility text,
        mappings json
    );
    CREATE TABLE collections (
        id uuid PRIMARY KEY,
        name text NOT NULL,
        eth_address text NOT NULL,
        salt text,
        contract_address text,
        is_published boolean NOT NULL DEFAULT false,
        created_at timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
        managers text[] NOT NULL DEFAULT '{}'::text[],
        minters text[] NOT NULL DEFAULT '{}'::text[],
        is_approved boolean NOT NULL DEFAULT false,
        reviewed_at timestamp without time zone,
        forum_link text,
        lock timestamp without time zone,
        urn_suffix text,
        third_party_id text,
        forum_id integer,
        linked_contract_address text,
        linked_contract_network text,
        CONSTRAINT third_party_id_urn_suffix_unique UNIQUE (third_party_id, urn_suffix)
    );
EOSQL
