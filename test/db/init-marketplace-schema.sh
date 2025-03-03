#!/bin/bash
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL    
    -- CREATE THE ROLE AND ASSIGN IT TO THE PREVIOUSLY CREATED DB
    CREATE ROLE testuser WITH LOGIN PASSWORD 'testpassword';


    SET ROLE testuser;
    CREATE SCHEMA marketplace;
    CREATE SCHEMA squid_marketplace;
    CREATE SCHEMA squid_trades;

    CREATE ROLE mv_trades_owner NOLOGIN;
    GRANT mv_trades_owner TO testuser;
    GRANT USAGE ON SCHEMA marketplace TO mv_trades_owner;
    GRANT CREATE ON SCHEMA marketplace TO mv_trades_owner;
    GRANT SELECT ON ALL TABLES IN SCHEMA marketplace TO mv_trades_owner;
    GRANT ALL PRIVILEGES ON SCHEMA squid_marketplace TO mv_trades_owner;

    -- SET UP EXTENSIONS
    CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
    CREATE EXTENSION IF NOT EXISTS "postgres_fdw";

    -- CREATE THE TRADES SQUID TABLES
    CREATE TABLE squid_trades."trade" ("id" character varying NOT NULL, "signature" text NOT NULL, "network" character varying(8) NOT NULL, "action" character varying(9) NOT NULL, "timestamp" numeric, "caller" text NOT NULL, CONSTRAINT "PK_d4097908741dc408f8274ebdc53" PRIMARY KEY ("id"));
    CREATE TABLE squid_trades."signature_index" ("id" character varying NOT NULL, "address" text NOT NULL, "network" character varying(8) NOT NULL, "index" integer NOT NULL, CONSTRAINT "PK_ffa4422e3338f8a5632922e6d4e" PRIMARY KEY ("id"));
    CREATE TABLE squid_trades."contract_status" ("id" character varying NOT NULL, "address" text NOT NULL, "network" character varying(8) NOT NULL, "paused" boolean NOT NULL, CONSTRAINT "PK_14a66107c6d68e6c40c80de1f86" PRIMARY KEY ("id"));


    -- CREATE THE MARKETPLACE SQUID TABLES
    CREATE TABLE squid_marketplace."account" (
        "id" character varying NOT NULL,
        "address" text NOT NULL,
        "sales" integer NOT NULL,
        "purchases" integer NOT NULL,
        "spent" numeric NOT NULL,
        "earned" numeric NOT NULL,
        "is_committee_member" boolean,
        "total_curations" integer,
        "primary_sales" integer NOT NULL,
        "primary_sales_earned" numeric NOT NULL,
        "royalties" numeric NOT NULL,
        "unique_and_mythic_items" text array NOT NULL,
        "unique_and_mythic_items_total" integer NOT NULL,
        "collections" integer NOT NULL,
        "creators_supported" text array NOT NULL,
        "creators_supported_total" integer NOT NULL,
        "unique_collectors" text array NOT NULL,
        "unique_collectors_total" integer NOT NULL,
        "network" character varying(8) NOT NULL,
        CONSTRAINT "PK_54115ee388cdb6d86bb4bf5b2ea" PRIMARY KEY ("id")
   );
    CREATE INDEX "IDX_83603c168bc00b20544539fbea" ON squid_marketplace."account" ("address");

    CREATE TABLE squid_marketplace."analytics_day_data" (
        "id" character varying NOT NULL,
        "date" integer NOT NULL,
        "sales" integer NOT NULL,
        "volume" numeric NOT NULL,
        "creators_earnings" numeric NOT NULL,
        "dao_earnings" numeric NOT NULL,
        "network" character varying(8) NOT NULL,
        CONSTRAINT "PK_0f692899aeae43f1c1596430ea8" PRIMARY KEY ("id")
    );

    CREATE TABLE squid_marketplace."bid" (
        "id" character varying NOT NULL,
        "bid_address" text NOT NULL,
        "category" character varying(8) NOT NULL,
        "nft_address" text NOT NULL,
        "token_id" numeric NOT NULL,
        "bidder" bytea,
        "seller" bytea,
        "price" numeric NOT NULL,
        "fingerprint" bytea,
        "status" character varying(11) NOT NULL,
        "blockchain_id" text NOT NULL,
        "block_number" numeric NOT NULL,
        "expires_at" numeric NOT NULL,
        "created_at" numeric NOT NULL,
        "updated_at" numeric NOT NULL,
        "nft_id" character varying,
        "network" character varying(8) NOT NULL,
        CONSTRAINT "PK_ed405dda320051aca2dcb1a50bb" PRIMARY KEY ("id")
    );
    CREATE INDEX "IDX_3caf2d6b31d2fe45a2b85b8191" ON squid_marketplace."bid" ("nft_id");

    CREATE TABLE squid_marketplace."collection" (
        "id" character varying NOT NULL,
        "owner" text NOT NULL,
        "creator" text NOT NULL,
        "name" text NOT NULL,
        "symbol" text NOT NULL,
        "is_completed" boolean,
        "is_approved" boolean,
        "is_editable" boolean,
        "minters" text array NOT NULL,
        "managers" text array NOT NULL,
        "urn" text NOT NULL,
        "items_count" integer NOT NULL,
        "created_at" numeric NOT NULL,
        "updated_at" numeric NOT NULL,
        "reviewed_at" numeric NOT NULL,
        "first_listed_at" numeric,
        "search_is_store_minter" boolean NOT NULL,
        "search_text" text NOT NULL,
        "base_uri" text NOT NULL,
        "chain_id" numeric NOT NULL,
        "network" character varying(8) NOT NULL,
        CONSTRAINT "PK_ad3f485bbc99d875491f44d7c85" PRIMARY KEY ("id")
    );

    CREATE TABLE squid_marketplace."count" (
        "id" character varying NOT NULL,
        "order_total" integer NOT NULL,
        "order_parcel" integer NOT NULL,
        "order_estate" integer NOT NULL,
        "order_wearable" integer NOT NULL,
        "order_ens" integer NOT NULL,
        "parcel_total" integer NOT NULL,
        "estate_total" integer NOT NULL,
        "wearable_total" integer NOT NULL,
        "ens_total" integer NOT NULL,
        "started" integer NOT NULL,
        "sales_total" integer NOT NULL,
        "sales_mana_total" numeric NOT NULL,
        "creator_earnings_mana_total" numeric NOT NULL,
        "dao_earnings_mana_total" numeric NOT NULL,
        "bid_total" integer NOT NULL,
        "collection_total" integer NOT NULL,
        "item_total" integer NOT NULL,
        "nft_total" integer NOT NULL,
        "primary_sales_total" integer NOT NULL,
        "primary_sales_mana_total" numeric NOT NULL,
        "secondary_sales_total" integer NOT NULL,
        "secondary_sales_mana_total" numeric NOT NULL,
        "royalties_mana_total" numeric NOT NULL,
        "network" character varying(8) NOT NULL,
        CONSTRAINT "PK_64d8bf139274fe6d6db3affcb93" PRIMARY KEY ("id")
    );

    CREATE TABLE squid_marketplace."curation" (
        "id" character varying NOT NULL,
        "tx_hash" bytea NOT NULL,
        "is_approved" boolean NOT NULL,
        "timestamp" numeric NOT NULL,
        "curator_id" character varying,
        "collection_id" character varying,
        "item_id" character varying,
        CONSTRAINT "PK_de0e4d1c645b4bc2e9a26b9a3f1" PRIMARY KEY ("id")
    );
    CREATE INDEX "IDX_dff9f3d4753a2a4caecf74d066" ON squid_marketplace."curation" ("curator_id");
    CREATE INDEX "IDX_2cb014ad08eee6a3c64afa42f3" ON squid_marketplace."curation" ("collection_id");
    CREATE INDEX "IDX_ddf35815bd940a989480f79fec" ON squid_marketplace."curation" ("item_id");

    CREATE TABLE squid_marketplace."data" (
        "id" character varying NOT NULL,
        "version" text NOT NULL,
        "name" text,
        "description" text,
        "ipns" text,
        "parcel_id" character varying,
        "estate_id" character varying,
        CONSTRAINT "PK_2533602bd9247937e3a4861e173" PRIMARY KEY ("id")
    );
    CREATE INDEX "IDX_8694618f20c7b364d4cb23c111" ON squid_marketplace."data" ("parcel_id");
    CREATE INDEX "IDX_ae7e5532f8406258419ed617b4" ON squid_marketplace."data" ("estate_id");

    CREATE TABLE squid_marketplace."emote" (
        "id" character varying NOT NULL,
        "name" text NOT NULL,
        "description" text NOT NULL,
        "collection" text NOT NULL,
        "category" character varying(13) NOT NULL,
        "loop" boolean NOT NULL,
        "rarity" character varying(9) NOT NULL,
        "body_shapes" character varying(10) array,
        "has_sound" boolean,
        "has_geometry" boolean,
        CONSTRAINT "PK_c08d432f6b22ef550be511163ac" PRIMARY KEY ("id")
    );

    CREATE TABLE squid_marketplace."ens" (
        "id" character varying NOT NULL,
        "token_id" numeric NOT NULL,
        "caller" text,
        "beneficiary" text,
        "label_hash" text,
        "subdomain" text,
        "created_at" numeric,
        "owner_id" character varying,
        CONSTRAINT "PK_e8bdeddbe34d96eca24aa4e221f" PRIMARY KEY ("id")
    );
    CREATE INDEX "IDX_2ebf256442a48f5acbdf2ea77d" ON squid_marketplace."ens" ("owner_id");

    CREATE TABLE squid_marketplace."estate" (
        "id" character varying NOT NULL,
        "token_id" numeric NOT NULL,
        "parcel_distances" integer array,
        "adjacent_to_road_count" integer,
        "size" integer,
        "raw_data" text,
        "owner_id" character varying,
        "data_id" character varying,
        CONSTRAINT "PK_cbb82b5600918dca1140ff8d276" PRIMARY KEY ("id")
    );
    CREATE INDEX "IDX_0b680d37990796da3232ad9d98" ON squid_marketplace."estate" ("owner_id");
    CREATE INDEX "IDX_c40a1b5f5b764ad6ab5fa749cd" ON squid_marketplace."estate" ("data_id");
    CREATE INDEX "IDX_1f3ec6150afbb8a3fd75fae814" ON squid_marketplace."estate" ("size");

    CREATE TABLE squid_marketplace."item" (
        "id" character varying NOT NULL,
        "blockchain_id" numeric NOT NULL,
        "creator" text NOT NULL,
        "item_type" character varying(17) NOT NULL,
        "total_supply" numeric NOT NULL,
        "max_supply" numeric NOT NULL,
        "rarity" text NOT NULL,
        "creation_fee" numeric NOT NULL,
        "available" numeric NOT NULL,
        "price" numeric NOT NULL,
        "beneficiary" text NOT NULL,
        "content_hash" text,
        "uri" text NOT NULL,
        "image" text,
        "minters" text array NOT NULL,
        "managers" text array NOT NULL,
        "raw_metadata" text NOT NULL,
        "urn" text NOT NULL,
        "created_at" numeric NOT NULL,
        "updated_at" numeric NOT NULL,
        "reviewed_at" numeric NOT NULL,
        "sold_at" numeric,
        "first_listed_at" numeric,
        "sales" integer NOT NULL,
        "volume" numeric NOT NULL,
        "search_text" text,
        "search_item_type" text,
        "search_is_collection_approved" boolean,
        "search_is_store_minter" boolean NOT NULL,
        "search_is_wearable_head" boolean,
        "search_is_wearable_accessory" boolean,
        "search_wearable_category" character varying(11),
        "search_wearable_rarity" text,
        "search_wearable_body_shapes" character varying(10) array,
        "search_emote_category" character varying(13),
        "search_emote_loop" boolean,
        "search_emote_rarity" text,
        "search_emote_body_shapes" character varying(10) array,
        "search_emote_has_sound" boolean,
        "search_emote_has_geometry" boolean,
        "unique_collectors" text array NOT NULL,
        "unique_collectors_total" integer NOT NULL,
        "collection_id" character varying,
        "metadata_id" character varying,
        "network" character varying(8) NOT NULL,
        CONSTRAINT "PK_d3c0c71f23e7adcf952a1d13423" PRIMARY KEY ("id")
    );
    CREATE INDEX "IDX_6d5bb320c601281cd3a213979e" ON squid_marketplace."item" ("metadata_id");
    CREATE INDEX "IDX_9ddbd0267ddb9c59621775f94e" ON squid_marketplace."item" ("collection_id", "blockchain_id");

    CREATE TABLE squid_marketplace."items_day_data" (
        "id" character varying NOT NULL,
        "date" integer NOT NULL,
        "sales" integer NOT NULL,
        "volume" numeric NOT NULL,
        "search_emote_category" character varying(13),
        "search_wearable_category" character varying(11),
        "search_rarity" text,
        CONSTRAINT "PK_8219a4b2ca0fec0de876181bb3f" PRIMARY KEY ("id")
    );

    CREATE TABLE squid_marketplace."metadata" (
        "id" character varying NOT NULL,
        "item_type" character varying(17) NOT NULL,
        "wearable_id" character varying,
        "emote_id" character varying,
        "network" character varying(8) NOT NULL,
        CONSTRAINT "PK_56b22355e89941b9792c04ab176" PRIMARY KEY ("id")
    );
    CREATE INDEX "IDX_45072545bb44e246e0496110f9" ON squid_marketplace."metadata" ("wearable_id");
    CREATE INDEX "IDX_cee9cecc2205cd07a21813203d" ON squid_marketplace."metadata" ("emote_id");

    CREATE TABLE squid_marketplace."mint" (
        "id" character varying NOT NULL,
        "creator" text NOT NULL,
        "beneficiary" text NOT NULL,
        "minter" text NOT NULL,
        "timestamp" numeric NOT NULL,
        "search_primary_sale_price" numeric,
        "search_contract_address" text NOT NULL,
        "search_item_id" numeric NOT NULL,
        "search_token_id" numeric NOT NULL,
        "search_issued_id" numeric,
        "search_is_store_minter" boolean NOT NULL,
        "item_id" character varying,
        "nft_id" character varying,
        "network" character varying(8) NOT NULL,
        CONSTRAINT "PK_fcaea791104aa41aa11dac29cb2" PRIMARY KEY ("id")
    );
    CREATE INDEX "IDX_cd587534d4140377bb52337ae4" ON squid_marketplace."mint" ("item_id");
    CREATE INDEX "IDX_c46ca4e5f135d6dbdf10111660" ON squid_marketplace."mint" ("nft_id");

    CREATE TABLE squid_marketplace."nft" (
        "id" character varying NOT NULL,
        "token_id" numeric NOT NULL,
        "contract_address" text NOT NULL,
        "category" character varying(8) NOT NULL,
        "token_uri" text,
        "name" text,
        "image" text,
        "created_at" numeric NOT NULL,
        "updated_at" numeric NOT NULL,
        "sold_at" numeric,
        "transferred_at" numeric NOT NULL,
        "sales" integer NOT NULL,
        "volume" numeric NOT NULL,
        "search_order_status" character varying(11),
        "search_order_price" numeric,
        "search_order_expires_at" numeric,
        "search_order_created_at" numeric,
        "search_is_land" boolean,
        "search_text" text,
        "search_parcel_is_in_bounds" boolean,
        "search_parcel_x" numeric,
        "search_parcel_y" numeric,
        "search_parcel_estate_id" text,
        "search_distance_to_plaza" integer,
        "search_adjacent_to_road" boolean,
        "search_estate_size" integer,
        "search_is_wearable_head" boolean,
        "search_is_wearable_accessory" boolean,
        "search_wearable_rarity" text,
        "search_wearable_category" character varying(11),
        "search_wearable_body_shapes" character varying(10) array,
        "item_blockchain_id" numeric,
        "issued_id" numeric,
        "item_type" character varying(17),
        "urn" text,
        "search_item_type" text,
        "search_emote_category" character varying(13),
        "search_emote_loop" boolean,
        "search_emote_rarity" text,
        "search_emote_body_shapes" character varying(10) array,
        "network" character varying(8) NOT NULL,
        "search_order_expires_at_normalized" TIMESTAMP WITH TIME ZONE,
        "owner_address" text NOT NULL,
        "owner_id" character varying,
        "active_order_id" character varying,
        "parcel_id" character varying,
        "estate_id" character varying,
        "wearable_id" character varying,
        "ens_id" character varying,
        "collection_id" character varying,
        "item_id" character varying,
        "metadata_id" character varying,
        CONSTRAINT "PK_8f46897c58e23b0e7bf6c8e56b0" PRIMARY KEY ("id"),
        CONSTRAINT "REL_31459100f31150048a6d5fda2a" UNIQUE ("parcel_id"),
        CONSTRAINT "REL_c93c3ba3d64f3ac7dca84ef45b" UNIQUE ("estate_id"),
        CONSTRAINT "REL_2d559d06edaadb3c3facd8159c" UNIQUE ("wearable_id"),
        CONSTRAINT "REL_070ce4690a766ec56a00acc7e0" UNIQUE ("ens_id")
    );
    CREATE INDEX "IDX_83cfd3a290ed70c660f8c9dfe2" ON squid_marketplace."nft" ("owner_id");
    CREATE INDEX "IDX_b92ac830e4b3a630162a898203" ON squid_marketplace."nft" ("active_order_id");
    CREATE INDEX "IDX_31459100f31150048a6d5fda2a" ON squid_marketplace."nft" ("parcel_id");
    CREATE INDEX "IDX_c93c3ba3d64f3ac7dca84ef45b" ON squid_marketplace."nft" ("estate_id");
    CREATE INDEX "IDX_2d559d06edaadb3c3facd8159c" ON squid_marketplace."nft" ("wearable_id");
    CREATE INDEX "IDX_070ce4690a766ec56a00acc7e0" ON squid_marketplace."nft" ("ens_id");
    CREATE INDEX "IDX_7e215df412b248db3731737290" ON squid_marketplace."nft" ("token_id");
    CREATE INDEX "IDX_2c8ca873555fc156848199919f" ON squid_marketplace."nft" ("created_at");
    CREATE INDEX "IDX_645ec1a1710c449fa4e9d241e9" ON squid_marketplace."nft" ("search_order_expires_at");
    CREATE INDEX "IDX_4d213d73326e54427a5c9bdddf" ON squid_marketplace."nft" ("search_parcel_is_in_bounds");
    CREATE INDEX "IDX_3baa214ec3db0ce29708750e3b" ON squid_marketplace."nft" ("category");
    CREATE INDEX "IDX_e0e405184c1c9253bbe95b6cc7" ON squid_marketplace."nft" ("search_order_expires_at_normalized");
    CREATE INDEX "IDX_b53fdf02d6f6047c1758ae885a" ON squid_marketplace."nft" ("search_is_land");
    CREATE INDEX "IDX_4c7d1118621f3ea97740a1d876" ON squid_marketplace."nft" ("item_id", "owner_id");
    CREATE INDEX "IDX_0fca1a8c5d9399d9a9a52e26f7" ON squid_marketplace."nft" ("contract_address", "token_id");
    CREATE INDEX "IDX_26e756121a20d1cc3e4d738279" ON squid_marketplace."nft" ("owner_address");
    CREATE INDEX "IDX_5f8cc4778564d0bd3c4ac3436d" ON squid_marketplace."nft" ("search_order_status", "search_order_expires_at", "category");
    CREATE INDEX "IDX_d5b8837a62eb6d9c95eb3d2ef2" ON squid_marketplace."nft" ("search_order_status", "search_order_expires_at", "network");

    CREATE TABLE squid_marketplace."order" (
        "id" character varying NOT NULL,
        "marketplace_address" text NOT NULL,
        "category" character varying(8) NOT NULL,
        "nft_address" text NOT NULL,
        "token_id" numeric NOT NULL,
        "tx_hash" text NOT NULL,
        "owner" text NOT NULL,
        "buyer" text,
        "price" numeric NOT NULL,
        "status" character varying(11) NOT NULL,
        "block_number" numeric NOT NULL,
        "expires_at" numeric NOT NULL,
        "created_at" numeric NOT NULL,
        "updated_at" numeric NOT NULL,
        "nft_id" character varying,
        "network" character varying(8) NOT NULL,
        "item_id" character varying,
        "expires_at_normalized" TIMESTAMP WITH TIME ZONE NOT NULL,
        CONSTRAINT "PK_1031171c13130102495201e3e20" PRIMARY KEY ("id")
    );
    CREATE INDEX "IDX_f5047ff046d513a3598c1a2931" ON squid_marketplace."order" ("nft_id");
    CREATE INDEX "IDX_d01158fe15b1ead5c26fd7f4e9" ON squid_marketplace."order" ("item_id");
    CREATE INDEX "IDX_2485593ed8c9972197aeaf7da6" ON squid_marketplace."order" ("expires_at_normalized");

    CREATE TABLE squid_marketplace."parcel" (
        "id" character varying NOT NULL,
        "token_id" numeric NOT NULL,
        "x" numeric NOT NULL,
        "y" numeric NOT NULL,
        "raw_data" text,
        "owner_id" character varying,
        "estate_id" character varying,
        "data_id" character varying,
        CONSTRAINT "PK_c01e9fed31b7433a00942d506b1" PRIMARY KEY ("id")
    );
    CREATE INDEX "IDX_a7c5c87cd4ffc1e1129f0c5f43" ON squid_marketplace."parcel" ("owner_id");
    CREATE INDEX "IDX_da4912d77606dcfabe5da7eebc" ON squid_marketplace."parcel" ("estate_id");
    CREATE INDEX "IDX_04ab2b996d659d2f86dbcee860" ON squid_marketplace."parcel" ("data_id");

    CREATE TABLE squid_marketplace."rarity" (
        "id" character varying NOT NULL,
        "name" text NOT NULL,
        "max_supply" numeric NOT NULL,
        "price" numeric NOT NULL,
        "currency" character varying(4) NOT NULL,
        CONSTRAINT "PK_abfb3052bad892c356e54679f8f" PRIMARY KEY ("id")
    );

    CREATE TABLE squid_marketplace."sale" (
        "id" character varying NOT NULL,
        "type" character varying(5) NOT NULL,
        "buyer" text NOT NULL,
        "seller" text NOT NULL,
        "price" numeric NOT NULL,
        "timestamp" numeric NOT NULL,
        "tx_hash" text NOT NULL,
        "search_token_id" numeric NOT NULL,
        "search_contract_address" text NOT NULL,
        "search_category" text NOT NULL,
        "beneficiary" bytea,
        "fees_collector_cut" numeric,
        "fees_collector" bytea,
        "royalties_cut" numeric,
        "royalties_collector" bytea,
        "search_item_id" numeric,
        "network" character varying(8) NOT NULL,
        "nft_id" character varying,
        "item_id" character varying,
        CONSTRAINT "PK_d03891c457cbcd22974732b5de2" PRIMARY KEY ("id")
    );
    CREATE INDEX "IDX_8524438f82167bcb795bcb8663" ON squid_marketplace."sale" ("nft_id");
    CREATE INDEX "IDX_8ac00a610840894296c6f32fd2" ON squid_marketplace."sale" ("timestamp");
    CREATE INDEX "IDX_a91d7a7aa55af7d57ef4d17912" ON squid_marketplace."sale" ("search_category", "network");
    CREATE INDEX "IDX_439a57a4a0d130329d3d2e671b" ON squid_marketplace."sale" ("item_id");

    CREATE TABLE squid_marketplace."transfer" (
        "id" character varying NOT NULL,
        "nft_id" text NOT NULL,
        "network" text NOT NULL,
        "block" integer NOT NULL,
        "timestamp" numeric NOT NULL,
        "from" text NOT NULL,
        "to" text NOT NULL,
        "tx_hash" text NOT NULL,
        CONSTRAINT "PK_fd9ddbdd49a17afcbe014401295" PRIMARY KEY ("id")
    );
    CREATE INDEX "IDX_024eb30e5fd99a5bea7befe60e" ON squid_marketplace."transfer" ("network");
    CREATE INDEX "IDX_c116ab40c3b32ca2d9c1d17d8b" ON squid_marketplace."transfer" ("block");
    CREATE INDEX "IDX_be54ea276e0f665ffc38630fc0" ON squid_marketplace."transfer" ("from");
    CREATE INDEX "IDX_4cbc37e8c3b47ded161f44c24f" ON squid_marketplace."transfer" ("to");
    CREATE INDEX "IDX_f605a03972b4f28db27a0ee70d" ON squid_marketplace."transfer" ("tx_hash");

    CREATE TABLE squid_marketplace."wearable" (
        "id" character varying NOT NULL,
        "representation_id" text,
        "collection" text NOT NULL,
        "name" text NOT NULL,
        "description" text NOT NULL,
        "category" character varying(11) NOT NULL,
        "rarity" character varying(9) NOT NULL,
        "body_shapes" character varying(10) array,
        "owner_id" character varying,
        "network" character varying(8) NOT NULL,
        CONSTRAINT "PK_ce858dd0e1f42c7e8975ece1891" PRIMARY KEY ("id")
    );
    CREATE INDEX "IDX_f011ccea27833b0628a7532834" ON squid_marketplace."wearable" ("owner_id");


    CREATE MATERIALIZED VIEW marketplace.mv_trades AS
    WITH trades_owner_ok AS (
        SELECT t.id
        FROM marketplace.trades t
        JOIN marketplace.trade_assets ta ON t.id = ta.trade_id
        LEFT JOIN marketplace.trade_assets_erc721 erc721_asset ON ta.id = erc721_asset.asset_id
        LEFT JOIN squid_marketplace.nft nft
        ON  ta.contract_address = nft.contract_address
        AND ta.direction = 'sent'
        AND nft.token_id = erc721_asset.token_id::numeric
        WHERE t.type IN ('public_item_order', 'public_nft_order')
        GROUP BY t.id
        HAVING bool_and(ta.direction != 'sent' OR nft.owner_address = t.signer)
    )
    SELECT
        t.id,
        t.created_at,
        t.type,
        t.signer,

        -- Keep all the SELECT logic from your `unified_trades` CTE
        MAX(CASE WHEN av.direction = 'sent'     THEN av.contract_address END) AS contract_address_sent,
        MAX(CASE WHEN av.direction = 'received' THEN av.amount END)          AS amount_received,
        MAX(CASE WHEN av.direction = 'sent'     THEN av.available END)       AS available,
        json_object_agg(
            av.direction,
            json_build_object(
                'contract_address', av.contract_address,
                'direction',        av.direction,
                'beneficiary',      av.beneficiary,
                'extra',            av.extra,
                'token_id',         av.token_id,
                'item_id',          av.item_id,
                'amount',           av.amount,
                'creator',          av.creator,
                'owner',            av.nft_owner,
                'category',         av.category,
                'nft_id',           av.nft_id,
                'issued_id',        av.issued_id,
                'nft_name',         av.nft_name
            )
        ) AS assets,

        MAX(av.contract_address) FILTER (WHERE av.direction = 'sent') AS sent_contract_address,
        MAX(av.token_id)         FILTER (WHERE av.direction = 'sent') AS sent_token_id,

        CASE
            WHEN COUNT(CASE WHEN st.action = 'cancelled' THEN 1 END) > 0             THEN 'cancelled'
            WHEN t.expires_at < now()::timestamptz(3)                                THEN 'cancelled'
            WHEN (
                (si_signer.index IS NOT NULL
                    AND si_signer.index != (t.checks ->> 'signerSignatureIndex')::int)
                OR (si_signer.index IS NULL
                    AND (t.checks ->> 'signerSignatureIndex')::int != 0)
                )
                                                                                    THEN 'cancelled'
            WHEN (
                (si_contract.index IS NOT NULL
                    AND si_contract.index != (t.checks ->> 'contractSignatureIndex')::int)
                OR (si_contract.index IS NULL
                    AND (t.checks ->> 'contractSignatureIndex')::int != 0)
                )
                                                                                    THEN 'cancelled'
            WHEN COUNT(CASE WHEN st.action = 'executed' THEN 1 END)
                >= (t.checks ->> 'uses')::int                                       THEN 'sold'
            ELSE 'open'
        END AS status

    FROM marketplace.trades      AS t
    JOIN trades_owner_ok         AS ok
    ON t.id = ok.id

    JOIN (
        SELECT
            ta.id,
            ta.trade_id,
            ta.contract_address,
            ta.direction,
            ta.beneficiary,
            ta.extra,
            erc721_asset.token_id,
            erc20_asset.amount,
            item.creator,
            item.available,
            nft.owner_address      AS nft_owner,
            nft.category,
            nft.id                AS nft_id,
            nft.issued_id         AS issued_id,
            nft.name             AS nft_name,
            coalesce(nft.item_blockchain_id::text, item_asset.item_id) AS item_id
        FROM marketplace.trade_assets AS ta
        LEFT JOIN marketplace.trade_assets_erc721 AS erc721_asset
            ON ta.id = erc721_asset.asset_id
        LEFT JOIN marketplace.trade_assets_erc20 AS erc20_asset
            ON ta.id = erc20_asset.asset_id
        LEFT JOIN marketplace.trade_assets_item AS item_asset
            ON ta.id = item_asset.asset_id
        LEFT JOIN squid_marketplace.item AS item
            ON ta.contract_address = item.collection_id
            AND item_asset.item_id::numeric = item.blockchain_id
        LEFT JOIN squid_marketplace.nft AS nft
            ON ta.contract_address = nft.contract_address
            AND erc721_asset.token_id::numeric = nft.token_id
    ) AS av
    ON t.id = av.trade_id

    LEFT JOIN squid_trades.trade AS st
    ON st.signature = t.hashed_signature

    LEFT JOIN squid_trades.signature_index AS si_signer
    ON LOWER(si_signer.address) = LOWER(t.signer)

    LEFT JOIN (
        SELECT *
        FROM squid_trades.signature_index idx
        WHERE LOWER(idx.address) IN (
            '0x2d6b3508f9aca32d2550f92b2addba932e73c1ff',
            '0x540fb08edb56aae562864b390542c97f562825ba'
        )
    ) AS si_contract
    ON t.network = si_contract.network

    WHERE t.type IN ('public_item_order', 'public_nft_order')
    GROUP BY
        t.id,
        t.type,
        t.created_at,
        t.network,
        t.chain_id,
        t.signer,
        t.checks,
        si_contract.index,
        si_signer.index;

    CREATE INDEX idx_mv_trades_id ON marketplace.mv_trades (id);

EOSQL
