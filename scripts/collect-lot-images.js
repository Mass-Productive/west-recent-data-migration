#!/usr/bin/env node
/**
 * Collect Lot Images Script
 * 
 * Fetches detailed image data for each lot from the /images endpoint
 * Saves as lot_{id}_images.json alongside each lot file
 * 
 * Features:
 * - Progressive/incremental processing
 * - Checkpoint-based resume capability
 * - Rate limiting
 * - Skip already processed lots
 * - Detailed progress reporting
 */

import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import fetch from 'node-fetch';

const CONFIG = {
  LOTS_DIR: 'data/lots',
  CHECKPOINT_FILE: 'data/images-checkpoint.json',
  LOG_FILE: 'data/images-collection.log',
  REQUEST_DELAY_MS: 300, // 300ms between requests (faster than auction fetching)
  MAX_RETRIES: 3,
  RETRY_BACKOFF: [1000, 2000, 4000]
};

class ImageCollector {
  constructor() {
    this.stats = {
      totalLots: 0,
      processedLots: 0,
      skippedLots: 0,
      totalImages: 0,
      errors: 0,
      startedAt: new Date().toISOString()
    };
    
    this.shouldStop = false;
    this.checkpoint = null;
    this.processedLots = new Set();
    
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
    // Load checkpoint if exists
    if (fsSync.existsSync(CONFIG.CHECKPOINT_FILE)) {
      const checkpointData = await fs.readFile(CONFIG.CHECKPOINT_FILE, 'utf-8');
      this.checkpoint = JSON.parse(checkpointData);
      console.log(`📂 Resuming from checkpoint: ${this.checkpoint.lastProcessedLot}`);
      
      // Load processed lots set
      if (this.checkpoint.processedLots) {
        this.checkpoint.processedLots.forEach(lotId => this.processedLots.add(lotId));
        console.log(`   Loaded ${this.processedLots.size} processed lots`);
      }
    }
  }

  async getAllLotFiles() {
    const lotFiles = [];
    const auctionDirs = await fs.readdir(CONFIG.LOTS_DIR);
    
    for (const auctionId of auctionDirs) {
      const auctionPath = path.join(CONFIG.LOTS_DIR, auctionId);
      const stat = await fs.stat(auctionPath);
      
      if (!stat.isDirectory()) continue;
      
      const files = await fs.readdir(auctionPath);
      for (const file of files) {
        if (file.startsWith('lot_') && file.endsWith('.json') && !file.endsWith('_images.json')) {
          lotFiles.push({
            auctionId,
            filePath: path.join(auctionPath, file),
            fileName: file
          });
        }
      }
    }
    
    return lotFiles;
  }

  async sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async fetchImagesForLot(auctionId, lotId) {
    const url = `https://www.westauction.com/api/auctions/${auctionId}/items/${lotId}/images`;
    
    for (let attempt = 0; attempt <= CONFIG.MAX_RETRIES; attempt++) {
      try {
        const response = await fetch(url, {
          method: 'GET'
        });

        if (response.status === 404) {
          // No images for this lot
          return { result: 'success', data: [] };
        }

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        return data;
        
      } catch (err) {
        if (attempt === CONFIG.MAX_RETRIES) {
          throw err;
        }
        await this.sleep(CONFIG.RETRY_BACKOFF[attempt] || 2000);
      }
    }
    
    return null;
  }

  async processLot(lotFile) {
    try {
      // Read lot file
      const lotData = JSON.parse(await fs.readFile(lotFile.filePath, 'utf-8'));
      const lotId = lotData.id;
      const auctionId = lotData.auction_id;
      
      // Check if already processed
      if (this.processedLots.has(lotId)) {
        this.stats.skippedLots++;
        return;
      }
      
      // Check if images file already exists
      const imagesFilePath = lotFile.filePath.replace('.json', '_images.json');
      if (fsSync.existsSync(imagesFilePath)) {
        this.stats.skippedLots++;
        this.processedLots.add(lotId);
        return;
      }
      
      // Fetch images from API
      const imagesData = await this.fetchImagesForLot(auctionId, lotId);
      
      if (!imagesData) {
        throw new Error('Failed to fetch images after retries');
      }
      
      // Add metadata
      const outputData = {
        ...imagesData,
        lotId: lotId,
        auctionId: auctionId,
        collectedAt: new Date().toISOString()
      };
      
      // Save images data
      await fs.writeFile(imagesFilePath, JSON.stringify(outputData, null, 2));
      
      // Update stats
      this.stats.processedLots++;
      this.processedLots.add(lotId);
      
      if (imagesData.data && imagesData.data.length > 0) {
        this.stats.totalImages += imagesData.data.length;
        return imagesData.data.length;
      }
      
      return 0;
      
    } catch (err) {
      console.error(`   ❌ Error processing lot ${lotFile.fileName}:`, err.message);
      this.stats.errors++;
      await this.logError(lotFile.fileName, err);
      return 0;
    }
  }

  async logError(lotFile, error) {
    const errorLog = {
      lotFile,
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    };
    
    const logEntry = JSON.stringify(errorLog) + '\n';
    await fs.appendFile(CONFIG.LOG_FILE, logEntry);
  }

  async saveCheckpoint(lastProcessedLot) {
    this.checkpoint = {
      lastProcessedLot,
      processedCount: this.stats.processedLots,
      processedLots: Array.from(this.processedLots),
      lastUpdated: new Date().toISOString(),
      stats: { ...this.stats }
    };
    
    await fs.writeFile(CONFIG.CHECKPOINT_FILE, JSON.stringify(this.checkpoint, null, 2));
  }

  displayProgress(current, total) {
    const percentage = ((current / total) * 100).toFixed(1);
    const bar = '█'.repeat(Math.floor((current / total) * 40));
    const empty = '░'.repeat(40 - bar.length);
    
    console.log(`   [${bar}${empty}] ${current}/${total} lots (${percentage}%)`);
    console.log(`   Processed: ${this.stats.processedLots} | Skipped: ${this.stats.skippedLots} | Images: ${this.stats.totalImages} | Errors: ${this.stats.errors}`);
  }

  async run() {
    console.log('🚀 Lot Images Collection Script');
    console.log('━'.repeat(70));
    
    await this.initialize();
    
    console.log('📁 Scanning lot files...');
    const lotFiles = await this.getAllLotFiles();
    this.stats.totalLots = lotFiles.length;
    
    console.log(`📊 Found ${lotFiles.length} lot files to process`);
    console.log('');
    
    // Determine starting point
    let startIndex = 0;
    if (this.checkpoint && this.checkpoint.lastProcessedLot) {
      startIndex = lotFiles.findIndex(f => f.fileName.includes(this.checkpoint.lastProcessedLot));
      if (startIndex > 0) {
        console.log(`   Resuming from lot #${startIndex + 1}`);
      }
    }
    
    console.log('📥 Processing lots...');
    console.log('━'.repeat(70));
    
    const batchSize = 100; // Report progress every 100 lots
    let batchCount = 0;
    
    for (let i = startIndex; i < lotFiles.length; i++) {
      if (this.shouldStop) {
        console.log('\n⚠️  Graceful shutdown initiated. Saving checkpoint...');
        break;
      }
      
      const lotFile = lotFiles[i];
      const imageCount = await this.processLot(lotFile);
      
      batchCount++;
      
      // Show progress every batch
      if (batchCount >= batchSize || i === lotFiles.length - 1) {
        console.log(`\n[${i + 1}/${lotFiles.length}] Processed ${batchCount} lots`);
        if (imageCount > 0) {
          console.log(`   Last lot: ${lotFile.fileName} (${imageCount} images)`);
        }
        this.displayProgress(i + 1, lotFiles.length);
        
        // Save checkpoint
        await this.saveCheckpoint(lotFile.fileName);
        
        batchCount = 0;
      }
      
      // Rate limiting
      if (i < lotFiles.length - 1) {
        await this.sleep(CONFIG.REQUEST_DELAY_MS);
      }
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
    console.log(`   Total Lots: ${this.stats.totalLots}`);
    console.log(`   Processed: ${this.stats.processedLots}`);
    console.log(`   Skipped: ${this.stats.skippedLots} (already had images)`);
    console.log(`   Total Images Collected: ${this.stats.totalImages}`);
    console.log(`   Errors: ${this.stats.errors}`);
    console.log('');
    console.log('📂 Output:');
    console.log(`   Images saved as: data/lots/{auctionId}/lot_{lotId}_images.json`);
    console.log(`   Checkpoint: ${CONFIG.CHECKPOINT_FILE}`);
    if (this.stats.errors > 0) {
      console.log(`   Error Log: ${CONFIG.LOG_FILE}`);
    }
    console.log('━'.repeat(70));
    
    // Calculate stats
    if (this.stats.processedLots > 0) {
      const avgImages = (this.stats.totalImages / this.stats.processedLots).toFixed(1);
      console.log(`\n📊 Statistics:`);
      console.log(`   Average images per lot: ${avgImages}`);
      console.log(`   Processing rate: ${(this.stats.processedLots / parseFloat(duration)).toFixed(1)} lots/second`);
    }
  }
}

// Run the collector
const collector = new ImageCollector();
collector.run().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

