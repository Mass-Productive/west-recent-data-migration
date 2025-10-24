# West Auction Image Migration Tool

A robust two-phase system for migrating auction data and images from West Auction to AWS S3.

## Overview

This tool collects auction data, lot information, and CloudFront image URLs from the West Auction API, then migrates images to an AWS S3 bucket.

**Current Status**: Step 1 - Ready for Implementation (Revised Strategy)

## Features

### Phase 1: Data Collection (Revised Approach)
- **Smart Fetching**: Pagination-based auction collection (not date iteration)
- **Date Filtering**: Local filtering for auctions starting Oct 7, 2024+
- **Automatic Resume**: Checkpoint system allows resuming after interruption
- **Complete Coverage**: Fetches all auctions via pagination (past_sales=true/false)
- **Image Detection**: Intelligently extracts all CloudFront image URLs from lot data
- **Rate Limiting**: Configurable delays to respect API limits
- **Retry Logic**: Exponential backoff for failed requests
- **Progress Tracking**: Real-time statistics and ETA
- **Graceful Shutdown**: SIGINT/SIGTERM handling with checkpoint save

**See**: `docs/phase1-revised-prd.md` for detailed strategy and rationale

### Phase 2: AWS S3 Migration 🚧
Coming in Step 2 (after Step 1 data collection completes)

**Note**: The original date-based iteration approach has been revised after API testing. The new pagination-based approach is more efficient and reliable. See `docs/phase1-revised-prd.md` for details.

## Prerequisites

- **Node.js**: Version 14 or higher
- **npm**: Comes with Node.js
- **Disk Space**: ~2-5 GB for collected data (JSON + image URL list)
- **Network**: Stable internet connection for API calls

## Installation

1. **Clone/Navigate to Project Directory**
   ```bash
   cd /Users/jophie/Dev/Repo/west-image-migration
   ```

2. **Install Dependencies**
   ```bash
   npm install
   ```

3. **Verify Installation**
   ```bash
   node --version  # Should be 14+
   ```

## Quick Start

⚠️ **Implementation in Progress**: The code is being updated to use the revised pagination-based approach. Current code still uses the old date-iteration method.

**Coming Soon:**
```bash
npm install
npm start
```

The script will:
1. Fetch all auctions using pagination (past_sales=true & false)
2. Filter auctions to Oct 7, 2024+ locally
3. Process each auction to get lots and images
4. Save auction/lot JSON files
5. Extract and save image URLs
6. Show progress updates
7. Save checkpoint after each auction

**Expected**: 30-90 minutes, 20K-200K images

## Configuration

Edit `config.js` to customize:

```javascript
{
  START_DATE: '2024-10-07',      // Start of date range
  END_DATE: '2025-10-23',        // End date (defaults to today)
  REQUEST_DELAY_MS: 300,         // Delay between API calls
  MAX_RETRIES: 3,                // Retry attempts for failed requests
  LOG_EVERY_N_AUCTIONS: 10,      // Progress update frequency
  // ... more options
}
```

## Data Output Structure

```
data/
├── auctions/              # Auction JSON files organized by date
│   ├── 2024-10-07/
│   │   ├── auction_12345.json
│   │   └── auction_12346.json
│   ├── 2024-10-08/
│   └── ...
├── lots/                  # Lot JSON files organized by auction
│   ├── 12345/
│   │   ├── lot_67890.json
│   │   ├── lot_67891.json
│   │   └── ...
│   └── 12346/
├── image_urls.txt         # Master list of CloudFront URLs (one per line)
├── checkpoint.json        # Resume state
└── collection.log         # Detailed execution log
```

### File Formats

**Auction JSON** (`data/auctions/{date}/auction_{id}.json`):
```json
{
  "id": 12345,
  "title": "Estate Auction",
  "date": "2024-10-07",
  "status": "open",
  "collectedAt": "2025-10-23T10:15:30.000Z",
  // ... other fields from API
}
```

**Lot JSON** (`data/lots/{auction_id}/lot_{id}.json`):
```json
{
  "id": 67890,
  "auctionId": 12345,
  "title": "Antique Chair",
  "thumb_url": "https://d278yjzsv5tla9.cloudfront.net/.../image_t.jpg",
  "collectedAt": "2025-10-23T10:15:32.000Z",
  // ... other fields from API
}
```

**Image URLs** (`data/image_urls.txt`):
```
https://d278yjzsv5tla9.cloudfront.net/auctionimages/4657/.../image-1.jpg
https://d278yjzsv5tla9.cloudfront.net/auctionimages/4657/.../image-2.jpg
https://d278yjzsv5tla9.cloudfront.net/auctionimages/4657/.../image-3.jpg
```

**Checkpoint** (`data/checkpoint.json`):
```json
{
  "lastProcessedDate": "2024-12-15",
  "totalAuctions": 1234,
  "totalLots": 56789,
  "totalImages": 678901,
  "uniqueImages": 234567,
  "errors": 3,
  "startedAt": "2025-10-23T10:00:00.000Z",
  "lastUpdated": "2025-10-23T15:30:00.000Z"
}
```

## Resume Capability

The script automatically saves checkpoints. To resume after interruption:

1. Simply run the script again: `npm start`
2. It will automatically:
   - Load the last checkpoint
   - Skip already-processed dates
   - Continue from where it left off
   - Maintain deduplication of image URLs

**Manual Resume**: If you want to force restart from a specific date, edit `data/checkpoint.json` and change `lastProcessedDate`.

## Monitoring Progress

### Console Output

Every 10 auctions processed, you'll see:

```
[2025-10-23 14:30:15] Processing: 2024-12-15 (Day 70/381, 18.4%)
[2025-10-23 14:30:15] Total: 1,234 auctions | 56,789 lots | 678,901 images
[2025-10-23 14:30:15] Rate: 12.5 auctions/min | ETA: 8.5 hours
[2025-10-23 14:30:15] Errors: 3 (0.24%)
```

### Log File

Detailed logs are saved to `data/collection.log` for debugging.

### Final Summary

When complete, you'll see:

```
============================================================
COLLECTION COMPLETE
============================================================
Total Auctions: 12,345
Total Lots: 456,789
Total Images: 2,345,678
Errors: 23
Duration: 8h 42m 15s
============================================================

Storage Summary:
- Dates processed: 381
- Auctions saved: 12,345
- Lots saved: 456,789
- Unique images: 2,345,678
- Data size: 3.45 GB

Image URLs file: ./data/image_urls.txt
```

## Graceful Shutdown

To stop the script gracefully:

1. Press `Ctrl+C` (sends SIGINT)
2. The script will:
   - Finish processing current operation
   - Save checkpoint
   - Exit cleanly

You can then resume later.

## Troubleshooting

### Common Issues

**"Network request failed"**
- Check internet connection
- Verify westauction.com is accessible
- Script will auto-retry with backoff

**"ENOSPC: no space left on device"**
- Free up disk space
- Estimate: ~10-50 KB per auction, ~5-20 KB per lot
- Image URLs file: ~400-500 MB for 4M URLs

**"Rate limited (429)"**
- Script will automatically wait and retry
- Consider increasing `REQUEST_DELAY_MS` in config.js

**Stuck or No Progress**
- Check `data/collection.log` for errors
- Look for patterns in error messages
- Verify API is responding with `npm test`

### Reset Everything

To start completely fresh:

```bash
rm -rf data/
npm start
```

### Reset Only Checkpoint

To restart but keep collected data:

```bash
rm data/checkpoint.json
npm start
```

## Expected Performance

Based on estimated API response times:

| Metric | Estimated |
|--------|-----------|
| **Total Days** | 381 |
| **Avg Auctions/Day** | 30-50 |
| **Avg Lots/Auction** | 40-100 |
| **Avg Images/Lot** | 8-15 |
| **Collection Time** | 6-12 hours |
| **Data Size** | 2-5 GB |
| **Image URLs** | 1-4 million |

## Project Structure

```
west-image-migration/
├── collect-data.js        # Main entry point
├── config.js             # Configuration
├── package.json          # Dependencies
├── lib/
│   ├── api-client.js    # API wrapper with retry logic
│   ├── image-extractor.js # Image URL extraction
│   ├── logger.js        # Logging utility
│   └── storage.js       # File I/O and checkpointing
├── scripts/
│   └── api-test.js      # API discovery script
├── docs/
│   └── s3-migration-prd.md  # Project requirements
└── data/                # Created at runtime
    ├── auctions/
    ├── lots/
    ├── image_urls.txt
    ├── checkpoint.json
    └── collection.log
```

## Next Steps

After Step 1 completes:

1. **Verify Collection**
   - Check total counts in final summary
   - Spot-check some JSON files
   - Verify `image_urls.txt` has expected format

2. **Step 2: AWS S3 Migration** (To be implemented)
   - Stream images from CloudFront URLs
   - Upload to destination S3 bucket
   - Preserve filenames
   - Handle 1-4 million images

## Advanced Usage

### Process Specific Date Range

Edit `config.js`:

```javascript
START_DATE: '2024-11-01',
END_DATE: '2024-11-30',
```

### Increase Logging Detail

Look for DEBUG entries in `data/collection.log` after running.

### Custom Data Directory

Edit `config.js`:

```javascript
DATA_DIR: '/path/to/custom/location',
```

## Support

For issues or questions:
1. Check `data/collection.log` for errors
2. Run `npm test` to verify API connectivity
3. Review `test-output.json` for API structure

## License

MIT

