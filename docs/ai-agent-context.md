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

**API Specification:** Endpoints documented in README sections above
