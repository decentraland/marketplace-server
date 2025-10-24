# Server Configuration
HTTP_SERVER_HOST=localhost
HTTP_SERVER_PORT=3000
CORS_ORIGIN=.*
CORS_METHODS=GET,POST,PUT,DELETE,PATCH

# Database Configuration - Connection Strings
FAVORITES_PG_COMPONENT_PSQL_CONNECTION_STRING=postgres://marketplace_admin:marketplace_password@127.0.0.1:5432/marketplace
FAVORITES_PG_COMPONENT_PSQL_SCHEMA=favorites

DAPPS_PG_COMPONENT_PSQL_CONNECTION_STRING=postgres://dapps_admin:dapps_password@127.0.0.1:5433/dapps_test
DAPPS_PG_COMPONENT_PSQL_SCHEMA=marketplace

DAPPS_READ_PG_COMPONENT_PSQL_CONNECTION_STRING=postgres://dapps_admin:dapps_password@127.0.0.1:5433/dapps_test
DAPPS_READ_PG_COMPONENT_PSQL_SCHEMA=marketplace

# Snapshot Configuration
SNAPSHOT_URL=https://score.snapshot.org/
SNAPSHOT_NETWORK=11155111
SNAPSHOT_SPACE=daotest.dcl.eth

# External Services
DCL_LISTS_SERVER=https://dcl-lists.decentraland.org
RENTALS_SUBGRAPH_URL=https://api.studio.thegraph.com/query/49472/rentals-ethereum-mainnet/version/latest
SIGNATURES_SERVER_URL=https://signatures-api.decentraland.zone
SEGMENT_WRITE_KEY=test_segment_key

# Wert Configuration
WERT_PRIVATE_KEY=0x0000000000000000000000000000000000000000000000000000000000000001
WERT_PUBLICATION_FEES_PRIVATE_KEY=0x0000000000000000000000000000000000000000000000000000000000000002

# Transak Configuration
TRANSAK_API_URL=https://api.transak.com
TRANSAK_API_GATEWAY_URL=https://api-gateway.transak.com
TRANSAK_API_KEY=test_key
TRANSAK_API_SECRET=test_secret
MARKETPLACE_BASE_URL=https://market.decentraland.org

# Optional Redis (will use in-memory cache if not set)
# REDIS_URL=
