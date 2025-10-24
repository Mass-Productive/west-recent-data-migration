/**
 * Logging utility for console and file output
 */

import fs from 'fs';
import path from 'path';

class Logger {
  constructor(logFile) {
    this.logFile = logFile;
    this.startTime = Date.now();
    this.stats = {
      auctions: 0,
      lots: 0,
      images: 0,
      errors: 0
    };
    
    // Ensure log directory exists
    const dir = path.dirname(logFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  timestamp() {
    return new Date().toISOString().replace('T', ' ').substring(0, 19);
  }

  info(message) {
    const logMsg = `[${this.timestamp()}] ${message}`;
    console.log(logMsg);
    this.writeToFile(logMsg);
  }

  error(message, err = null) {
    const logMsg = `[${this.timestamp()}] ERROR: ${message}`;
    console.error(logMsg);
    if (err) {
      console.error(err);
      this.writeToFile(`${logMsg}\n${err.stack || err}`);
    } else {
      this.writeToFile(logMsg);
    }
    this.stats.errors++;
  }

  warn(message) {
    const logMsg = `[${this.timestamp()}] WARN: ${message}`;
    console.warn(logMsg);
    this.writeToFile(logMsg);
  }

  debug(message) {
    const logMsg = `[${this.timestamp()}] DEBUG: ${message}`;
    // Only write to file, not console (reduce noise)
    this.writeToFile(logMsg);
  }

  writeToFile(message) {
    try {
      fs.appendFileSync(this.logFile, message + '\n');
    } catch (err) {
      console.error('Failed to write to log file:', err);
    }
  }

  updateStats(auctions = 0, lots = 0, images = 0) {
    this.stats.auctions += auctions;
    this.stats.lots += lots;
    this.stats.images += images;
  }

  progress(currentDate, totalDays, dayIndex) {
    const elapsed = Date.now() - this.startTime;
    const rate = this.stats.auctions / (elapsed / 1000 / 60); // auctions per minute
    const remainingDays = totalDays - dayIndex;
    const eta = remainingDays > 0 && rate > 0 
      ? (remainingDays / (dayIndex / (elapsed / 1000 / 3600))) 
      : 0;

    const percentage = ((dayIndex / totalDays) * 100).toFixed(1);
    
    this.info(`Processing: ${currentDate} (Day ${dayIndex}/${totalDays}, ${percentage}%)`);
    this.info(`Total: ${this.stats.auctions.toLocaleString()} auctions | ${this.stats.lots.toLocaleString()} lots | ${this.stats.images.toLocaleString()} images`);
    
    if (rate > 0) {
      this.info(`Rate: ${rate.toFixed(1)} auctions/min | ETA: ${eta.toFixed(1)} hours`);
    }
    
    if (this.stats.errors > 0) {
      this.info(`Errors: ${this.stats.errors} (${(this.stats.errors / Math.max(this.stats.auctions, 1) * 100).toFixed(2)}%)`);
    }
    
    console.log(''); // Empty line for readability
  }

  summary() {
    const elapsed = (Date.now() - this.startTime) / 1000;
    const hours = Math.floor(elapsed / 3600);
    const minutes = Math.floor((elapsed % 3600) / 60);
    const seconds = Math.floor(elapsed % 60);

    this.info('='.repeat(60));
    this.info('COLLECTION COMPLETE');
    this.info('='.repeat(60));
    this.info(`Total Auctions: ${this.stats.auctions.toLocaleString()}`);
    this.info(`Total Lots: ${this.stats.lots.toLocaleString()}`);
    this.info(`Total Images: ${this.stats.images.toLocaleString()}`);
    this.info(`Errors: ${this.stats.errors}`);
    this.info(`Duration: ${hours}h ${minutes}m ${seconds}s`);
    this.info('='.repeat(60));
  }
}

export default Logger;

