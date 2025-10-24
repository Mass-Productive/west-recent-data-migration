# Weekly Auction Collection - Test Results

**Date:** October 23, 2025  
**Test Period:** Last 3 months (July 23 - October 23, 2025)  
**Collection Strategy:** Weekly 7-day chunks

---

## 🎉 SUCCESS - 100% Collection Efficiency!

### Key Results

| Metric | Value |
|--------|-------|
| **Total Auctions Collected** | 55 unique auctions |
| **Weeks Processed** | 14 weeks |
| **Collection Efficiency** | **100.0%** ✅ |
| **Perfect Matches** | 14/14 weeks (100%) |
| **Processing Time** | 12.0 seconds |
| **Output File Size** | 652.4 KB |

---

## Why Weekly Chunking Works

### The Problem with Larger Time Periods
- **Monthly chunks**: Hit 12-item limit per request, missing auctions
- **API pagination**: Broken when using date filters (returns duplicates)
- **Large date ranges**: API reports more than it returns

### The Weekly Solution ✅
- **7-day periods**: Small enough to avoid hitting pagination limits
- **No duplicates**: Each week returns all auctions within that period
- **Complete data**: 100% match between reported and collected counts
- **Efficient**: No need to deal with broken pagination

---

## Weekly Breakdown

All 14 weeks had **perfect data collection** (100% efficiency):

| Week | Date Range | Collected | Reported | Status |
|------|-----------|-----------|----------|--------|
| Week of Jul 23 | 2025-07-23 to 2025-07-30 | 3 | 3 | ✅ 100% |
| Week of Jul 30 | 2025-07-30 to 2025-08-06 | 4 | 4 | ✅ 100% |
| Week of Aug 6 | 2025-08-06 to 2025-08-13 | 1 | 1 | ✅ 100% |
| Week of Aug 13 | 2025-08-13 to 2025-08-20 | 4 | 4 | ✅ 100% |
| Week of Aug 20 | 2025-08-20 to 2025-08-27 | 7 | 7 | ✅ 100% |
| Week of Aug 27 | 2025-08-27 to 2025-09-03 | 5 | 5 | ✅ 100% |
| Week of Sep 3 | 2025-09-03 to 2025-09-10 | 3 | 3 | ✅ 100% |
| Week of Sep 10 | 2025-09-10 to 2025-09-17 | 4 | 4 | ✅ 100% |
| Week of Sep 17 | 2025-09-17 to 2025-09-24 | 4 | 4 | ✅ 100% |
| Week of Sep 24 | 2025-09-24 to 2025-10-01 | 4 | 4 | ✅ 100% |
| Week of Oct 1 | 2025-10-01 to 2025-10-08 | 4 | 4 | ✅ 100% |
| Week of Oct 8 | 2025-10-08 to 2025-10-15 | 5 | 5 | ✅ 100% |
| Week of Oct 15 | 2025-10-15 to 2025-10-22 | 6 | 6 | ✅ 100% |
| Week of Oct 22 | 2025-10-22 to 2025-10-23 | 1 | 1 | ✅ 100% |

---

## Data Quality

### Status Distribution

| Status | Count | Percentage |
|--------|-------|------------|
| closed | 49 | 89.1% |
| auction_removal | 6 | 10.9% |

### Auction IDs

- **Lowest ID:** 4016
- **Highest ID:** 4675
- **ID Range:** 659 IDs span
- **Sample:** 4016, 4058, 4121, 4355, 4384, 4454, 4464, 4478, 4512, 4514...

---

## Technical Implementation

### API Endpoint
```
POST https://www.westauction.com/api/auctions
```

### Request Parameters
```javascript
filters[startDate]: YYYY-MM-DD  // Week start
filters[endDate]: YYYY-MM-DD    // Week end (7 days later)
filters[or_closed]: true
past_sales: true
page: 1  // Always page 1, no pagination needed
```

### Rate Limiting
- 500ms delay between requests
- Total processing time: 12 seconds for 14 weeks
- ~857ms average per week (including delay)

---

## Output File Structure

**File:** `data/auctions-weekly.json`

```json
{
  "metadata": {
    "collectedAt": "ISO timestamp",
    "dateRange": { "start": "...", "end": "..." },
    "strategy": "weekly-chunks",
    "weeklyPeriods": 14,
    "totalUniqueAuctions": 55,
    "perfectMatches": 14,
    "partialMatches": 0,
    "durationSeconds": 12.0
  },
  "weeklyBreakdown": [...],
  "auctions": [...]
}
```

---

## Usage

### Run Weekly Collection
```bash
npm run fetch-weekly
```

### Modify Date Range
Edit `scripts/fetch-by-week.js`:
```javascript
// Change the month offset (currently 3 months back)
START_DATE.setMonth(START_DATE.getMonth() - 3);
```

---

## Comparison with Previous Attempts

| Strategy | Time Period | Auctions | Efficiency | Issues |
|----------|-------------|----------|------------|--------|
| **Pagination** | 13 months | 12 | 5.5% | Duplicates on every page |
| **Monthly Chunks** | 13 months | 151 | 69.3% | Hit 12-item limit per month |
| **Weekly Chunks** ✅ | 3 months | 55 | **100%** | None! Perfect collection |

---

## Recommendations

### ✅ For Production Use

1. **Use weekly chunking** for all auction collection
2. **Process 7-day periods** to guarantee complete data
3. **Monitor efficiency** - should stay at 100%
4. **No pagination needed** - single page per week is sufficient

### 📊 For Large Historical Collections

1. **Calculate total weeks** needed for date range
2. **Estimate time**: ~1 second per week
3. **Run in batches** if needed (e.g., 100 weeks at a time)
4. **Verify results** - check for 100% efficiency

### 🔄 For Ongoing Updates

1. **Schedule weekly** - run every Monday to collect previous week
2. **Set up cron job** or similar scheduler
3. **Store incrementally** - append to existing dataset
4. **Deduplicate** by auction ID

---

## Conclusion

✅ **Weekly chunking is the optimal solution**  
✅ **100% collection efficiency achieved**  
✅ **No data loss or pagination issues**  
✅ **Fast and reliable processing**  

The 7-day chunk size is the sweet spot that:
- Avoids the API's 12-item display limit
- Eliminates pagination issues
- Ensures complete data collection
- Provides predictable, reliable results

**This approach is production-ready for collecting auction data from the West Auction API.**

