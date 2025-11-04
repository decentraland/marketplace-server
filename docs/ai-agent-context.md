# AI Agent Context

**Service Purpose:** Provides comprehensive marketplace APIs for browsing, filtering, and querying Decentraland NFTs (wearables, emotes, LAND, estates). Aggregates marketplace data including listings, sales, orders, and user assets with extensive filtering and sorting capabilities.

**Key Capabilities:**

- Queries NFTs with extensive filtering (category, owner, price range, rarity, etc.)
- Provides sales history and order tracking
- Catalog browsing with sorting and pagination
- User asset queries (owned wearables, emotes)
- LAND filtering (distance to plaza, adjacent to road, estate size)
- Integration with Squid indexer for on-chain data
- Supports multiple networks (Ethereum mainnet, Polygon)

**Communication Pattern:** Synchronous HTTP REST API

**Technology Stack:**

- Runtime: Node.js
- Language: TypeScript
- HTTP Framework: Express or @well-known-components/http-server
- Database: PostgreSQL (via Squid indexer schema)
- Component Architecture: @well-known-components (logger, metrics, http-server)

**External Dependencies:**

- Database: PostgreSQL with Squid indexer schema (NFT metadata, sales, orders)
- Blockchain Indexing: Squid indexer (on-chain marketplace data aggregation)
- Content Server: Catalyst (optional, for entity metadata)

**Database Schema:**

- **Schemas**: `marketplace` (trades, trade_assets), `favorites` (lists, picks, acl, voting), plus external Squid indexer schema (read-only)
- **Key Tables**: `marketplace.trades` (orders/bids), `marketplace.trade_assets` (trade assets), `lists` (favorites lists), `picks` (list items), `acl` (list permissions)
- **Key Columns**: `marketplace.trades.signature` (unique), `marketplace.trades.type` (trade_type enum), `lists.id` (PK), `picks` composite PK `(item_id, user_address, list_id)`
- **Full Documentation**: See [docs/database-schema.md](docs/database-schema.md) for detailed schema, column definitions, and relationships

**API Specification:** Endpoints documented in README sections above
