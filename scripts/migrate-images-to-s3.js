#!/usr/bin/env node

/**
 * West Auction Image Migration to AWS S3
 * 
 * Features:
 * - Streams images directly from CloudFront to S3 (no local saving)
 * - Concurrent uploads (configurable)
 * - Automatic resume from checkpoint
 * - Fault tolerant with retry logic
 * - Progress monitoring and reporting
 * - Graceful shutdown handling
 */

import { S3Client, HeadObjectCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import fetch from 'node-fetch';
import { promises as fs } from 'fs';
import { createWriteStream } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import config from '../config.js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const REGION = config.AWS_REGION;
const BUCKET_NAME = config.S3_BUCKET_NAME;
const CONCURRENT_UPLOADS = config.CONCURRENT_UPLOADS;
const BATCH_SIZE = config.MIGRATION_BATCH_SIZE;
const CHECKPOINT_FILE = config.MIGRATION_CHECKPOINT_FILE;
const LOG_FILE = config.MIGRATION_LOG_FILE;
const ERROR_LOG_FILE = config.MIGRATION_ERROR_LOG_FILE;
const LOG_EVERY_N_IMAGES = config.LOG_EVERY_N_IMAGES;
const CHECKPOINT_EVERY_N_IMAGES = config.CHECKPOINT_EVERY_N_IMAGES;
const UPLOAD_TIMEOUT_MS = config.UPLOAD_TIMEOUT_MS;
const DOWNLOAD_TIMEOUT_MS = config.DOWNLOAD_TIMEOUT_MS;
const MAX_RETRIES = config.MAX_UPLOAD_RETRIES;
const RETRY_BACKOFF = config.UPLOAD_RETRY_BACKOFF_MS;

// Global state
let s3Client;
let checkpoint = {
  processedLotFiles: new Set(),
  uploadedImages: new Set(),
  successfulUploads: 0,
  failedUploads: 0,
  skippedUploads: 0,
  totalImages: 0,
  totalLotFiles: 0,
  failures: [],
  startedAt: null,
  lastUpdated: null,
  bytesTransferred: 0,
};

let stats = {
  startTime: Date.now(),
  lastLogTime: Date.now(),
  imagesSinceLastLog: 0,
};

let shutdownRequested = false;
let logStream;
let errorLogStream;

/**
 * Create S3 client
 */
function createS3Client() {
  const clientConfig = {
    region: REGION,
    maxAttempts: MAX_RETRIES,
  };

  if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
    clientConfig.credentials = {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    };
  }

  return new S3Client(clientConfig);
}

/**
 * Initialize log files
 */
async function initializeLogs() {
  await fs.mkdir(path.dirname(LOG_FILE), { recursive: true });
  logStream = createWriteStream(LOG_FILE, { flags: 'a' });
  errorLogStream = createWriteStream(ERROR_LOG_FILE, { flags: 'a' });
}

/**
 * Log to console and file
 */
function log(message, isError = false) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}\n`;
  
  console.log(message);
  logStream.write(logMessage);
  
  if (isError) {
    errorLogStream.write(logMessage);
  }
}

/**
 * Load checkpoint from file
 */
async function loadCheckpoint() {
  try {
    const data = await fs.readFile(CHECKPOINT_FILE, 'utf8');
    const saved = JSON.parse(data);
    
    checkpoint.processedLotFiles = new Set(saved.processedLotFiles || []);
    checkpoint.uploadedImages = new Set(saved.uploadedImages || []);
    checkpoint.successfulUploads = saved.successfulUploads || 0;
    checkpoint.failedUploads = saved.failedUploads || 0;
    checkpoint.skippedUploads = saved.skippedUploads || 0;
    checkpoint.totalImages = saved.totalImages || 0;
    checkpoint.totalLotFiles = saved.totalLotFiles || 0;
    checkpoint.failures = saved.failures || [];
    checkpoint.startedAt = saved.startedAt;
    checkpoint.bytesTransferred = saved.bytesTransferred || 0;
    
    log(`Checkpoint loaded. Resuming from ${checkpoint.processedLotFiles.size} processed lot files.`);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      log(`Warning: Could not load checkpoint: ${error.message}`, true);
    }
    checkpoint.startedAt = new Date().toISOString();
  }
}

/**
 * Save checkpoint to file
 */
async function saveCheckpoint() {
  try {
    const data = {
      processedLotFiles: Array.from(checkpoint.processedLotFiles),
      uploadedImages: Array.from(checkpoint.uploadedImages),
      successfulUploads: checkpoint.successfulUploads,
      failedUploads: checkpoint.failedUploads,
      skippedUploads: checkpoint.skippedUploads,
      totalImages: checkpoint.totalImages,
      totalLotFiles: checkpoint.totalLotFiles,
      failures: checkpoint.failures.slice(-1000), // Keep last 1000 failures
      startedAt: checkpoint.startedAt,
      lastUpdated: new Date().toISOString(),
      bytesTransferred: checkpoint.bytesTransferred,
    };
    
    await fs.writeFile(CHECKPOINT_FILE, JSON.stringify(data, null, 2));
  } catch (error) {
    log(`Error saving checkpoint: ${error.message}`, true);
  }
}

/**
 * Extract S3 key from CloudFront URL
 * Example: https://d278yjzsv5tla9.cloudfront.net/auctionimages/3483/1713553344/i0178-1.jpg
 * Returns: lotimages/3483/1713553344/i0178-1.jpg
 * (Changes "auctionimages" to "lotimages" for new structure)
 */
function getS3KeyFromUrl(url) {
  const match = url.match(/\/auctionimages\/(.+)$/);
  if (match) {
    return 'lotimages/' + match[1];
  }
  
  // Fallback: use the full path after domain
  const urlObj = new URL(url);
  return urlObj.pathname.replace(/^\//, '');
}

/**
 * Check if object already exists in S3
 */
async function objectExists(s3Key) {
  try {
    await s3Client.send(new HeadObjectCommand({
      Bucket: BUCKET_NAME,
      Key: s3Key,
    }));
    return true;
  } catch (error) {
    if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
      return false;
    }
    throw error;
  }
}

/**
 * Upload image from URL to S3 with streaming
 */
async function uploadImageToS3(imageUrl, s3Key, retryCount = 0) {
  try {
    // Create abort controller for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
    
    // Fetch image from CloudFront
    const response = await fetch(imageUrl, { signal: controller.signal });
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(`404 Not Found: ${imageUrl}`);
      }
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const contentType = response.headers.get('content-type') || 'image/jpeg';
    const contentLength = parseInt(response.headers.get('content-length') || '0', 10);
    
    // Upload to S3 using streaming
    const upload = new Upload({
      client: s3Client,
      params: {
        Bucket: BUCKET_NAME,
        Key: s3Key,
        Body: response.body,
        ContentType: contentType,
        ContentLength: contentLength > 0 ? contentLength : undefined,
      },
      queueSize: 4,
      partSize: 1024 * 1024 * 5, // 5MB parts
    });
    
    await upload.done();
    
    return {
      success: true,
      bytes: contentLength,
    };
  } catch (error) {
    if (retryCount < MAX_RETRIES) {
      const backoffMs = RETRY_BACKOFF[retryCount] || RETRY_BACKOFF[RETRY_BACKOFF.length - 1];
      await new Promise(resolve => setTimeout(resolve, backoffMs));
      return uploadImageToS3(imageUrl, s3Key, retryCount + 1);
    }
    
    throw error;
  }
}

/**
 * Process a single image
 */
async function processImage(imageData) {
  const { imageUrl, s3Key, lotId, auctionId } = imageData;
  
  // Check if already uploaded
  if (checkpoint.uploadedImages.has(s3Key)) {
    checkpoint.skippedUploads++;
    return { status: 'skipped', s3Key };
  }
  
  try {
    // Check if exists in S3
    const exists = await objectExists(s3Key);
    if (exists) {
      checkpoint.uploadedImages.add(s3Key);
      checkpoint.skippedUploads++;
      return { status: 'skipped', s3Key };
    }
    
    // Upload to S3
    const result = await uploadImageToS3(imageUrl, s3Key);
    
    checkpoint.uploadedImages.add(s3Key);
    checkpoint.successfulUploads++;
    checkpoint.bytesTransferred += result.bytes || 0;
    
    return { status: 'success', s3Key, bytes: result.bytes };
  } catch (error) {
    checkpoint.failedUploads++;
    
    const failure = {
      url: imageUrl,
      s3Key: s3Key,
      error: error.message,
      lotId,
      auctionId,
      timestamp: new Date().toISOString(),
    };
    
    checkpoint.failures.push(failure);
    log(`Failed to upload ${s3Key}: ${error.message}`, true);
    
    return { status: 'failed', s3Key, error: error.message };
  }
}

/**
 * Process images with concurrency control
 */
async function processImagesWithConcurrency(images) {
  const results = [];
  const inFlight = new Set();
  let index = 0;
  
  while (index < images.length || inFlight.size > 0) {
    // Check for shutdown
    if (shutdownRequested) {
      log('Shutdown requested. Waiting for in-flight uploads to complete...');
      await Promise.all(Array.from(inFlight));
      break;
    }
    
    // Start new uploads up to concurrency limit
    while (inFlight.size < CONCURRENT_UPLOADS && index < images.length) {
      const image = images[index++];
      
      const promise = processImage(image)
        .then(result => {
          results.push(result);
          inFlight.delete(promise);
          
          // Log progress
          const totalProcessed = checkpoint.successfulUploads + checkpoint.failedUploads + checkpoint.skippedUploads;
          if (totalProcessed % LOG_EVERY_N_IMAGES === 0) {
            logProgress();
          }
          
          // Save checkpoint periodically
          if (totalProcessed % CHECKPOINT_EVERY_N_IMAGES === 0) {
            saveCheckpoint();
          }
        })
        .catch(error => {
          log(`Unexpected error processing image: ${error.message}`, true);
          inFlight.delete(promise);
        });
      
      inFlight.add(promise);
    }
    
    // Wait for at least one to complete
    if (inFlight.size > 0) {
      await Promise.race(Array.from(inFlight));
    }
  }
  
  return results;
}

/**
 * Log progress statistics
 */
function logProgress() {
  const totalProcessed = checkpoint.successfulUploads + checkpoint.failedUploads + checkpoint.skippedUploads;
  const percentage = checkpoint.totalImages > 0 
    ? ((totalProcessed / checkpoint.totalImages) * 100).toFixed(1)
    : 0;
  
  const elapsed = Date.now() - stats.startTime;
  const rate = totalProcessed / (elapsed / 60000); // images per minute
  const remaining = checkpoint.totalImages - totalProcessed;
  const etaMinutes = rate > 0 ? remaining / rate : 0;
  const etaHours = Math.floor(etaMinutes / 60);
  const etaMins = Math.floor(etaMinutes % 60);
  
  const bytesGB = (checkpoint.bytesTransferred / (1024 * 1024 * 1024)).toFixed(2);
  
  log(`Progress: ${totalProcessed.toLocaleString()} / ${checkpoint.totalImages.toLocaleString()} (${percentage}%)`);
  log(`Uploaded: ${checkpoint.successfulUploads.toLocaleString()} | Failed: ${checkpoint.failedUploads} | Skipped: ${checkpoint.skippedUploads.toLocaleString()}`);
  log(`Speed: ${rate.toFixed(1)} images/min | Data: ${bytesGB} GB | ETA: ${etaHours}h ${etaMins}m`);
  log(`Lot Files: ${checkpoint.processedLotFiles.size.toLocaleString()} / ${checkpoint.totalLotFiles.toLocaleString()}`);
  log('');
}

/**
 * Scan all lot image files
 */
async function scanLotFiles() {
  log('Scanning lot image files...');
  
  const lotsDir = path.join(process.cwd(), 'data', 'lots');
  const auctionDirs = await fs.readdir(lotsDir);
  
  const lotFiles = [];
  
  for (const auctionDir of auctionDirs) {
    const auctionPath = path.join(lotsDir, auctionDir);
    const stat = await fs.stat(auctionPath);
    
    if (stat.isDirectory()) {
      const files = await fs.readdir(auctionPath);
      const imageFiles = files.filter(f => f.endsWith('_images.json'));
      
      for (const file of imageFiles) {
        const filePath = path.join(auctionPath, file);
        lotFiles.push(filePath);
      }
    }
  }
  
  log(`Found ${lotFiles.length.toLocaleString()} lot image files`);
  return lotFiles;
}

/**
 * Extract images from a lot file
 */
async function extractImagesFromLot(lotFilePath) {
  try {
    const content = await fs.readFile(lotFilePath, 'utf8');
    const data = JSON.parse(content);
    
    if (!data.data || !Array.isArray(data.data)) {
      return [];
    }
    
    const images = [];
    const auctionId = data.auctionId;
    const lotId = data.lotId;
    
    for (const item of data.data) {
      // Add full image
      if (item.image_url) {
        images.push({
          imageUrl: item.image_url,
          s3Key: getS3KeyFromUrl(item.image_url),
          lotId,
          auctionId,
          imageType: 'full',
        });
      }
      
      // Add thumbnail
      if (item.thumb_url) {
        images.push({
          imageUrl: item.thumb_url,
          s3Key: getS3KeyFromUrl(item.thumb_url),
          lotId,
          auctionId,
          imageType: 'thumb',
        });
      }
    }
    
    return images;
  } catch (error) {
    log(`Error reading lot file ${lotFilePath}: ${error.message}`, true);
    return [];
  }
}

/**
 * Main migration function
 */
async function migrate() {
  console.log('='.repeat(70));
  console.log('West Auction Image Migration to AWS S3');
  console.log('='.repeat(70));
  console.log();
  console.log(`Bucket: ${BUCKET_NAME}`);
  console.log(`Region: ${REGION}`);
  console.log(`Concurrent Uploads: ${CONCURRENT_UPLOADS}`);
  console.log();
  
  // Initialize
  await initializeLogs();
  s3Client = createS3Client();
  await loadCheckpoint();
  
  log('Starting migration...');
  log('');
  
  // Scan lot files
  const allLotFiles = await scanLotFiles();
  checkpoint.totalLotFiles = allLotFiles.length;
  
  // Filter out already processed files
  const lotFilesToProcess = allLotFiles.filter(f => !checkpoint.processedLotFiles.has(f));
  
  log(`Lot files to process: ${lotFilesToProcess.length.toLocaleString()}`);
  log('');
  
  // First pass: count total images
  if (checkpoint.totalImages === 0) {
    log('Counting total images...');
    let imageCount = 0;
    
    for (const lotFile of allLotFiles) {
      const images = await extractImagesFromLot(lotFile);
      imageCount += images.length;
    }
    
    checkpoint.totalImages = imageCount;
    log(`Total images to migrate: ${imageCount.toLocaleString()}`);
    log('');
    await saveCheckpoint();
  }
  
  // Process lot files
  for (let i = 0; i < lotFilesToProcess.length; i++) {
    if (shutdownRequested) {
      log('Shutdown requested. Saving checkpoint and exiting...');
      break;
    }
    
    const lotFile = lotFilesToProcess[i];
    const images = await extractImagesFromLot(lotFile);
    
    if (images.length > 0) {
      await processImagesWithConcurrency(images);
    }
    
    checkpoint.processedLotFiles.add(lotFile);
    
    // Save checkpoint after each lot file
    await saveCheckpoint();
  }
  
  // Final summary
  log('');
  log('='.repeat(70));
  log('Migration Complete');
  log('='.repeat(70));
  log('');
  log(`Total Images: ${checkpoint.totalImages.toLocaleString()}`);
  log(`Successfully Uploaded: ${checkpoint.successfulUploads.toLocaleString()}`);
  log(`Skipped (already exists): ${checkpoint.skippedUploads.toLocaleString()}`);
  log(`Failed: ${checkpoint.failedUploads}`);
  log(`Data Transferred: ${(checkpoint.bytesTransferred / (1024 * 1024 * 1024)).toFixed(2)} GB`);
  log('');
  
  const elapsed = Date.now() - stats.startTime;
  const hours = Math.floor(elapsed / 3600000);
  const minutes = Math.floor((elapsed % 3600000) / 60000);
  const seconds = Math.floor((elapsed % 60000) / 1000);
  log(`Duration: ${hours}h ${minutes}m ${seconds}s`);
  log('');
  
  if (checkpoint.failedUploads > 0) {
    log(`Failed uploads logged to: ${ERROR_LOG_FILE}`);
    log('');
  }
  
  log(`S3 Bucket: ${BUCKET_NAME}`);
  log(`Region: ${REGION}`);
  log('');
}

/**
 * Graceful shutdown handler
 */
function setupShutdownHandlers() {
  const shutdown = async (signal) => {
    console.log();
    log(`Received ${signal}. Initiating graceful shutdown...`);
    shutdownRequested = true;
    
    // Give some time for in-flight operations to complete
    setTimeout(async () => {
      await saveCheckpoint();
      log('Checkpoint saved. You can resume by running the script again.');
      
      if (logStream) logStream.end();
      if (errorLogStream) errorLogStream.end();
      
      process.exit(0);
    }, 5000);
  };
  
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

// Run migration
setupShutdownHandlers();

migrate()
  .then(() => {
    if (logStream) logStream.end();
    if (errorLogStream) errorLogStream.end();
    process.exit(0);
  })
  .catch(async (error) => {
    log('', true);
    log('='.repeat(70), true);
    log('Migration Failed', true);
    log('='.repeat(70), true);
    log('', true);
    log(`Error: ${error.message}`, true);
    log('', true);
    
    await saveCheckpoint();
    log('Checkpoint saved. You can resume by running the script again.');
    
    if (logStream) logStream.end();
    if (errorLogStream) errorLogStream.end();
    
    process.exit(1);
  });

