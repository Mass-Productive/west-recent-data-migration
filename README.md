# West Auction Data Collection

Three-phase tool to collect auction data from West Auction API using a weekly-chunking strategy.

**Status**: ✅ Complete - 218 auctions, 31,124 lots, 256,694 images collected

## What It Does

Collects all auction data from Oct 7, 2024 to present:
- **Phase 1**: Fetches all auctions (weekly chunks to avoid pagination issues)
- **Phase 2**: Fetches all lots for each auction
- **Phase 3**: Fetches image metadata for each lot

Each phase can resume if interrupted.

## Installation

```bash
npm install
```

## Usage

Run in order:

```bash
# 1. Collect auctions (~1 min)
npm run fetch-auctions

# 2. Collect lots (~2 hours)
npm run collect-lots

# 3. Collect images (~8 hours)
npm run collect-images
```

**Resume**: Just re-run the same command if interrupted - it will continue from checkpoint.

## File Structure

```
data/
├── auctions-weekly.json              # Master list of 218 auctions
├── auctions/                         # Individual auction files by date
│   └── {date}/
│       └── auction_{id}.json
└── lots/                             # Lots organized by auction ID
    └── {auction_id}/
        ├── lot_{id}.json             # Lot metadata
        └── lot_{id}_images.json      # Image URLs & metadata
```

**Total Files**: 
- 218 auction files
- 31,124 lot files  
- 31,123 image files
- ~2 GB storage

## Configuration

Edit `config.js` to adjust:
- `START_DATE` - Filter auctions from this date
- `REQUEST_DELAY_MS` - Delay between API calls (default: 300-500ms)
- `MAX_RETRIES` - Retry attempts (default: 3)

## Data Format

**Auction** (`auction_{id}.json`):
```json
{
  "id": "3483",
  "title": "Equipment Auction",
  "starts": "2024-10-15 10:00:00",
  "status": "closed"
}
```

**Lot** (`lot_{id}.json`):
```json
{
  "id": "556252",
  "auction_id": "3483",
  "title": "Soundcraft Mixer",
  "current_bid": "550.00"
}
```

**Images** (`lot_{id}_images.json`):
```json
{
  "data": [
    {
      "image_url": "https://d278yjzsv5tla9.cloudfront.net/...",
      "thumb_url": "https://d278yjzsv5tla9.cloudfront.net/..._t.jpg"
    }
  ]
}
```

## Verification

```bash
# Count items
find data/auctions -name "auction_*.json" | wc -l      # 218
find data/lots -name "lot_*.json" ! -name "*_images*" | wc -l  # 31,124
find data/lots -name "*_images.json" | wc -l           # 31,123

# View sample
cat data/auctions-weekly.json | jq .
```

## Troubleshooting

**Script interrupted**: Re-run the same command - it resumes automatically

**Reset checkpoint**: `rm data/lots-checkpoint.json` or `rm data/images-checkpoint.json`

**Start fresh**: `rm -rf data/`

## How It Works

Uses **weekly 7-day chunks** instead of pagination to avoid API issues. Each week is small enough to fetch in one request, achieving 100% collection efficiency.

See [`docs/COLLECTION_SUMMARY.md`](docs/COLLECTION_SUMMARY.md) for detailed results.

---

# AWS S3 Image Migration

After collecting all the data, migrate images from CloudFront to your AWS S3 bucket.

## Quick Start

### 1. Setup AWS (One-time)

See **[AWS Setup Guide](docs/aws-setup-guide.md)** for detailed instructions.

**Summary**:
1. Create IAM user with S3 permissions
2. Configure credentials (`.env` file or AWS CLI)
3. Run setup: `node scripts/setup-s3.js`
4. Test connection: `node scripts/test-s3-connection.js`

### 2. Test Migration

Test with 10 images first:

```bash
node scripts/test-migration.js
```

This will:
- Upload 10 sample images to S3 (in `_test/` prefix)
- Verify uploads succeeded
- Clean up test files
- Confirm everything works

### 3. Run Full Migration

Migrate all 256,694 images:

```bash
node scripts/migrate-images-to-s3.js
```

## Features

### Robust & Fault-Tolerant
- ✅ **Direct Streaming**: CloudFront → S3 (no local storage)
- ✅ **Concurrent Uploads**: 10 simultaneous uploads
- ✅ **Auto-Resume**: Checkpoint system for interruption recovery
- ✅ **Retry Logic**: Exponential backoff for failures
- ✅ **Graceful Shutdown**: Ctrl+C saves checkpoint safely

### Progress Monitoring
- Real-time stats every 100 images
- Upload speed (images/min)
- ETA calculation
- Success/failure/skip counts
- Data transferred (GB)

### Error Handling
- 404 from CloudFront: Log and skip
- Network errors: Retry 3× with backoff
- S3 failures: Retry 3× then log and continue
- All errors logged to `data/migration-errors.log`

## Migration Output

```
[2025-10-24 15:30:45] Progress: 45,623 / 256,694 (17.8%)
[2025-10-24 15:30:45] Uploaded: 45,500 | Failed: 12 | Skipped: 111
[2025-10-24 15:30:45] Speed: 125 images/min | Data: 3.45 GB | ETA: 28h 15m
[2025-10-24 15:30:45] Lot Files: 5,432 / 31,123
```

## Files Created

```
data/
├── migration-checkpoint.json     # Resume state
├── migration.log                 # Detailed log
└── migration-errors.log          # Failed uploads only
```

## Resume After Interruption

Just re-run the same command:

```bash
node scripts/migrate-images-to-s3.js
```

The script will:
- Load the last checkpoint
- Skip already-uploaded images
- Continue from where it left off
- No duplicate uploads

## S3 Structure

Images preserve original CloudFront structure (changed "auctionimages" → "lotimages"):

```
s3://west-auction-images/
└── lotimages/
    └── {auctionId}/
        └── {timestamp}/
            ├── image-1.jpg         # Full image
            ├── image-1_t.jpg       # Thumbnail
            ├── image-2.jpg
            └── image-2_t.jpg
```

Example: `lotimages/3483/1713553344/i0178-1.jpg`

**Future CloudFront URL**: `https://your-cdn.cloudfront.net/lotimages/3483/1713553344/i0178-1.jpg`

## Performance

**Estimated Time**: 5-8 hours for 256,694 images

| Metric | Value |
|--------|-------|
| Total Images | 256,694 |
| Concurrent Uploads | 10 |
| Avg Speed | 120-150 images/min |
| Estimated Data | 10-20 GB |
| Storage Cost | ~$0.25/month |

## Configuration

Edit `config.js` to customize:

```javascript
// AWS Configuration
AWS_REGION: 'us-west-2',
S3_BUCKET_NAME: 'west-auction-images',

// Migration Settings
CONCURRENT_UPLOADS: 10,           // Simultaneous uploads
UPLOAD_TIMEOUT_MS: 30000,         // 30 sec timeout
MAX_UPLOAD_RETRIES: 3,            // Retry attempts

// Progress Reporting
LOG_EVERY_N_IMAGES: 100,          // Log frequency
CHECKPOINT_EVERY_N_IMAGES: 50,    // Checkpoint frequency
```

## Troubleshooting

### "CredentialsProviderError"

**Problem**: AWS credentials not configured

**Solution**: See [AWS Setup Guide](docs/aws-setup-guide.md)

### "Access Denied"

**Problem**: IAM permissions insufficient

**Solution**: Ensure IAM user has these policies:
- `s3:PutObject`
- `s3:GetObject`
- `s3:ListBucket`
- `s3:HeadObject`

### Resume from specific point

Edit `data/migration-checkpoint.json`:
- Remove lot file from `processedLotFiles` array
- Script will re-process that lot

### Reset completely

```bash
rm data/migration-checkpoint.json
node scripts/migrate-images-to-s3.js
```

## Next Steps

After migration completes:

1. **Verify counts** in S3 console
2. **Spot-check** random images
3. **Update application** to use S3 URLs instead of CloudFront
4. **Delete IAM user** (optional, for security)

## Support

- **Setup Issues**: See [AWS Setup Guide](docs/aws-setup-guide.md)
- **Connection Test**: Run `node scripts/test-s3-connection.js`
- **Check Logs**: Review `data/migration.log` and `data/migration-errors.log`
