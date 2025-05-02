# Valkey Proxy Server

A proxy server for interacting with Valkey (Redis-compatible) ElastiCache on AWS.

## Overview

This service provides an HTTP interface to Redis operations, specifically designed to handle Redis Cluster properly, including dealing with slot redirections and connection management.

## ERR MOVED Error Resolution

The "ERR MOVED 9412" error occurs in Redis Cluster when a key belongs to a hash slot managed by a different node than the one you're connecting to. This proxy server has been configured to handle these redirections automatically with the following improvements:

1. **Enhanced Redis Cluster Configuration**:

   - Added `maxRedirections: 16` to allow the client to follow MOVED redirections
   - Set `enableReadyCheck: true` to ensure the cluster is properly checked
   - Added retry strategies and connection timeout configurations
   - Added `clusterRetryStrategy` for better resilience

2. **Improved Error Handling**:

   - Better error logging and reporting
   - Batch processing for large key operations
   - Added health check endpoint

3. **Input Validation**:
   - Added validation for required parameters
   - Proper JSON stringify for non-string values

## API Endpoints

- `GET /` - Check if the service is running
- `GET /health` - Check Redis connection health
- `POST /get` - Get a value by key
- `POST /set` - Set a key-value pair
- `POST /invalidate` - Delete keys matching a pattern

## Usage

### Installation

```bash
npm install
```

### Testing Redis Connection

```bash
npm run test:connection
```

### Starting the Server

```bash
npm start
```

Or in development mode with auto-restart:

```bash
npm run dev
```

## API Examples

### Get a value

```bash
curl -X POST http://localhost:3000/get \
  -H "Content-Type: application/json" \
  -d '{"key":"your:key"}'
```

### Set a value

```bash
curl -X POST http://localhost:3000/set \
  -H "Content-Type: application/json" \
  -d '{"key":"your:key", "value":"your value"}'
```

### Invalidate cache entries

```bash
curl -X POST http://localhost:3000/invalidate \
  -H "Content-Type: application/json" \
  -d '{"pattern":"your:prefix:*"}'
```

## Troubleshooting

If you encounter Redis connection issues:

1. Run the connection test script: `npm run test:connection`
2. Check ElastiCache endpoint and security group settings
3. Verify TLS configuration if using encrypted connections
4. Check the Redis logs for more detailed error information
