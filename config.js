/**
 * Configuration for West Auction Data Collection
 * 
 * REVISED STRATEGY: Pagination-based collection (not date iteration)
 * See docs/phase1-revised-prd.md for details
 */

export default {
  // API Configuration
  API_BASE_URL: 'https://www.westauction.com/api',
  
  // Date Filtering (applied locally after fetching all auctions)
  START_DATE: '2024-10-07',  // Only process auctions starting on or after this date
  
  // Rate Limiting & Retry
  REQUEST_DELAY_MS: 300,        // 300ms between requests
  MAX_RETRIES: 3,
  RETRY_BACKOFF: [1000, 2000, 4000], // ms for each retry attempt
  
  // Data Storage
  DATA_DIR: './data',
  AUCTIONS_DIR: './data/auctions',
  LOTS_DIR: './data/lots',
  IMAGE_URLS_FILE: './data/image_urls.txt',
  CHECKPOINT_FILE: './data/checkpoint.json',
  LOG_FILE: './data/collection.log',
  
  // Progress Tracking
  LOG_EVERY_N_AUCTIONS: 5,      // Progress update frequency
  
  // Batch Processing Configuration
  BATCH_MODE: true,              // Enable batch mode for incremental collection
  BATCH_SIZE: 1500,              // Pages per batch (1500 pages = ~10-15 min, more efficient)
  
  // Testing/Limiting
  TEST_MODE: false,
  MAX_PAGES_TO_FETCH: null,
  
  // CloudFront URL Pattern
  CLOUDFRONT_DOMAIN: 'd278yjzsv5tla9.cloudfront.net',
  CLOUDFRONT_URL_PATTERN: /^https:\/\/d278yjzsv5tla9\.cloudfront\.net\//
};
