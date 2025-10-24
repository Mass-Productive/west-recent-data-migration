#!/usr/bin/env node
/**
 * Lot Collection Script
 * 
 * Collects all lots (items) for auctions from auctions-weekly.json
 * 
 * Strategy:
 * 1. Load auctions from auctions-weekly.json (218 auctions)
 * 2. For each auction, fetch all lots using API with pagination
 * 3. Save lot data incrementally (one file per auction)
 * 4. Extract and collect image URLs from lots
 * 5. Track progress with checkpoint system for resume capability
 * 
 * Features:
 * - Progressive/incremental processing
 * - Checkpoint-based resume capability
 * - Rate limiting and retry logic
 * - Detailed progress reporting
 * - Graceful shutdown handling
 */

import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import FormData from 'form-data';

const CONFIG = {
  AUCTIONS_FILE: 'data/auctions-weekly.json',
  AUCTIONS_DIR: 'data/auctions',
  LOTS_DIR: 'data/lots',
  IMAGE_URLS_FILE: 'data/lot-images.txt',
  CHECKPOINT_FILE: 'data/lots-checkpoint.json',
  LOG_FILE: 'data/lots-collection.log',
  API_BASE_URL: 'https://www.westauction.com/api',
  REQUEST_DELAY_MS: 500,
  MAX_RETRIES: 3,
  RETRY_BACKOFF: [1000, 2000, 4000]
};

class LotCollector {
  constructor() {
    this.stats = {
      totalAuctions: 0,
      processedAuctions: 0,
      skippedAuctions: 0,
      totalLots: 0,
      totalImages: 0,
      uniqueImages: 0,
      errors: 0,
      startedAt: new Date().toISOString()
    };
    
    this.shouldStop = false;
    this.checkpoint = null;
    this.recordedImages = new Set();
    this.imageUrlsStream = null;
    
    this.setupGracefulShutdown();
  }

  setupGracefulShutdown() {
    const shutdown = (signal) => {
      console.log(`\n${signal} received. Finishing current operation and shutting down...`);
      this.shouldStop = true;
    };
    
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  }

  async initialize() {
    // Create directories
    if (!fsSync.existsSync(CONFIG.AUCTIONS_DIR)) {
      await fs.mkdir(CONFIG.AUCTIONS_DIR, { recursive: true });
    }
    if (!fsSync.existsSync(CONFIG.LOTS_DIR)) {
      await fs.mkdir(CONFIG.LOTS_DIR, { recursive: true });
    }
    
    // Load checkpoint if exists
    if (fsSync.existsSync(CONFIG.CHECKPOINT_FILE)) {
      const checkpointData = await fs.readFile(CONFIG.CHECKPOINT_FILE, 'utf-8');
      this.checkpoint = JSON.parse(checkpointData);
      console.log(`📂 Resuming from checkpoint: ${this.checkpoint.lastProcessedAuctionId}`);
    }
    
    // Load existing image URLs for deduplication
    if (fsSync.existsSync(CONFIG.IMAGE_URLS_FILE)) {
      const content = await fs.readFile(CONFIG.IMAGE_URLS_FILE, 'utf-8');
      const lines = content.split('\n').filter(line => line.trim());
      lines.forEach(url => this.recordedImages.add(url.trim()));
      console.log(`   Loaded ${this.recordedImages.size} existing image URLs`);
    }
    
    // Open image URLs file for appending
    this.imageUrlsStream = fsSync.createWriteStream(CONFIG.IMAGE_URLS_FILE, { flags: 'a' });
  }

  auctionExists(auctionId) {
    // Check if auction already exists in data/auctions/
    const auctionFiles = this.findAuctionFiles(auctionId);
    return auctionFiles.length > 0;
  }

  findAuctionFiles(auctionId) {
    const files = [];
    if (!fsSync.existsSync(CONFIG.AUCTIONS_DIR)) return files;
    
    const dateDirs = fsSync.readdirSync(CONFIG.AUCTIONS_DIR);
    for (const dateDir of dateDirs) {
      const auctionFile = path.join(CONFIG.AUCTIONS_DIR, dateDir, `auction_${auctionId}.json`);
      if (fsSync.existsSync(auctionFile)) {
        files.push(auctionFile);
      }
    }
    return files;
  }

  lotsExist(auctionId) {
    const lotsDir = path.join(CONFIG.LOTS_DIR, auctionId.toString());
    return fsSync.existsSync(lotsDir) && fsSync.readdirSync(lotsDir).length > 0;
  }

  async loadAuctions() {
    console.log('📖 Loading auctions from auctions-weekly.json...');
    const data = await fs.readFile(CONFIG.AUCTIONS_FILE, 'utf-8');
    const auctionsData = JSON.parse(data);
    return auctionsData.auctions || [];
  }

  async sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async fetchLotsForAuction(auctionId) {
    const allLots = [];
    let currentPage = 1;
    const MAX_PAGES = 50; // Safety limit

    while (currentPage <= MAX_PAGES) {
      const formData = new FormData();
      formData.append('page', currentPage.toString());

      const url = `${CONFIG.API_BASE_URL}/auctions/${auctionId}/items`;
      
      for (let attempt = 0; attempt <= CONFIG.MAX_RETRIES; attempt++) {
        try {
          const response = await fetch(url, {
            method: 'POST',
            body: formData
          });

          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }

          const data = await response.json();

          if (!data || !data.data || data.data.length === 0) {
            // No more lots
            return allLots;
          }

          allLots.push(...data.data);

          // Check if there are more pages
          if (data.total && allLots.length >= data.total) {
            return allLots;
          }

          if (!data.total_pages || currentPage >= data.total_pages) {
            return allLots;
          }

          currentPage++;
          
          // Rate limiting between pages
          if (currentPage <= MAX_PAGES) {
            await this.sleep(CONFIG.REQUEST_DELAY_MS);
          }
          
          break; // Success, exit retry loop
          
        } catch (err) {
          if (attempt === CONFIG.MAX_RETRIES) {
            throw err;
          }
          await this.sleep(CONFIG.RETRY_BACKOFF[attempt] || 2000);
        }
      }
    }

    return allLots;
  }

  extractImagesFromLots(lots) {
    const images = [];
    
    for (const lot of lots) {
      // Extract various image URLs from lot data
      if (lot.thumb_url) images.push(lot.thumb_url);
      if (lot.image_url) images.push(lot.image_url);
      if (lot.large_image_url) images.push(lot.large_image_url);
      
      // Check for images array
      if (Array.isArray(lot.images)) {
        lot.images.forEach(img => {
          if (typeof img === 'string') {
            images.push(img);
          } else if (img && img.url) {
            images.push(img.url);
          }
        });
      }
      
      // Check for gallery or other image fields
      if (Array.isArray(lot.gallery)) {
        lot.gallery.forEach(img => {
          if (typeof img === 'string') {
            images.push(img);
          } else if (img && img.url) {
            images.push(img.url);
          }
        });
      }
    }
    
    return images;
  }

  saveImages(images) {
    let newImages = 0;
    
    for (const url of images) {
      if (url && !this.recordedImages.has(url)) {
        this.imageUrlsStream.write(url + '\n');
        this.recordedImages.add(url);
        newImages++;
        this.stats.uniqueImages++;
      }
    }
    
    this.stats.totalImages += images.length;
    return newImages;
  }

  async saveLots(auctionId, lots) {
    const auctionDir = path.join(CONFIG.LOTS_DIR, auctionId.toString());
    
    if (!fsSync.existsSync(auctionDir)) {
      await fs.mkdir(auctionDir, { recursive: true });
    }
    
    for (const lot of lots) {
      const filename = path.join(auctionDir, `lot_${lot.id}.json`);
      const dataToSave = {
        ...lot,
        collectedAt: new Date().toISOString()
      };
      
      try {
        await fs.writeFile(filename, JSON.stringify(dataToSave, null, 2));
      } catch (err) {
        console.error(`   ⚠️  Failed to save lot ${lot.id}:`, err.message);
        this.stats.errors++;
      }
    }
  }

  async saveCheckpoint(lastProcessedAuctionId) {
    this.checkpoint = {
      lastProcessedAuctionId,
      processedCount: this.stats.processedAuctions,
      lastUpdated: new Date().toISOString(),
      stats: { ...this.stats }
    };
    
    await fs.writeFile(CONFIG.CHECKPOINT_FILE, JSON.stringify(this.checkpoint, null, 2));
  }

  async saveAuction(auction) {
    // Extract date from auction.starts field for organization
    const dateMatch = auction.starts?.match(/^(\d{4}-\d{2}-\d{2})/);
    const date = dateMatch ? dateMatch[1] : 'unknown';
    
    const dateDir = path.join(CONFIG.AUCTIONS_DIR, date);
    
    if (!fsSync.existsSync(dateDir)) {
      await fs.mkdir(dateDir, { recursive: true });
    }

    const filename = path.join(dateDir, `auction_${auction.id}.json`);
    
    // Add collection timestamp
    const dataToSave = {
      ...auction,
      collectedAt: new Date().toISOString()
    };

    try {
      await fs.writeFile(filename, JSON.stringify(dataToSave, null, 2));
    } catch (err) {
      console.error(`   ⚠️  Failed to save auction ${auction.id}:`, err.message);
      this.stats.errors++;
    }
  }

  async processAuction(auction, index, total) {
    const auctionId = auction.id;
    
    // Check if auction already exists
    if (this.auctionExists(auctionId)) {
      console.log(`   ⏩ Auction ${auctionId} already saved, checking lots...`);
      
      if (this.lotsExist(auctionId)) {
        console.log(`   ⏩ Lots already exist, skipping`);
        this.stats.skippedAuctions++;
        return;
      }
      // If auction exists but no lots, continue to fetch lots
    } else {
      // Save auction data to data/auctions/{date}/
      await this.saveAuction(auction);
    }
    
    try {
      // Fetch all lots for this auction
      const lots = await this.fetchLotsForAuction(auctionId);
      
      if (lots.length === 0) {
        console.log(`   ℹ️  No lots found for auction ${auctionId}`);
        this.stats.skippedAuctions++;
        return;
      }
      
      // Save lots to individual files
      await this.saveLots(auctionId, lots);
      this.stats.totalLots += lots.length;
      
      // Extract and save image URLs
      const images = this.extractImagesFromLots(lots);
      const newImages = this.saveImages(images);
      
      console.log(`   ✅ Auction ${auctionId}: ${lots.length} lots, ${newImages} new images`);
      
    } catch (err) {
      console.error(`   ❌ Error processing auction ${auctionId}:`, err.message);
      this.stats.errors++;
      
      // Log error details to file
      await this.logError(auctionId, err);
    }
  }

  async logError(auctionId, error) {
    const errorLog = {
      auctionId,
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    };
    
    const logEntry = JSON.stringify(errorLog) + '\n';
    await fs.appendFile(CONFIG.LOG_FILE, logEntry);
  }

  displayProgress(current, total) {
    const percentage = ((current / total) * 100).toFixed(1);
    const bar = '█'.repeat(Math.floor((current / total) * 40));
    const empty = '░'.repeat(40 - bar.length);
    
    console.log(`   [${bar}${empty}] ${current}/${total} auctions (${percentage}%)`);
  }

  async run() {
    console.log('🚀 Lot Collection Script');
    console.log('━'.repeat(70));
    
    await this.initialize();
    
    const auctions = await this.loadAuctions();
    this.stats.totalAuctions = auctions.length;
    
    console.log(`📊 Found ${auctions.length} auctions to process`);
    console.log('');
    
    // Determine starting point
    let startIndex = 0;
    if (this.checkpoint) {
      startIndex = auctions.findIndex(a => a.id === this.checkpoint.lastProcessedAuctionId) + 1;
      if (startIndex === 0) startIndex = 0; // Not found, start from beginning
      console.log(`   Resuming from auction #${startIndex + 1}`);
    }
    
    console.log('📥 Processing auctions...');
    console.log('━'.repeat(70));
    
    for (let i = startIndex; i < auctions.length; i++) {
      if (this.shouldStop) {
        console.log('\n⚠️  Graceful shutdown initiated. Saving checkpoint...');
        break;
      }
      
      const auction = auctions[i];
      
      console.log(`\n[${i + 1}/${auctions.length}] Processing Auction ${auction.id} - ${auction.title || 'N/A'}`);
      
      await this.processAuction(auction, i, auctions.length);
      this.stats.processedAuctions++;
      
      // Save checkpoint every 10 auctions
      if ((i + 1) % 10 === 0) {
        await this.saveCheckpoint(auction.id);
        this.displayProgress(i + 1, auctions.length);
      }
      
      // Rate limiting between auctions
      if (i < auctions.length - 1) {
        await this.sleep(CONFIG.REQUEST_DELAY_MS);
      }
    }
    
    // Save final checkpoint
    if (this.stats.processedAuctions > 0) {
      await this.saveCheckpoint(auctions[auctions.length - 1].id);
    }
    
    // Close file stream
    if (this.imageUrlsStream) {
      this.imageUrlsStream.end();
    }
    
    // Final report
    this.printFinalReport();
  }

  printFinalReport() {
    const duration = ((Date.now() - new Date(this.stats.startedAt).getTime()) / 1000).toFixed(1);
    
    console.log('\n');
    console.log('━'.repeat(70));
    console.log('✅ Collection Complete!');
    console.log('━'.repeat(70));
    console.log(`   Duration: ${duration}s`);
    console.log(`   Auctions Processed: ${this.stats.processedAuctions}/${this.stats.totalAuctions}`);
    console.log(`   Auctions Skipped: ${this.stats.skippedAuctions} (no lots)`);
    console.log(`   Total Lots Collected: ${this.stats.totalLots}`);
    console.log(`   Total Images Found: ${this.stats.totalImages}`);
    console.log(`   Unique Images: ${this.stats.uniqueImages}`);
    console.log(`   Errors: ${this.stats.errors}`);
    console.log('');
    console.log('📂 Output:');
    console.log(`   Lots Directory: ${CONFIG.LOTS_DIR}/`);
    console.log(`   Image URLs: ${CONFIG.IMAGE_URLS_FILE}`);
    console.log(`   Checkpoint: ${CONFIG.CHECKPOINT_FILE}`);
    if (this.stats.errors > 0) {
      console.log(`   Error Log: ${CONFIG.LOG_FILE}`);
    }
    console.log('━'.repeat(70));
  }
}

// Run the collector
const collector = new LotCollector();
collector.run().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

