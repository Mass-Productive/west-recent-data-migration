# West Auction Data Collection System - PRD

**Version:** 1.0  
**Last Updated:** October 24, 2025  
**Status:** ✅ Complete & Production Ready

---

## Executive Summary

A Node.js-based data collection system that extracts complete auction, lot, and image metadata from the West Auction API. Successfully collected **218 auctions**, **31,124 lots**, and **256,694 image URLs** from October 7, 2024 to present.

---

## Project Goals

### Primary Objective
Collect complete auction metadata, lot details, and image URLs from the West Auction API for archival and migration purposes.

### Success Criteria
- ✅ **Completeness:** 100% of auctions collected for target date range
- ✅ **Data Integrity:** No data loss, complete lot and image information
- ✅ **Reliability:** Automatic recovery from failures with resume capability
- ✅ **Efficiency:** Reliable collection strategy that avoids API limitations

---

## System Architecture

### Three-Phase Collection Pipeline

```
┌─────────────────────────────────────────────────────────────┐
│  Phase 1: Auction Collection (Weekly Chunking Strategy)    │
│  • Collects auction metadata in 7-day chunks                │
│  • Avoids API pagination issues                            │
│  • Achieves 100% collection efficiency                     │
│  • Output: auctions-weekly.json + individual files         │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  Phase 2: Lot Collection                                    │
│  • Iterates through collected auctions                      │
│  • Fetches all lots for each auction                       │
│  • Saves individual lot files with metadata                │
│  • Output: data/lots/{auctionId}/lot_{lotId}.json         │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  Phase 3: Image URL Collection                              │
│  • Iterates through all collected lots                     │
│  • Extracts image API endpoint from lot links              │
│  • Fetches complete image metadata (URLs, dimensions)      │
│  • Output: lot_{lotId}_images.json files                   │
└─────────────────────────────────────────────────────────────┘
```

---

## Technical Implementation

### Core Scripts

#### 1. Auction Collection (`scripts/fetch-by-week.js`)
```bash
npm run fetch-auctions
```

**Purpose:** Collect all auctions within a date range using weekly 7-day chunks.

**Key Features:**
- Weekly chunking strategy (avoids API pagination issues)
- 100% collection efficiency
- No duplicate handling needed
- Rate limiting: 500ms between requests
- Progress tracking and reporting

**Configuration:**
```javascript
START_DATE: October 7, 2024
END_DATE: Current date
CHUNK_SIZE: 7 days
API_ENDPOINT: https://www.westauction.com/api/auctions
```

**Output:**
- `data/auctions-weekly.json` - Complete auction dataset with metadata
- `data/auctions/{date}/auction_{id}.json` - Individual auction files

**Strategy Details:**
The API has pagination issues with date filters. By breaking the date range into 7-day chunks, we ensure each request returns all auctions within that period without needing pagination, achieving 100% collection efficiency.

---

#### 2. Lot Collection (`scripts/collect-lots.js`)
```bash
npm run collect-lots
```

**Purpose:** Collect complete lot information for all collected auctions.

**Key Features:**
- Iterates through all collected auctions
- Fetches all lots per auction from `/api/auctions/{id}/items`
- Saves individual lot files with complete metadata
- Checkpointing for resume capability
- Skip already-processed auctions and lots
- Rate limiting: 500ms between requests
- Retry logic: 3 attempts with exponential backoff

**Output:**
```
data/lots/{auctionId}/
  ├── lot_{lotId}.json
  ├── lot_{lotId}.json
  └── ...
```

**Checkpoint Files:**
- `data/lots-checkpoint.json` - Resume progress tracking
- `data/lots-collection.log` - Error and event logging

**Data Structure:**
Each lot file contains:
- Lot ID and auction ID
- Title, description, reserve price
- Current bid, starting bid
- Item status and timestamps
- Links array (including image API endpoint)
- Collection timestamp

---

#### 3. Image URL Collection (`scripts/collect-lot-images.js`)
```bash
npm run collect-images
```

**Purpose:** Extract all image URLs and metadata for every lot.

**Key Features:**
- Iterates through all lot files
- Extracts image API endpoint from lot's `links` array
- Fetches complete image data from `/api/auctions/{auctionId}/items/{lotId}/images`
- Saves image metadata alongside lot files
- Skip already-processed lots
- Checkpointing for resume capability
- Rate limiting: 300ms between requests (more aggressive for faster completion)
- Retry logic with exponential backoff

**Output:**
```
data/lots/{auctionId}/
  ├── lot_{lotId}.json
  ├── lot_{lotId}_images.json    ← NEW
  └── ...
```

**Image Data Structure:**
```json
{
  "result": "success",
  "links": [...],
  "data": [
    {
      "image_url": "https://d278yjzsv5tla9.cloudfront.net/...",
      "thumb_url": "https://d278yjzsv5tla9.cloudfront.net/..._t.jpg",
      "image_width": "320",
      "image_height": "240",
      "archived": "0"
    }
  ],
  "lotId": "556252",
  "auctionId": "3483",
  "collectedAt": "2025-10-23T..."
}
```

**Performance:**
- Processing rate: ~1.1 lots/second
- Total duration: ~7.7 hours for 31,124 lots
- Average images per lot: 8.2

---

### Shared Libraries

#### `lib/api-client.js`
Core API wrapper with:
- Rate limiting with configurable delays
- Retry logic (3 attempts, exponential backoff)
- Error handling for network issues
- Request/response logging
- Methods for auctions, lots, and images

#### `lib/logger.js`
Logging utility with:
- Console and file output
- Timestamped entries
- Error tracking
- Progress reporting

---

## Data Collection Results

### Final Statistics

| Metric | Count |
|--------|-------|
| **Auctions Collected** | 218 |
| **Date Range** | Oct 7, 2024 - Oct 24, 2025 |
| **Total Lots** | 31,124 |
| **Total Images** | 256,694 |
| **Collection Efficiency** | 100% |
| **Processing Time** | Phase 1: <1 min, Phase 2: ~2 hrs, Phase 3: ~7.7 hrs |
| **Errors** | 0 |

### Storage Structure

```
data/
├── auctions-weekly.json              (218 auctions with metadata)
├── auctions/                         (218 files organized by date)
│   ├── 2024-10-07/
│   │   ├── auction_3483.json
│   │   └── ...
│   └── 2025-10-24/
│       └── auction_4680.json
└── lots/                             (62,247 files: lots + images)
    ├── 3483/                         (auction ID folder)
    │   ├── lot_556252.json
    │   ├── lot_556252_images.json
    │   ├── lot_556253.json
    │   ├── lot_556253_images.json
    │   └── ...
    └── 4680/
        └── ...
```

---

## Key Technical Decisions

### 1. Weekly Chunking Strategy ✅

**Problem:** API pagination is broken with date filters, causing duplicates and incomplete results.

**Solution:** Split date ranges into 7-day chunks and collect each period individually.

**Results:**
- 100% collection efficiency
- No pagination needed
- No duplicate handling required
- Predictable and reliable

### 2. Individual File Storage ✅

**Rationale:**
- Easier to process incrementally
- Resume capability without re-processing
- Better for parallel processing (future)
- Organized by auction/lot hierarchy
- Human-readable structure

### 3. Separate Image Files ✅

**Rationale:**
- Keeps lot metadata separate from image data
- Easier to update if images change
- Clear data structure
- Matches lot file naming pattern

### 4. Checkpointing & Resume ✅

**Implementation:**
- Save progress every 100 items
- Track last processed auction/lot
- Skip already-existing files
- Graceful shutdown on Ctrl+C

**Benefits:**
- Can pause/resume anytime
- Network failure recovery
- No duplicate processing
- Long-running job safety

---

## API Endpoints Used

### 1. Auction Search
```
POST https://www.westauction.com/api/auctions
```
**Parameters:**
- `filters[startDate]`: Start date (YYYY-MM-DD)
- `filters[endDate]`: End date (YYYY-MM-DD)
- `filters[or_closed]`: true
- `past_sales`: true
- `page`: 1 (always, due to weekly chunking)

### 2. Auction Lots
```
POST https://www.westauction.com/api/auctions/{auctionId}/items
```
**Returns:** All lots for the specified auction

### 3. Lot Images
```
GET https://www.westauction.com/api/auctions/{auctionId}/items/{lotId}/images
```
**Returns:** All image URLs and metadata for the specified lot

---

## Error Handling & Reliability

### Built-in Safeguards

1. **Rate Limiting**
   - Configurable delays between requests
   - Prevents overwhelming the API
   - Default: 300-500ms per request

2. **Retry Logic**
   - 3 automatic retries per request
   - Exponential backoff: 1s, 2s, 4s
   - Detailed error logging

3. **Checkpointing**
   - Progress saved every 100 items
   - Resume from last checkpoint
   - No duplicate processing

4. **Graceful Shutdown**
   - SIGINT/SIGTERM handlers
   - Save current progress
   - Clean exit with summary

5. **File Existence Checks**
   - Skip already-processed items
   - Idempotent operations
   - Safe to re-run

---

## Usage Guide

### Initial Setup
```bash
# Install dependencies
npm install

# Verify configuration
cat config.js
```

### Full Collection Workflow

#### Step 1: Collect Auctions
```bash
npm run fetch-auctions
```
**Duration:** < 1 minute  
**Output:** `data/auctions-weekly.json` + individual auction files

#### Step 2: Collect Lots
```bash
npm run collect-lots
```
**Duration:** ~2 hours for 31,124 lots  
**Output:** `data/lots/{auctionId}/lot_{lotId}.json`

#### Step 3: Collect Images
```bash
npm run collect-images
```
**Duration:** ~7.7 hours for 31,124 lots  
**Output:** `data/lots/{auctionId}/lot_{lotId}_images.json`

### Resume After Interruption
Just re-run the same command - it will skip already-processed items and continue from where it left off.

---

## Performance Characteristics

### Phase 1: Auction Collection
- **Rate:** ~1 week per second (with 500ms delay)
- **Memory:** < 100 MB
- **CPU:** Minimal (I/O bound)
- **Network:** Light (small responses)

### Phase 2: Lot Collection
- **Rate:** ~4-5 lots per second
- **Memory:** < 200 MB
- **Processing:** 31,124 lots in ~2 hours
- **API Calls:** ~220 auctions (varies by lots per auction)

### Phase 3: Image Collection
- **Rate:** ~1.1 lots per second
- **Memory:** < 200 MB
- **Processing:** 31,124 lots in ~7.7 hours
- **API Calls:** 31,124 (one per lot)

---

## Lessons Learned

### What Worked Well ✅
1. **Weekly chunking strategy** - Achieved 100% efficiency
2. **Individual file storage** - Easy resume and processing
3. **Checkpointing** - Safe for long-running jobs
4. **Rate limiting** - No API throttling issues
5. **Graceful shutdown** - Clean interruption handling

### Challenges Overcome 🔧
1. **API pagination issues** - Solved with weekly chunking
2. **Long processing times** - Added checkpointing and progress tracking
3. **Data organization** - Structured by auction/lot hierarchy
4. **Resume capability** - File existence checks prevent duplicates

---

## Future Enhancements (Out of Scope)

- [ ] Parallel processing (multiple concurrent workers)
- [ ] Incremental updates (only collect new auctions)
- [ ] Database storage (currently file-based)
- [ ] API for querying collected data
- [ ] Image download and migration to S3
- [ ] Web UI for browsing collected data
- [ ] Automated scheduling (cron jobs)

---

## Dependencies

```json
{
  "date-fns": "^4.1.0",      // Date manipulation
  "form-data": "^4.0.0",     // API form data
  "node-fetch": "^3.3.2"     // HTTP client
}
```

**Node Version:** 20.13.1+  
**Type:** ES Modules (type: "module")

---

## Files & Directories

### Core Files
```
├── scripts/
│   ├── fetch-by-week.js           (Phase 1: Auctions)
│   ├── collect-lots.js            (Phase 2: Lots)
│   └── collect-lot-images.js      (Phase 3: Images)
├── lib/
│   ├── api-client.js              (Shared API wrapper)
│   └── logger.js                  (Logging utility)
├── config.js                      (Configuration)
├── package.json                   (Dependencies & scripts)
└── docs/
    ├── DATA_COLLECTION_PRD.md     (This document)
    └── WEEKLY_COLLECTION_RESULTS.md (Test results)
```

### Data Files
```
data/
├── auctions-weekly.json           (Complete auction dataset)
├── auctions/{date}/               (Individual auction files)
└── lots/{auctionId}/              (Lot and image files)
```

---

## Support & Maintenance

### Monitoring
- Check console output for progress
- Review checkpoint files for resume status
- Examine log files for errors

### Troubleshooting

**Script fails to start:**
- Check Node version (20+)
- Verify dependencies installed (`npm install`)
- Check file permissions

**Collection incomplete:**
- Check checkpoint file for last position
- Re-run script (will resume automatically)
- Review logs for specific errors

**API errors:**
- Check network connectivity
- Verify API endpoint availability
- Review rate limiting settings

---

## Success Metrics

| Metric | Target | Achieved |
|--------|--------|----------|
| Collection Completeness | 100% | ✅ 100% |
| Data Integrity | No corruption | ✅ Pass |
| Error Rate | < 1% | ✅ 0% |
| Resume Capability | Yes | ✅ Yes |
| Processing Time | < 12 hours | ✅ ~10 hours total |

---

## Conclusion

✅ **Mission Accomplished**

The West Auction Data Collection System successfully collected complete metadata for:
- **218 auctions** from October 2024 to October 2025
- **31,124 lots** with full details
- **256,694 image URLs** with metadata

The system is **production-ready**, **reliable**, and **maintainable** with:
- 100% collection efficiency
- Zero data loss
- Complete error handling
- Resume capability
- Clean code structure

**Ready for next phase:** Image migration or data processing as needed.

