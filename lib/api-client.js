/**
 * West Auction API Client
 * 
 * Handles all API interactions with:
 * - Retry logic with exponential backoff
 * - Automatic pagination detection and handling
 * - Rate limiting
 * - Error handling
 */

import fetch from 'node-fetch';
import FormData from 'form-data';
import config from '../config.js';

class APIClient {
  constructor(logger) {
    this.logger = logger;
    this.baseUrl = config.API_BASE_URL;
    this.requestDelay = config.REQUEST_DELAY_MS;
    this.maxRetries = config.MAX_RETRIES;
    this.retryBackoff = config.RETRY_BACKOFF;
    this.lastRequestTime = 0;
  }

  /**
   * Rate limiting - ensure minimum delay between requests
   */
  async rateLimit() {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    
    if (timeSinceLastRequest < this.requestDelay) {
      const delayNeeded = this.requestDelay - timeSinceLastRequest;
      await this.sleep(delayNeeded);
    }
    
    this.lastRequestTime = Date.now();
  }

  async sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Fetch all auctions using pagination
   * Fetches both past_sales=true and past_sales=false to get complete coverage
   * @returns {Array} - Array of all auction objects (deduplicated)
   */
  async fetchAllAuctions() {
    const allAuctions = new Map(); // Use Map for deduplication by ID

    // Fetch past sales (closed auctions)
    this.logger.info('Fetching past sales auctions...');
    const pastSales = await this.fetchAuctionSet(true);
    pastSales.forEach(auction => allAuctions.set(auction.id, auction));
    this.logger.info(`  ✓ Past sales: ${pastSales.length} auctions`);

    // Fetch current auctions (active/upcoming)
    this.logger.info('Fetching current auctions...');
    const currentAuctions = await this.fetchAuctionSet(false);
    currentAuctions.forEach(auction => allAuctions.set(auction.id, auction));
    this.logger.info(`  ✓ Current auctions: ${currentAuctions.length} auctions`);

    const uniqueAuctions = Array.from(allAuctions.values());
    this.logger.info(`  ✓ Total unique auctions: ${uniqueAuctions.length}`);

    return uniqueAuctions;
  }

  /**
   * Fetch a set of auctions with specific past_sales parameter
   * @param {boolean} pastSales - Whether to fetch past sales
   * @returns {Array} - Array of auction objects
   */
  async fetchAuctionSet(pastSales) {
    const auctions = [];
    let currentPage = 1;
    let hasMorePages = true;
    const maxPages = config.TEST_MODE && config.MAX_PAGES_TO_FETCH ? config.MAX_PAGES_TO_FETCH : 1000; // Safety: max 1000 pages for faster collection
    let consecutiveEmptyPages = 0;

    if (config.TEST_MODE && config.MAX_PAGES_TO_FETCH) {
      this.logger.info(`  ⚠️  TEST MODE: Limiting to ${maxPages} pages`);
    }

    while (hasMorePages && currentPage <= maxPages && consecutiveEmptyPages < 3) {
      const formData = new FormData();
      formData.append('past_sales', pastSales.toString());
      formData.append('meta_also', 'true');
      formData.append('page', currentPage.toString());

      const data = await this.makeRequest(
        `${this.baseUrl}/auctions`,
        {
          method: 'POST',
          body: formData
        },
        `Fetching auctions (past_sales=${pastSales}, page ${currentPage}/${maxPages === Infinity ? '?' : maxPages})`
      );

      if (!data || !data.data) {
        this.logger.warn(`No data returned for past_sales=${pastSales}, page ${currentPage}`);
        consecutiveEmptyPages++;
        if (consecutiveEmptyPages >= 3) {
          this.logger.info(`  ✓ Stopping after 3 consecutive empty pages`);
          break;
        }
        currentPage++;
        continue;
      }

      if (data.data.length === 0) {
        consecutiveEmptyPages++;
        if (consecutiveEmptyPages >= 3) {
          this.logger.info(`  ✓ Stopping after 3 consecutive empty pages`);
          break;
        }
      } else {
        consecutiveEmptyPages = 0; // Reset counter on successful page
        auctions.push(...data.data);
      }

      // Check if we hit test limit
      if (currentPage >= maxPages) {
        this.logger.info(`  ✓ Reached page limit (${maxPages})`);
        break;
      }

      // Check for pagination
      hasMorePages = this.hasMorePages(data, currentPage);
      
      if (hasMorePages) {
        currentPage++;
        this.logger.debug(`Found more pages, fetching page ${currentPage}`);
      } else {
        // Check if we should continue based on total pages
        if (data.total_pages && currentPage < data.total_pages) {
          currentPage++;
          hasMorePages = true;
        }
      }
    }

    return auctions;
  }

  /**
   * Fetch all items/lots for a specific auction
   * @param {number} auctionId - Auction ID
   * @returns {Array} - Array of lot objects
   */
  async fetchAuctionItems(auctionId) {
    const allItems = [];
    let currentPage = 1;
    let hasMorePages = true;
    const MAX_ITEM_PAGES = 50; // Safety limit: max 50 pages per auction (~1500 items)

    while (hasMorePages && currentPage <= MAX_ITEM_PAGES) {
      const formData = new FormData();
      formData.append('page', currentPage.toString());

      const data = await this.makeRequest(
        `${this.baseUrl}/auctions/${auctionId}/items`,
        {
          method: 'POST',
          body: formData
        },
        `Fetching items for auction ${auctionId} (page ${currentPage})`
      );

      if (!data || !data.data) {
        this.logger.warn(`No items returned for auction ${auctionId}, page ${currentPage}`);
        break;
      }

      // If we got 0 items, stop
      if (data.data.length === 0) {
        this.logger.debug(`No more items for auction ${auctionId}`);
        break;
      }

      allItems.push(...data.data);

      // Safety check: if we hit the page limit
      if (currentPage >= MAX_ITEM_PAGES) {
        this.logger.warn(`Hit safety limit of ${MAX_ITEM_PAGES} pages for auction ${auctionId}. Collected ${allItems.length} items.`);
        break;
      }

      // Check for pagination - use total from API if available
      if (data.total && allItems.length >= data.total) {
        this.logger.debug(`Collected all ${data.total} items for auction ${auctionId}`);
        break;
      }

      // Check for pagination
      hasMorePages = this.hasMorePages(data, currentPage);
      
      if (hasMorePages) {
        currentPage++;
        this.logger.debug(`Found more items, fetching page ${currentPage}`);
      }
    }

    return allItems;
  }

  /**
   * Determine if there are more pages to fetch
   * Note: API pagination metadata (total_pages) is unreliable, so we use
   * aggressive pagination based on data presence
   */
  hasMorePages(data, currentPage) {
    // If we got any data, assume there might be more
    // The API's total_pages field is unreliable (often underreports)
    if (data.data && data.data.length > 0) {
      // If we got a full page (perpage amount), definitely continue
      if (data.perpage && data.data.length >= data.perpage) {
        return true;
      }
      
      // If we got 10+ items, likely more pages (typical page size is 12)
      if (data.data.length >= 10) {
        return true;
      }
      
      // If we got fewer items but still some, check if we reached total
      if (data.total) {
        // Calculate how many items we should have fetched by now
        const expectedItems = currentPage * (data.perpage || 12);
        // If we haven't reached the total yet, continue
        if (expectedItems < data.total) {
          return true;
        }
      }
      
      // Even with small page, give it one more try
      // (API might have inconsistent page sizes)
      if (data.data.length >= 5) {
        return true;
      }
    }

    // Only stop if we got 0 items
    return false;
  }

  /**
   * Make HTTP request with retry logic
   * @param {string} url - Full URL
   * @param {Object} options - Fetch options
   * @param {string} description - Human-readable description for logging
   * @returns {Object} - Parsed JSON response
   */
  async makeRequest(url, options, description) {
    await this.rateLimit();

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        this.logger.debug(`${description} (attempt ${attempt + 1}/${this.maxRetries + 1})`);

        const response = await fetch(url, options);

        // Handle different HTTP status codes
        if (response.status === 404) {
          this.logger.warn(`404 Not Found: ${description}`);
          return null;
        }

        if (response.status === 429) {
          // Rate limited
          const retryAfter = response.headers.get('retry-after') || 60;
          this.logger.warn(`Rate limited (429). Waiting ${retryAfter} seconds...`);
          await this.sleep(retryAfter * 1000);
          continue;
        }

        if (response.status >= 500) {
          // Server error - retry
          throw new Error(`Server error: ${response.status} ${response.statusText}`);
        }

        if (!response.ok) {
          throw new Error(`HTTP error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        return data;

      } catch (err) {
        const isLastAttempt = attempt === this.maxRetries;
        
        if (isLastAttempt) {
          this.logger.error(`Failed after ${this.maxRetries + 1} attempts: ${description}`, err);
          return null;
        }

        // Exponential backoff
        const backoffTime = this.retryBackoff[attempt] || 4000;
        this.logger.warn(`Request failed (attempt ${attempt + 1}), retrying in ${backoffTime}ms: ${err.message}`);
        await this.sleep(backoffTime);
      }
    }

    return null;
  }
}

export default APIClient;

