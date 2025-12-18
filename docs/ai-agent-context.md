# AI Agent Context

**Service Purpose:** Provides comprehensive marketplace APIs for the Decentraland Marketplace. Enables browsing, searching, and interacting with NFTs (wearables, emotes, LAND, estates, ENS names), managing trades and orders, and accessing marketplace analytics with extensive filtering and sorting capabilities.

**Key Capabilities:**

- Queries NFTs with extensive filtering (category, owner, price range, rarity, network, etc.)
- Manages trades, bids, and orders with blockchain signature validation
- Provides marketplace catalog with sorting, pagination, and advanced filtering
- Supports user favorites lists with privacy controls (public/private) and access sharing
- Delivers sales history, price data, trending items, rankings, and volume analytics
- Integrates payment gateways (Wert, Transak) for fiat-to-crypto purchases
- Queries user-owned assets (wearables, emotes, ENS names) with grouping options
- LAND-specific filtering (distance to plaza, adjacent to roads, estate size)
- Supports multiple networks (Ethereum mainnet, Polygon)

**Communication Pattern:** Synchronous HTTP REST API with optional authentication

**Technology Stack:**

- Runtime: Node.js
- Language: TypeScript
- HTTP Framework: @well-known-components/http-server
- Database: PostgreSQL (multiple schemas: marketplace, favorites, Squid indexer)
- Cache: Redis or in-memory fallback (@dcl/redis-component, @dcl/memory-cache-component)
- Authentication: Signed Fetch (decentraland-crypto-middleware, ADR-44)
- Metrics: @well-known-components/metrics
- Component Architecture: @well-known-components pattern

**External Dependencies:**

- Databases: PostgreSQL with multiple schemas (favorites, dapps/marketplace, Squid indexer)
- Caching: Redis (optional, falls back to in-memory cache)
- Blockchain Indexing: Squid indexer (on-chain marketplace data aggregation)
- Subgraph: Rentals subgraph via The Graph for LAND rental data
- Events: AWS SNS (event publishing for trades and marketplace activity)
- Payment Gateways: Wert and Transak for fiat-to-crypto purchases

**Key Concepts:**

- **Trades**: Peer-to-peer exchanges with signature validation. Types: BID, PUBLIC_ITEM_ORDER, PUBLIC_NFT_ORDER. Stored with expiration dates and blockchain signatures.
- **Trade Assets**: Assets involved in trades (ERC20, ERC721, Collection Items) with direction (SENT/RECEIVED) and beneficiary tracking.
- **Favorites Lists**: User-curated collections with privacy controls. Default list exists for unauthenticated users. Supports ACL for collaborative access.
- **Picks**: Items added to favorites lists. Composite primary key (item_id, user_address, list_id) allows same item in multiple lists.
- **Catalog**: Marketplace items with extensive filtering by category, rarity, price, creator, sale status, wearable/emote attributes.
- **Signed Fetch Authentication**: Uses ADR-44 specification with decentraland-crypto-middleware. Validates auth chain headers and metadata intent.
- **Multi-Network**: Supports Ethereum mainnet (chain_id: 1) and Polygon (chain_id: 137) with network-specific filtering.

**Database Notes:**

- **Schemas**: `marketplace` (trades, trade_assets), `favorites` (lists, picks, acl, voting), external Squid indexer schema (read-only)
- **Key Tables**: `marketplace.trades` (orders/bids), `marketplace.trade_assets` (trade items), `lists` (favorites), `picks` (list items), `acl` (permissions)
- **Key Constraints**: `trades.signature` (unique), composite PK on picks `(item_id, user_address, list_id)`
- **Cascade Deletes**: Trade assets cascade on trade delete, picks/ACL cascade on list delete
- **Full Documentation**: See [docs/database-schema.md](database-schema.md) for detailed schema

**API Specification:** OpenAPI docs available at `docs/openapi.yaml`. Base URLs: Production `https://marketplace-api.decentraland.org`, Development `https://marketplace-api.decentraland.zone`

**Component Architecture:**

The service follows the @well-known-components pattern with dependency injection. Key components:
- `catalog`: Marketplace item catalog with filtering and Segment analytics
- `trades`: Trade creation and management with event publishing
- `lists`, `picks`, `access`: Favorites functionality with ACL
- `nfts`, `items`, `orders`, `bids`: Marketplace entity queries
- `wertSigner`, `transak`: Payment gateway integrations
- `rentals`: LAND rental integration via subgraph
