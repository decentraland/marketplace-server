# Marketplace Server

A server that provides APIs for the Decentraland Marketplace, handling NFTs, sales, orders, and other marketplace-related functionalities.

## Available Endpoints

### NFTs

- `GET /v1/nfts`
  - Parameters:
    - `first` (number): Number of items to return
    - `skip` (number): Number of items to skip
    - `sortBy`: Sorting criteria (`newest`, `recently_listed`)
    - `isOnSale` (boolean): Filter by items on sale
    - `isLand` (boolean): Filter by land parcels
    - `category`: Filter by category (`wearable`, `ens`, etc.)
    - `owner`: Filter by owner address
    - `rentalStatus`: Filter by rental status (`open`, `cancelled`, `executed`)
    - `minDistanceToPlaza` (number): Minimum distance to plaza (for LAND)
    - `maxDistanceToPlaza` (number): Maximum distance to plaza (for LAND)
    - `adjacentToRoad` (boolean): Filter by parcels adjacent to roads
    - `minEstateSize` (number): Minimum estate size
    - `maxEstateSize` (number): Maximum estate size
    - `minPrice` (number): Minimum price
    - `maxPrice` (number): Maximum price
    - `ids` (string[]): Filter by specific NFT IDs
    - `search` (string): Search by text
    - `network` (string): Filter by network

### Sales

- `GET /v1/sales`
  - Parameters:
    - `category`: Filter by category (`wearable`, etc.)
    - `first` (number): Number of items to return
    - `skip` (number): Number of items to skip
    - `sortBy`: Sort by criteria (`recently_sold`)
    - `contractAddress`: Filter by contract address
    - `itemId`: Filter by item ID
    - `network`: Filter by network

### Catalog

- `GET /v2/catalog`
  - Parameters:
    - `first` (number): Number of items to return
    - `category`: Filter by category (`wearable`, `emote`)
    - `isOnSale` (boolean): Filter items on sale
    - `sortBy`: Sort by criteria (`newest`, `recently_sold`, `cheapest`, `most_expensive`)
    - `rarities` (string[]): Filter by rarity
    - `creator` (string): Filter by creator address
    - `isSoldOut` (boolean): Filter sold out items
    - `isWearableHead` (boolean): Filter head wearables
    - `isWearableAccessory` (boolean): Filter accessory wearables
    - `wearableCategory`: Filter by wearable category
    - `wearableGenders` (string[]): Filter by wearable gender
    - `emoteCategory`: Filter by emote category
    - `emotePlayMode`: Filter by emote play mode
    - `contractAddresses` (string[]): Filter by contract addresses
    - `minPrice` (number): Minimum price
    - `maxPrice` (number): Maximum price
    - `search` (string): Search by text

### Items

- `GET /v1/items`
  - Parameters:
    - `contractAddress`: Contract address of the collection
    - `itemId`: ID of the item
    - `category`: Filter by category
    - `creator`: Filter by creator address
    - `isSoldOut` (boolean): Filter sold out items
    - `isOnSale` (boolean): Filter items on sale
    - `search` (string): Search by text
    - `isWearableSmart` (boolean): Filter smart wearables
    - `wearableCategory`: Filter by wearable category
    - `wearableGenders` (string[]): Filter by wearable gender
    - `emoteCategory`: Filter by emote category
    - `emotePlayMode`: Filter by emote play mode
    - `network`: Filter by network

### Orders

- `GET /v1/orders`
  - Parameters:
    - `first` (number): Number of items to return
    - `contractAddress`: Filter by contract address
    - `status`: Filter by status (`open`)
    - `itemId`: Filter by item ID
    - `sortBy`: Sort by criteria (`cheapest`)
    - `owner`: Filter by owner address
    - `buyer`: Filter by buyer address
    - `network`: Filter by network

### Bids

- `GET /v1/bids`
  - Parameters:
    - `contractAddress`: Contract address of the item
    - `itemId`: ID of the item
    - `status`: Filter by status (`open`)
    - `bidder`: Filter by bidder address
    - `seller`: Filter by seller address

### Rentals

- `GET /v1/rentals-listings`
  - Parameters:
    - `nftIds`: Array of NFT IDs to get rental information
    - `status`: Filter by rental status
    - `tenant`: Filter by tenant address
    - `lessor`: Filter by lessor address
    - `rentalDays` (number): Filter by rental period in days

## Test Endpoints Script

The repository includes a test script (`scripts/test-endpoints.js`) that helps validate the performance and functionality of the endpoints. The script:

1. Tests endpoints across different pages (Homepage, Browse, Item Detail)
2. Compares response times between local and production environments
3. Identifies slow queries (>1s response time)
4. Provides detailed performance metrics and status codes

### How to Run the Tests

You can run the tests using npm:

```bash
npm run test:endpoints
```

Or directly with node:

```bash
node scripts/test-endpoints.js
```

The script will:
- Test all configured endpoints
- Compare local vs production response times
- Show performance summaries
- Identify slow queries
- Display detailed results with status codes

### Test Output

The script provides:
- Status of each endpoint (✅ success or ❌ failure)
- Response times for both local and production environments
- Performance comparison between environments
- List of slow queries (>1s response time)
- Overall winner summary (local vs production)
- Detailed results for each endpoint

### Endpoints Tested

The script tests the following page scenarios:

#### Homepage
- Sales endpoints
- NFTs endpoints
- Catalog endpoints
- Items endpoints

#### Browse Page
- Prices endpoints
- Catalog endpoints with various sorting options

#### Item Detail Page
- Items endpoints
- Orders endpoints
- Sales endpoints
- Bids endpoints

## Development

To run the server locally:

1. Clone the repository:
```bash
git clone https://github.com/decentraland/marketplace-server.git
cd marketplace-server
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
```bash
cp .env.example .env
# Edit .env with your configuration
```

4. Run the server in development mode with hot reload:
```bash
npm run start:watch
```

For detailed development instructions, please refer to the development documentation.

## AI Agent Context

For detailed AI Agent context, see [docs/ai-agent-context.md](docs/ai-agent-context.md).