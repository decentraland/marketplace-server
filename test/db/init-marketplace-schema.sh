#!/bin/bash
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
	CREATE SCHEMA marketplace;
    
    -- CREATE THE ROLE AND ASSIGN IT TO THE PREVIOUSLY CREATED DB
    CREATE ROLE testuser WITH LOGIN PASSWORD 'testpassword';
    GRANT ALL PRIVILEGES ON SCHEMA marketplace TO testuser;

	CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
EOSQL
