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
