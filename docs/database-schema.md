# Database Schema Documentation

This document describes the database schema for the Marketplace Server. The schema uses PostgreSQL and is managed through migrations located in `src/migrations/`. The service uses multiple schemas and also integrates with external Squid indexer data.

## Schemas Overview

The database contains the following schemas:
1. **`marketplace`** - Trade and order management
2. **`favorites`** (public schema) - User favorites lists and picks
3. **External**: Squid indexer schema (read-only, for on-chain NFT data)

---

## Database Schema Diagram

```mermaid
erDiagram
    marketplace_trades {
        UUID id PK "Trade ID"
        TEXT network "Network"
        INTEGER chain_id "Chain ID"
        TEXT signature UK "Signature"
        TEXT hashed_signature UK "Hashed signature"
        JSONB checks "Validation checks"
        VARCHAR signer "Signer address"
        trade_type type "Trade type"
        TIMESTAMPTZ expires_at "Expiration"
        TIMESTAMPTZ effective_since "Effective date"
        TEXT contract "Contract address"
        TIMESTAMPTZ created_at "Creation time"
    }
    
    marketplace_trade_assets {
        UUID id PK "Asset ID"
        UUID trade_id FK "Trade reference"
        asset_direction_type direction "Direction"
        SMALLINT asset_type "Asset type"
        VARCHAR contract_address "Contract address"
        VARCHAR beneficiary "Beneficiary"
        TEXT extra "Extra data"
        TIMESTAMPTZ created_at "Creation time"
    }
    
    marketplace_trade_assets_erc721 {
        UUID asset_id FK "Asset reference"
        TEXT token_id "Token ID"
    }
    
    marketplace_trade_assets_erc20 {
        UUID asset_id FK "Asset reference"
        NUMERIC amount "Amount"
    }
    
    marketplace_trade_assets_item {
        UUID asset_id FK "Asset reference"
        TEXT item_id "Item ID"
    }
    
    lists {
        UUID id PK "List ID"
        TEXT name "List name"
        TEXT description "Description"
        TEXT user_address "Owner address"
        TIMESTAMP created_at "Creation time"
        TIMESTAMP updated_at "Update time"
    }
    
    picks {
        TEXT item_id PK "Item ID"
        TEXT user_address PK "User address"
        UUID list_id PK FK "List reference"
        TIMESTAMP created_at "Creation time"
    }
    
    acl {
        UUID list_id PK FK "List reference"
        permissions permission PK "Permission type"
        TEXT grantee PK "Grantee address"
    }
    
    voting {
        TEXT user_address PK "User address"
        INTEGER power "Voting power"
    }
    
    marketplace_trades ||--o{ marketplace_trade_assets : "has assets"
    marketplace_trade_assets ||--o| marketplace_trade_assets_erc721 : "ERC721 details"
    marketplace_trade_assets ||--o| marketplace_trade_assets_erc20 : "ERC20 details"
    marketplace_trade_assets ||--o| marketplace_trade_assets_item : "Item details"
    lists ||--o{ picks : "has picks"
    lists ||--o{ acl : "has permissions"
```

**Relationship Notes:**
- **Foreign Keys**: `marketplace_trade_assets.trade_id` → `marketplace.trades.id`, `picks.list_id` → `lists.id`, `acl.list_id` → `lists.id`
- **Cascade Deletes**: All trade assets cascade delete when trade is deleted, picks and ACL cascade delete when list is deleted
- **External Data**: Service also reads from Squid indexer schema for on-chain NFT metadata (not managed by this service)

---

## Schema: `marketplace`

Contains trade and order management tables.

---

## Table: `marketplace.trades`

Stores trade orders (bids, public orders) for the marketplace.

### Columns

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `id` | UUID | NOT NULL | **Primary Key**. Unique trade identifier. Auto-generated. |
| `network` | TEXT | NOT NULL | Network name (e.g., `"ethereum"`, `"polygon"`). |
| `chain_id` | INTEGER | NOT NULL | Blockchain chain ID. |
| `signature` | TEXT | NOT NULL | **Unique**. Trade signature. |
| `hashed_signature` | TEXT | NOT NULL | **Unique**. Hashed version of signature. |
| `checks` | JSONB | NOT NULL | Validation checks performed on the trade. |
| `signer` | VARCHAR(42) | NOT NULL | Ethereum address of the trade signer. |
| `type` | trade_type | NOT NULL | Type of trade. Valid values: `"BID"`, `"PUBLIC_ITEM_ORDER"`, `"PUBLIC_NFT_ORDER"`. |
| `expires_at` | TIMESTAMPTZ(3) | NOT NULL | Timestamp when the trade expires. |
| `effective_since` | TIMESTAMPTZ(3) | NOT NULL | Timestamp when the trade becomes effective. |
| `contract` | TEXT | NOT NULL | Contract address for the trade. |
| `created_at` | TIMESTAMPTZ(3) | NOT NULL | Timestamp when the trade was created. Defaults to `now()`. |

### Indexes

- **Primary Key**: `id`
- **Unique Constraint**: `signature`
- **Unique Constraint**: `hashed_signature`

### Business Rules

1. Trades represent marketplace orders (bids, public orders)
2. Signatures are unique to prevent duplicate trades
3. Trades expire based on `expires_at` timestamp

---

## Table: `marketplace.trade_assets`

Stores assets involved in trades (ERC20, ERC721, Collection Items).

### Columns

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `id` | UUID | NOT NULL | **Primary Key**. Unique asset identifier. Auto-generated. |
| `trade_id` | UUID | NOT NULL | **Foreign Key** to `marketplace.trades.id`. Cascade delete. |
| `direction` | asset_direction_type | NOT NULL | Asset direction. Valid values: `"SENT"`, `"RECEIVED"`. |
| `asset_type` | SMALLINT | NOT NULL | Asset type. Values: `1` (ERC20), `2` (USD_PEGGED_MANA), `3` (ERC721), `4` (COLLECTION_ITEM). |
| `contract_address` | VARCHAR(42) | NOT NULL | Contract address of the asset. |
| `beneficiary` | VARCHAR(42) | NULL | Beneficiary address (if applicable). |
| `extra` | TEXT | NULL | Additional asset data. |
| `created_at` | TIMESTAMPTZ(3) | NOT NULL | Timestamp when the asset was created. Defaults to `now()`. |

### Indexes

- **Primary Key**: `id`

### Business Rules

1. Each trade can have multiple assets
2. Asset direction indicates if asset is sent or received
3. Asset type determines which detail table contains specific data

---

## Table: `marketplace.trade_assets_erc721`

Stores ERC721-specific details for trade assets.

### Columns

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `asset_id` | UUID | NOT NULL | **Foreign Key** to `marketplace.trade_assets.id`. Cascade delete. |
| `token_id` | TEXT | NOT NULL | ERC721 token ID. |

### Indexes

- **Unique Constraint**: `asset_id`

### Business Rules

1. One record per ERC721 asset
2. References trade_assets with `asset_type = 3`

---

## Table: `marketplace.trade_assets_erc20`

Stores ERC20-specific details for trade assets.

### Columns

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `asset_id` | UUID | NOT NULL | **Foreign Key** to `marketplace.trade_assets.id`. Cascade delete. |
| `amount` | NUMERIC(78,0) | NOT NULL | ERC20 amount. Must be >= 0 and < 2^256. |

### Indexes

- **Unique Constraint**: `asset_id`

### Constraints

- Check constraint: `amount >= 0 AND amount < 2^256`

### Business Rules

1. One record per ERC20 asset
2. References trade_assets with `asset_type = 1` or `2`
3. Amount stored in wei (smallest unit)

---

## Table: `marketplace.trade_assets_item`

Stores Collection Item-specific details for trade assets.

### Columns

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `asset_id` | UUID | NOT NULL | **Foreign Key** to `marketplace.trade_assets.id`. Cascade delete. |
| `item_id` | TEXT | NOT NULL | Collection item ID. |

### Indexes

- **Unique Constraint**: `asset_id`

### Business Rules

1. One record per Collection Item asset
2. References trade_assets with `asset_type = 4`

---

## Schema: `favorites` (Public Schema)

Contains user favorites lists and picks.

---

## Table: `lists`

Stores user-created favorites lists.

### Columns

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `id` | UUID | NOT NULL | **Primary Key**. Unique list identifier. Auto-generated. |
| `name` | TEXT | NOT NULL | List name. |
| `description` | TEXT | NULL | List description. |
| `user_address` | TEXT | NOT NULL | Ethereum address of the list owner. |
| `created_at` | TIMESTAMP | NOT NULL | Timestamp when the list was created. Defaults to `now()`. |
| `updated_at` | TIMESTAMP | NOT NULL | Timestamp when the list was last updated. Defaults to `now()`. |

### Indexes

- **Primary Key**: `id`
- **Unique Constraint**: `(name, user_address)` - One list per name per user

### Business Rules

1. Users can create multiple lists
2. List names must be unique per user
3. Default list exists with ID `70ab6873-4a03-4eb2-b331-4b8be0e0b8af` for user `0x0000000000000000000000000000000000000000`

---

## Table: `picks`

Stores items added to lists (favorites).

### Columns

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `item_id` | TEXT | NOT NULL | **Primary Key (part 1)**. NFT/item identifier. |
| `user_address` | TEXT | NOT NULL | **Primary Key (part 2)**. Ethereum address of the user. |
| `list_id` | UUID | NOT NULL | **Primary Key (part 3)**. **Foreign Key** to `lists.id`. Cascade delete. |
| `created_at` | TIMESTAMP | NOT NULL | Timestamp when the pick was created. Defaults to `now()`. |

### Indexes

- **Composite Primary Key**: `(item_id, user_address, list_id)` - One pick per item per user per list
- **Index**: On `created_at` for chronological queries

### Business Rules

1. Users can add items to multiple lists
2. One pick per item per user per list
3. Deleted lists cascade delete all picks

---

## Table: `acl`

Stores access control list permissions for lists.

### Columns

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `list_id` | UUID | NOT NULL | **Primary Key (part 1)**. **Foreign Key** to `lists.id`. Cascade delete. |
| `permission` | permissions | NOT NULL | **Primary Key (part 2)**. Permission type. Valid values: `"edit"`, `"view"`. |
| `grantee` | TEXT | NOT NULL | **Primary Key (part 3)**. Ethereum address of the grantee. |

### Indexes

- **Composite Primary Key**: `(list_id, permission, grantee)`

### Business Rules

1. Controls who can view or edit lists
2. Permissions are granted per list per user
3. Deleted lists cascade delete all ACL entries

---

## Table: `voting`

Stores user voting power for governance features.

### Columns

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `user_address` | TEXT | NOT NULL | **Primary Key**. Ethereum address of the user. |
| `power` | INTEGER | NOT NULL | Voting power value. |

### Indexes

- **Primary Key**: `user_address`

### Business Rules

1. One voting power record per user
2. Used for governance and voting features

---

## External Schema: Squid Indexer

The service also reads from an external Squid indexer PostgreSQL schema for on-chain NFT data. This schema is managed by the Squid indexer service and contains:
- NFT metadata
- Sales history
- Order data
- On-chain transaction data

The marketplace server uses Foreign Data Wrappers (FDW) to access this external data.

---

## Related Code

- **Migrations**: `src/migrations/`
  - `dapps/`: Marketplace trades and orders migrations
  - `favorites/`: Favorites lists and picks migrations
  - `substreams/`: External data integration migrations
- **Database Logic**: `src/logic/`
- **Types**: `src/types/`
- **Database Port**: `src/ports/postgres.ts`

