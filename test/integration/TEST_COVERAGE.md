# Test Coverage Documentation

## Overview
This document provides a comprehensive overview of all test cases covered in the Decentraland Marketplace Server integration tests for **Catalog** and **NFTs** controllers.

## 📁 Catalog Controller Tests (`catalog-controller.spec.ts`)

### ✅ Basic Endpoint Functionality

#### Response Structure
- **Valid response structure for v1**: Verifies that `/v1/catalog` returns proper JSON structure with `data` and `total` fields
- **Valid response structure for v2**: Verifies that `/v2/catalog` returns proper JSON structure with `data` and `total` fields  
- **Items with required fields**: Ensures returned items contain all mandatory fields (`id`, `itemId`, `contractAddress`, `category`, `rarity`, `isOnSale`, `price`)

### 🔍 Item State Filtering

#### onlyMinting Filter
- **Only minting items when onlyMinting=true**: Returns items that are only available for minting (not secondary market)
- **v2 endpoint for minting**: Validates that both v1 and v2 endpoints support minting filters

#### onlyListing Filter  
- **Only listing items when onlyListing=true**: Returns items that are only available on secondary market listings
- **v2 endpoint for listing**: Validates that both v1 and v2 endpoints support listing filters

#### isOnSale Filter
- **Items on sale when isOnSale=true**: Returns all items available for purchase (minting + listing)
- **Items not on sale when isOnSale=false**: Returns items that are not currently purchasable

### 🔐 Collection Approval Filtering
- **Only approved collection items by default**: Filters out items from non-approved collections automatically
- **Approval filtering on both v1 and v2**: Ensures approval logic works consistently across API versions

### 💰 Price Filtering
- **Filter by minimum price**: Tests `minPrice` parameter to return only items above specified threshold
- **Filter by maximum price**: Tests `maxPrice` parameter to return only items below specified threshold  
- **Filter by price range**: Tests combined `minPrice` and `maxPrice` for range filtering

### 📄 Contract Address Filtering
- **Filter by single contract address**: Returns items from one specific contract
- **Filter by multiple contract addresses**: Returns items from multiple specified contracts
- **Empty results for non-existent contract**: Handles gracefully when filtering by non-existent contracts

### 📖 Pagination and Sorting
- **Respect limit parameter**: Tests result limiting functionality
- **Respect first parameter**: Tests pagination with `first` parameter
- **Respect skip parameter**: Tests pagination with `skip` parameter for offset
- **Sort by cheapest price (default)**: Validates ascending price sorting
- **Sort by most expensive**: Validates descending price sorting

### 🔀 Combined Filters
- **Multiple filters (onlyMinting + contractAddress)**: Tests filter combination logic
- **Multiple filters (isOnSale + price range)**: Tests complex filtering scenarios
- **Pagination on filtered results**: Ensures pagination works correctly with applied filters

### 🛠️ Edge Cases and Error Handling
- **Empty results gracefully**: Handles queries that return no results
- **Invalid price parameters**: Tests API behavior with malformed price inputs
- **Large pagination values**: Tests behavior with extreme pagination parameters
- **Conflicting filters**: Tests mutually exclusive filter combinations

---

## 🎨 NFTs Controller Tests (`nfts-controller.spec.ts`)

### ✅ Response Structure Validation

#### Basic Response Validation
- **Valid response structure**: Ensures `/v1/nfts` returns proper JSON with `data` and `total` fields
- **NFTs with required fields**: Validates that NFT objects contain mandatory properties (`id`, `tokenId`, `contractAddress`, `category`, `owner`, `name`, `image`)

### 💸 Sale Status Filtering  

#### On Sale vs Not On Sale
- **Only NFTs on sale when isOnSale=true**: Returns NFTs that have active orders/listings
- **Only NFTs not on sale when isOnSale=false**: Returns NFTs without active orders/listings

#### Sale Status Tests
- ✅ **Basic On Sale Filtering**: Tests NFTs with different sale statuses
  - Should return NFTs on sale via orders when `isOnSale=true`
  - Should return NFTs on sale via trades when `isOnSale=true` (New)
  - Should return both order-based and trade-based sales when `isOnSale=true` (New)  
  - Should return only NFTs not on sale when `isOnSale=false` (Updated)
  - Verifies trade-based NFTs have correct price and tradeId
  - Tests integration with mv_trades materialized view

### 📂 Category Filtering

#### Different NFT Categories
- **Only wearable NFTs when filtering by wearable**: Returns fashion/avatar items
- **Only parcel NFTs when filtering by parcel**: Returns individual land pieces  
- **Only estate NFTs when filtering by estate**: Returns grouped land properties

### 👤 Owner Filtering

#### Ownership-based Queries
- **Only NFTs from specified owner**: Returns NFTs belonging to a specific wallet address
- **Empty results for non-existent owner**: Handles gracefully when owner has no NFTs

### 💰 Price Filtering

#### Price Range Queries
- **Only NFTs above minimum price**: Tests `minPrice` parameter functionality
- **Only NFTs below maximum price**: Tests `maxPrice` parameter functionality  
- **Only NFTs within price range**: Tests combined price range filtering

### 📋 Contract Address Filtering

#### Contract-specific Queries
- **Only NFTs from specified contract**: Returns NFTs from one specific collection contract
- **Empty results for non-existent contract**: Handles queries for non-existent contracts gracefully

### 🔍 Token ID Filtering

#### Specific Asset Queries
- **Only specified NFT when filtering by token ID and contract**: Returns exact NFT match using token ID + contract combination

### 🔎 Search Term Filtering

#### Text-based Search
- **Only matching NFTs when searching by name**: Tests text search functionality against NFT names

### 🏞️ Land-specific Property Filtering

#### LAND/Estate Specific Features
- **Only land NFTs when filtering by isLand**: Returns parcels and estates only
- **Only road-adjacent NFTs**: Returns land pieces adjacent to roads
- **Only near plaza NFTs**: Returns land within specified distance from Genesis Plaza
- **Only large estates**: Returns estates above minimum size threshold

### 📖 Pagination and Sorting

#### Result Management
- **Respect first parameter**: Tests result limiting with `first` parameter
- **Respect skip parameter**: Tests pagination offset with `skip` parameter  
- **Handle sorting by newest**: Tests chronological sorting (newest first)
- **Handle sorting by oldest**: Tests chronological sorting (oldest first)

### 🌐 Network Filtering

#### Blockchain Network Queries
- **Only NFTs from specified network**: Filters by blockchain network (Ethereum, Polygon, etc.)

### ⭐ Rarity Filtering

#### Rarity-based Queries  
- **Only NFTs of specified rarity**: Returns NFTs with specific rarity levels (common, rare, epic, etc.)

### 🔀 Combined Filters

#### Complex Filter Combinations
- **NFTs matching multiple filters (isOnSale + owner)**: Tests combining sale status with ownership
- **NFTs matching multiple filters (category + contractAddress)**: Tests combining category with contract filtering
- **Pagination on filtered results**: Ensures pagination works with applied filters

### 🛠️ Edge Cases and Error Handling

#### Robust Error Handling
- **Empty results gracefully**: Handles queries returning no results
- **Invalid price parameters**: Tests behavior with malformed price inputs
- **Large pagination values**: Tests extreme pagination parameter values
- **Invalid address parameters**: Tests behavior with malformed wallet addresses
- **Invalid category parameters**: Tests behavior with non-existent categories
- **Error when tokenId without contractAddress**: Validates required parameter combinations
- **Error when both owner and tenant provided**: Tests mutually exclusive parameter validation
- **Error when tokenId contains non-numeric characters**: Validates tokenId format requirements
  - **Error when tokenId with invalid contractAddress**: Tests address validation requirements

#### Rental Assets Integration
- ✅ **Rental Assets in Owner Filtering**: Tests advanced owner filtering with rental functionality 
  - Should return rental assets when owner is lessor (via subgraph mock)
  - Should work with land-specific filtering (isLand=true, category=estate)
  - Verifies NFTs in rentals contract are included in results  
  - Tests mock integration with rentals subgraph service
  - Validates that NFTs owned by rentals contract are returned when user is the lessor

---

## 🧪 Test Infrastructure

### Test Setup & Cleanup
- **Comprehensive beforeEach/afterEach**: Proper test isolation with data setup and cleanup
- **Mock external services**: Mocked Signatures API, Rentals Subgraph, and other external dependencies
- **Database test utilities**: Helper functions for creating and deleting test data

### Data Scenarios Covered
- **Multiple item states**: Minting-only, listing-only, hybrid (both), not-for-sale
- **Price variations**: Cheap (10 MANA), moderate (50-100 MANA), expensive (1000+ MANA)
- **Different categories**: Wearables, parcels, estates, emotes, etc.
- **Various owners**: Multiple test wallet addresses
- **Land properties**: Distance to plaza, road adjacency, estate sizes
- **Network variants**: Ethereum, Polygon network assets
- **Rarity levels**: Common, uncommon, rare, epic, legendary, unique

---

## 📊 Coverage Metrics

### Catalog Controller
- **7 main feature areas** covered
- **25+ individual test cases**  
- **Both v1 and v2 API versions** tested
- **All filter combinations** validated

### NFTs Controller  
- **12 main feature areas** covered
- **38+ individual test cases**
- **Complex land-specific features** tested
- **Comprehensive error handling** validated
