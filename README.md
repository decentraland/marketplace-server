# Marketplace Server

[![Coverage Status](https://coveralls.io/repos/github/decentraland/marketplace-server/badge.svg?branch=main)](https://coveralls.io/github/decentraland/marketplace-server?branch=main)

The Marketplace Server is a comprehensive API solution designed for the Decentraland Marketplace. This service enables users to browse, search, and interact with NFTs (wearables, emotes, LAND, estates, ENS names), manage trades and orders, and access marketplace analytics.

This server interacts with PostgreSQL for data storage, Squid indexer for on-chain data aggregation, Redis for caching, and AWS SNS for event notifications to provide users with a complete marketplace experience including trading, favorites management, and payment gateway integration.

## Table of Contents

- [Features](#features)
- [Dependencies & Related Services](#dependencies--related-services)
- [API Documentation](#api-documentation)
- [Database Schema](#database-schema)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
  - [Configuration](#configuration)
  - [Running the Service](#running-the-service)
- [Testing](#testing)
- [How to Contribute](#how-to-contribute)
- [License](#license)

## Features

- **NFT Management**: Browse, search, and query NFTs including wearables, emotes, LAND parcels, estates, and ENS names with extensive filtering options
- **Trading Operations**: Create and manage trades, place bids, and view active orders with blockchain signature validation
- **Marketplace Catalog**: Access the full marketplace catalog with sorting, pagination, and advanced filtering by category, price, rarity, and more
- **Favorites & Lists**: Create and manage personalized item collections with privacy controls (public/private) and access sharing
- **Analytics & Statistics**: Access sales history, price data, trending items, rankings, and volume metrics
- **Payment Integration**: Support for fiat-to-crypto gateways (Wert, Transak) enabling credit/debit card purchases
- **User Assets**: Query user-owned wearables, emotes, and ENS names with grouping and filtering options
- **Multi-Network Support**: Full support for Ethereum mainnet and Polygon networks

## Dependencies & Related Services

This service interacts with the following services:

- **[Decentraland Marketplace](https://github.com/decentraland/marketplace)**: Frontend application that consumes this API
- **[Decentraland Builder](https://github.com/decentraland/builder)**: Builder application for creating collections

External dependencies:

- **PostgreSQL**: Databases for marketplace trades, favorites, and Squid indexer data
- **Redis**: Optional caching layer for improved performance
- **Squid Indexer**: On-chain data aggregation for NFT metadata, sales, and orders
- **Rentals Subgraph**: Land rental information via The Graph
- **AWS SNS**: Event notifications for trades and marketplace activity

## API Documentation

The API is fully documented using the [OpenAPI standard](https://swagger.io/specification/). The specification is available at:

- `docs/openapi.yaml`: OpenAPI YAML specification

### Base URLs

- **Production**: `https://marketplace-api.decentraland.org`
- **Development**: `https://marketplace-api.decentraland.zone`

### Authentication

Most endpoints require authentication using Decentraland's signed fetch mechanism or expect it optionally. The authentication method is Signed Fetch and follows the [ADR-44](https://adr.decentraland.org/adr/ADR-44) specification.

Required authentication endpoints:

- POST `/v1/trades` - Create a new trade
- POST `/v1/lists` - Create a favorites list
- PUT `/v1/lists/{id}` - Update a favorites list
- DELETE `/v1/lists/{id}` - Delete a favorites list
- POST `/v1/lists/{id}/picks` - Add item to favorites list
- DELETE `/v1/lists/{id}/picks/{itemId}` - Remove item from favorites list
- POST `/v1/picks/{itemId}` - Bulk pick/unpick operation

Optional authentication (provides personalized results):

- GET `/v1/catalog`, `/v2/catalog` - Marketplace catalog
- GET `/v1/nfts` - NFT listings
- GET `/v1/items` - Marketplace items
- GET `/v1/lists/{id}` - Get list details (required for private lists)

### Key Endpoints

| Category | Endpoint | Description |
|----------|----------|-------------|
| Health | `GET /ping` | Service health check |
| Catalog | `GET /v1/catalog`, `GET /v2/catalog` | Browse marketplace catalog |
| NFTs | `GET /v1/nfts` | Query NFTs with filtering |
| Items | `GET /v1/items` | Query marketplace items |
| Trades | `GET /v1/trades`, `POST /v1/trades` | View and create trades |
| Bids | `GET /v1/bids` | View marketplace bids |
| Orders | `GET /v1/orders` | View marketplace orders |
| Sales | `GET /v1/sales` | View sales history |
| Contracts | `GET /v1/contracts` | List smart contracts |
| Collections | `GET /v1/collections` | Browse collections |
| Accounts | `GET /v1/accounts` | Query account statistics |
| Prices | `GET /v1/prices` | Get current market prices |
| Trending | `GET /v1/trendings` | Get trending items |
| Stats | `GET /v1/stats/{category}/{stat}` | Get marketplace statistics |
| Rankings | `GET /v1/rankings/{entity}/{timeframe}` | Get marketplace rankings |
| Volume | `GET /v1/volume/{timeframe}` | Get trading volume data |
| Lists | `GET /v1/lists`, `POST /v1/lists` | Manage favorites lists |
| Picks | `GET /v1/picks/{itemId}`, `POST /v1/picks/{itemId}` | Manage list picks |
| User Assets | `GET /v1/users/{address}/wearables` | Get user wearables |
| User Assets | `GET /v1/users/{address}/emotes` | Get user emotes |
| User Assets | `GET /v1/users/{address}/names` | Get user ENS names |
| Payments | `POST /v1/wert/sign` | Sign Wert payment transaction |
| Payments | `GET /v1/transak/orders/{id}` | Get Transak order details |
| ENS | `GET /v1/ens/generate` | Generate ENS name image |

## Database Schema

See [docs/database-schema.md](docs/database-schema.md) for detailed schema, column definitions, and relationships.

## Getting Started

### Prerequisites

Before running this service, ensure you have the following installed:

- **Node.js**: Version 18 or higher
- **npm** or **yarn**: Package manager
- **Docker**: For containerized deployment and local development dependencies
- **PostgreSQL**: Version 13 or higher (can run via Docker)

### Installation

1. Clone the repository:

```bash
git clone https://github.com/decentraland/marketplace-server.git
cd marketplace-server
```

2. Install dependencies:

```bash
npm install
```

3. Build the project:

```bash
npm run build
```

### Configuration

The service uses environment variables for configuration. Create a `.env` file in the root directory:

```bash
cp .env.example .env
# Edit .env with your configuration
```

Key configuration variables include:

| Variable | Description |
|----------|-------------|
| `FAVORITES_PG_COMPONENT_PSQL_CONNECTION_STRING` | PostgreSQL connection string for favorites database |
| `DAPPS_PG_COMPONENT_PSQL_CONNECTION_STRING` | PostgreSQL connection string for dapps/trades database |
| `DAPPS_READ_PG_COMPONENT_PSQL_CONNECTION_STRING` | PostgreSQL read replica connection string |
| `REDIS_URL` | Redis connection URL (optional, falls back to in-memory cache) |
| `RENTALS_SUBGRAPH_URL` | The Graph subgraph URL for rentals |
| `SIGNATURES_SERVER_URL` | Signatures server URL |
| `WERT_PRIVATE_KEY` | Wert payment gateway private key |
| `TRANSAK_API_KEY` | Transak API key |
| `TRANSAK_API_SECRET` | Transak API secret |
| `CORS_ORIGIN` | Allowed CORS origins (semicolon-separated) |
| `CORS_METHODS` | Allowed CORS methods |
| `HTTP_SERVER_PORT` | Server port (default: 5000) |

### Running the Service

#### Setting up the environment

In order to successfully run this server, external dependencies such as databases must be provided.

To do so, this repository provides you with a `docker-compose.yml` file for that purpose. In order to get the environment set up, run:

```bash
docker-compose up -d
```

This will start:

- PostgreSQL database for marketplace on port `5432`
- PostgreSQL database for dapps on port `5433`
- PostgreSQL database for builder on port `5434`

#### Running database migrations

Run migrations for the favorites and dapps databases:

```bash
npm run migrate
npm run migrate:dapps
```

#### Running in development mode

To run the service in development mode with hot reload:

```bash
npm run start:watch
```

To run in production mode:

```bash
npm run build
npm start
```

#### Logging

The service uses `@well-known-components/logger` for structured logging. Configure log levels through the `LOG_LEVEL` environment variable.

## Testing

This service includes comprehensive test coverage.

### Running Tests

Run unit tests:

```bash
npm test
```

Run unit tests in watch mode:

```bash
npm run test:watch
```

Run integration tests (requires Docker databases):

```bash
npm run test:integration
```

Run integration tests in watch mode:

```bash
npm run test:integration:watch
```

### Test Endpoints Script

The repository includes a test script (`scripts/test-endpoints.js`) that validates endpoint performance:

```bash
node scripts/test-endpoints.js
```

The script:
- Tests endpoints across different pages (Homepage, Browse, Item Detail)
- Compares response times between local and production environments
- Identifies slow queries (>1s response time)
- Provides detailed performance metrics and status codes

### Test Structure

- **Unit Tests**: Located in `test/unit/` - Test individual components and functions
- **Integration Tests**: Located in `test/integration/` - Test complete request/response cycles
- **Mocks**: Located in `test/mocks/` - Shared mock implementations

For detailed testing guidelines and standards, refer to our [Testing Standards](https://github.com/decentraland/docs/tree/main/development-standards/testing-standards) documentation.

## AI Agent Context

For detailed AI Agent context, see [docs/ai-agent-context.md](docs/ai-agent-context.md).

---

**Note**: Remember to configure your environment variables before running the service. The service requires PostgreSQL databases and optionally Redis for caching to function properly.


### Migrations

<!-- Remove this section if the service does not have a database -->

The service uses `node-pg-migrate` for database migrations. These migrations are located in `src/migrations/`. The service automatically runs the migrations when starting up.

#### Create a new migration

Migrations are created by running the create command:

```bash
npm migrate create name-of-the-migration
```

This will result in the creation of a migration file inside of the `src/migrations/` directory. This migration file MUST contain the migration set up and rollback procedures.

#### Manually applying migrations

If required, these migrations can be run manually.

To run them manually:

```bash
npm migrate up
```

To rollback them manually:

```bash
npm migrate down
```