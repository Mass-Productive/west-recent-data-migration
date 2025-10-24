/**
 * Fetch Auctions by Weekly Chunks
 * 
 * Fetches auctions in 7-day periods to avoid pagination issues
 * Tests with last 3 months, processing one week at a time
 * 
 * Usage: node scripts/fetch-by-week.js
 */

import fetch from 'node-fetch';
import FormData from 'form-data';
import fs from 'fs/promises';
import path from 'path';

const API_URL = 'https://www.westauction.com/api/auctions';
const OUTPUT_FILE = 'data/auctions-weekly.json';
const REQUEST_DELAY_MS = 500;

// Date range: October 7, 2024 to today
const START_DATE = new Date('2024-10-07');
const END_DATE = new Date();

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Generate weekly date ranges from start to end
 */
function generateWeeklyRanges(startDate, endDate) {
  const ranges = [];
  let current = new Date(startDate);
  
  while (current <= endDate) {
    const rangeStart = new Date(current);
    
    // Add 7 days
    const nextWeek = new Date(current);
    nextWeek.setDate(nextWeek.getDate() + 7);
    
    // Range end is either 7 days later or overall end date
    const rangeEnd = new Date(Math.min(nextWeek.getTime(), endDate.getTime()));
    
    ranges.push({
      start: rangeStart.toISOString().split('T')[0],
      end: rangeEnd.toISOString().split('T')[0],
      label: `Week of ${rangeStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
    });
    
    current = nextWeek;
  }
  
  return ranges;
}

/**
 * Fetch auctions for a specific date range (single page only)
 */
async function fetchAuctionsForRange(startDate, endDate) {
  const formData = new FormData();
  formData.append('filters[startDate]', startDate);
  formData.append('filters[endDate]', endDate);
  formData.append('filters[or_closed]', 'true');
  formData.append('past_sales', 'true');
  formData.append('page', '1');
  
  const response = await fetch(API_URL, {
    method: 'POST',
    body: formData
  });
  
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
  
  return await response.json();
}

function displayProgress(currentRange, rangeIndex, totalRanges, weekAuctions, totalSoFar, apiReported) {
  const percentage = ((rangeIndex / totalRanges) * 100).toFixed(1);
  const bar = '█'.repeat(Math.floor((rangeIndex / totalRanges) * 40));
  const empty = '░'.repeat(40 - bar.length);
  
  const matchIndicator = weekAuctions === apiReported ? '✅' : '⚠️';
  
  console.log(`\n   ${currentRange.label} (${currentRange.start} to ${currentRange.end})`);
  console.log(`   Found: ${weekAuctions} auctions | API reported: ${apiReported} ${matchIndicator}`);
  console.log(`   Total collected: ${totalSoFar} unique auctions`);
  console.log(`   Progress: [${bar}${empty}] ${rangeIndex}/${totalRanges} weeks (${percentage}%)`);
}

async function fetchAllAuctionsByWeek() {
  console.log('🚀 Fetching Auctions by Weekly Chunks');
  console.log('━'.repeat(70));
  console.log(`   Full Historical Collection`);
  console.log(`   Start: ${START_DATE.toISOString().split('T')[0]}`);
  console.log(`   End: ${END_DATE.toISOString().split('T')[0]}`);
  console.log(`   Duration: ${Math.ceil((END_DATE - START_DATE) / (1000 * 60 * 60 * 24))} days`);
  console.log(`   Output File: ${OUTPUT_FILE}`);
  console.log('');
  
  const startTime = Date.now();
  const weeklyRanges = generateWeeklyRanges(START_DATE, END_DATE);
  
  console.log(`📅 Generated ${weeklyRanges.length} weekly periods`);
  console.log('');
  console.log('📥 Fetching auctions for each week...');
  console.log('━'.repeat(70));
  
  const allAuctions = new Map(); // Use Map for deduplication by ID
  const weeklyStats = [];
  let perfectMatches = 0;
  let partialMatches = 0;
  
  try {
    for (let i = 0; i < weeklyRanges.length; i++) {
      const range = weeklyRanges[i];
      
      const data = await fetchAuctionsForRange(range.start, range.end);
      
      if (!data || !data.data) {
        console.log(`   ⚠️  No data for ${range.label}`);
        weeklyStats.push({
          period: range.label,
          dateRange: `${range.start} to ${range.end}`,
          collected: 0,
          reported: 0,
          match: true
        });
        continue;
      }
      
      const beforeSize = allAuctions.size;
      
      // Add auctions (deduplicating by ID)
      data.data.forEach(auction => {
        allAuctions.set(auction.id, auction);
      });
      
      const newAuctions = allAuctions.size - beforeSize;
      const collected = data.data.length;
      const reported = data.total || collected;
      const isMatch = collected === reported;
      
      if (isMatch) perfectMatches++;
      else if (collected > 0) partialMatches++;
      
      weeklyStats.push({
        period: range.label,
        dateRange: `${range.start} to ${range.end}`,
        collected: collected,
        reported: reported,
        newUnique: newAuctions,
        match: isMatch
      });
      
      displayProgress(range, i + 1, weeklyRanges.length, collected, allAuctions.size, reported);
      
      // Rate limiting between weeks
      if (i < weeklyRanges.length - 1) {
        await sleep(REQUEST_DELAY_MS);
      }
    }
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    const uniqueAuctions = Array.from(allAuctions.values());
    
    // Final results
    console.log('\n');
    console.log('━'.repeat(70));
    console.log('✅ Collection Complete!');
    console.log('━'.repeat(70));
    console.log(`   Duration: ${duration}s`);
    console.log(`   Weeks Processed: ${weeklyRanges.length}`);
    console.log(`   Total Unique Auctions: ${uniqueAuctions.length}`);
    console.log(`   Perfect Matches: ${perfectMatches}/${weeklyRanges.length} weeks`);
    console.log(`   Partial Data: ${partialMatches} weeks`);
    
    // Calculate totals
    const totalCollected = weeklyStats.reduce((sum, s) => sum + s.collected, 0);
    const totalReported = weeklyStats.reduce((sum, s) => sum + s.reported, 0);
    console.log(`   Total Items Collected: ${totalCollected}`);
    console.log(`   Total Items Reported: ${totalReported}`);
    console.log(`   Collection Efficiency: ${((totalCollected / totalReported) * 100).toFixed(1)}%`);
    
    // Save to file
    console.log('\n💾 Saving to file...');
    
    const outputData = {
      metadata: {
        collectedAt: new Date().toISOString(),
        dateRange: {
          start: START_DATE.toISOString().split('T')[0],
          end: END_DATE.toISOString().split('T')[0]
        },
        strategy: 'weekly-chunks',
        weeklyPeriods: weeklyRanges.length,
        totalUniqueAuctions: uniqueAuctions.length,
        perfectMatches: perfectMatches,
        partialMatches: partialMatches,
        durationSeconds: parseFloat(duration)
      },
      weeklyBreakdown: weeklyStats,
      auctions: uniqueAuctions
    };
    
    await fs.mkdir(path.dirname(OUTPUT_FILE), { recursive: true });
    await fs.writeFile(OUTPUT_FILE, JSON.stringify(outputData, null, 2));
    
    console.log(`   ✓ Saved to: ${OUTPUT_FILE}`);
    console.log(`   ✓ File size: ${(JSON.stringify(outputData).length / 1024).toFixed(1)} KB`);
    
    // Display detailed breakdown
    console.log('\n📊 Weekly Breakdown:');
    console.log('━'.repeat(70));
    weeklyStats.forEach(stat => {
      const icon = stat.match ? '✅' : '⚠️';
      const efficiency = stat.reported > 0 ? `(${((stat.collected / stat.reported) * 100).toFixed(0)}%)` : '';
      console.log(`   ${icon} ${stat.period}: ${stat.collected}/${stat.reported} auctions ${efficiency}`);
    });
    
    console.log('\n📈 Summary Statistics:');
    console.log('━'.repeat(70));
    
    const statuses = {};
    uniqueAuctions.forEach(auction => {
      const status = auction.status || 'unknown';
      statuses[status] = (statuses[status] || 0) + 1;
    });
    
    console.log('   By Status:');
    Object.entries(statuses).sort((a, b) => b[1] - a[1]).forEach(([status, count]) => {
      console.log(`     - ${status}: ${count}`);
    });
    
    // Sample auction IDs
    console.log('\n   Auction ID Range:');
    const ids = uniqueAuctions.map(a => parseInt(a.id)).sort((a, b) => a - b);
    console.log(`     Lowest ID: ${ids[0]}`);
    console.log(`     Highest ID: ${ids[ids.length - 1]}`);
    console.log(`     Sample IDs: ${ids.slice(0, 10).join(', ')}...`);
    
    console.log('\n' + '━'.repeat(70));
    console.log('🎉 Success! All auctions saved to JSON file.');
    console.log('━'.repeat(70));
    
    return {
      success: true,
      total: uniqueAuctions.length,
      weeks: weeklyRanges.length,
      perfectMatches: perfectMatches,
      efficiency: (totalCollected / totalReported) * 100
    };
    
  } catch (error) {
    console.error('\n❌ Error occurred:');
    console.error(`   ${error.message}`);
    console.error(`   Stack: ${error.stack}`);
    
    // Save whatever we collected so far
    if (allAuctions.size > 0) {
      const partialAuctions = Array.from(allAuctions.values());
      console.log(`\n💾 Saving ${partialAuctions.length} auctions collected so far...`);
      const partialData = {
        metadata: {
          collectedAt: new Date().toISOString(),
          dateRange: {
            start: START_DATE.toISOString().split('T')[0],
            end: END_DATE.toISOString().split('T')[0]
          },
          totalUniqueAuctions: partialAuctions.length,
          error: error.message,
          partial: true
        },
        weeklyBreakdown: weeklyStats,
        auctions: partialAuctions
      };
      await fs.writeFile(OUTPUT_FILE, JSON.stringify(partialData, null, 2));
      console.log(`   ✓ Partial results saved to: ${OUTPUT_FILE}`);
    }
    
    return {
      success: false,
      error: error.message,
      totalCollected: allAuctions.size
    };
  }
}

// Run the collection
fetchAllAuctionsByWeek().then(result => {
  if (result.success) {
    console.log(`\n✨ Successfully collected ${result.total} auctions across ${result.weeks} weeks!`);
    console.log(`   ${result.perfectMatches} weeks had complete data (${result.efficiency.toFixed(1)}% overall)`);
    process.exit(0);
  } else {
    process.exit(1);
  }
});

