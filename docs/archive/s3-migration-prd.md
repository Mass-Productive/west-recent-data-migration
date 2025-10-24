# Product Requirements Document: CloudFront Image Migration Tool

## Goal
Migrate 4 million publicly accessible images (~1.56 TB) from a CloudFront CDN to a destination S3 bucket in a different AWS account within 48 hours, with minimal operational overhead and maximum reliability.

## Description
Build a simple, robust two-phase Python-based migration tool. Phase 1 collects image URLs from a public API and detects optimal EC2 region. Phase 2 downloads images from CloudFront URLs and uploads them to a destination S3 bucket. The tool will run on an EC2 instance (likely us-west-2) to maximize transfer speeds. The system prioritizes simplicity, fault tolerance, and observability over feature complexity.

---

## Success Criteria
1. **Completeness**: All 4 million images successfully transferred
2. **Timeline**: Migration completes within 48 hours (including URL collection)
3. **Data Integrity**: Filenames preserved exactly as source
4. **Reliability**: Automatic recovery from transient failures
5. **Observability**: Clear progress tracking and completion status

---

## Technical Requirements

### Phase 0: URL Collection & Discovery

#### 1. API Integration (TBD - Pending API Documentation)
- **Input**: API endpoint(s) and authentication credentials
- **Output**: Text file (`urls.txt`) containing all image URLs (one per line)
- **Configurable parameters**:
  - API base URL
  - Authentication token/key (if required)
  - Pagination parameters
  - Rate limit (requests per second)
  - Results per page

#### 2. URL Collection Requirements
- **Pagination handling**: Iterate through all pages/results automatically
- **Rate limiting**: Respect API limits with configurable delays between requests
- **Progress tracking**: Log count of URLs collected every 10,000 entries
- **Error handling**: Retry failed API requests (3 attempts with exponential backoff)
- **Validation**: 
  - Verify URL format (starts with `https://d278yjzsv5tla9.cloudfront.net/`)
  - Skip duplicates
  - Validate total count approaches 4M
- **Resume capability**: Save progress periodically, resume from last checkpoint
- **Output format**: Plain text file, one URL per line

#### 3. Region Detection
- **Method**: Extract CloudFront edge location from response headers
- **Implementation**: Make HEAD request to first collected URL, check `x-amz-cf-pop` header
- **Fallback**: Default to `us-west-2` (West Coast proximity)
- **Output**: Print detected/recommended region for EC2 placement

#### 4. URL Collection Script Configuration
```
API_BASE_URL=<TBD>
API_AUTH_TOKEN=<TBD>
API_RATE_LIMIT=10  # requests per second
RESULTS_PER_PAGE=100
OUTPUT_FILE=urls.txt
CHECKPOINT_INTERVAL=10000  # save progress every N URLs
```

---

### Phase 1: Transfer Operations

#### 1. Input Management
- **Input source**: `urls.txt` from Phase 0 (one URL per line)
- **URL format**: `https://d278yjzsv5tla9.cloudfront.net/auctionimages/.../image.jpg`
- **Filename extraction**: Parse filename from URL path to preserve original names
- **Path preservation**: Option to preserve full path structure or flatten to single directory
- **Validation**: Skip empty lines, log malformed URLs without stopping execution

#### 2. Transfer Operations
- **Download**: Fetch image from CloudFront URL via HTTPS
- **Upload**: Stream directly to destination S3 bucket using boto3
- **No local storage**: Stream through memory (max 10MB buffer per file)
- **Concurrency**: 100-150 parallel workers (configurable - CloudFront can handle more)
- **Timeout handling**: 30-second timeout per download, 60-second timeout per upload

#### 3. Error Handling & Recovery
- **Retry logic**: 3 automatic retries per file with exponential backoff (1s, 2s, 4s)
- **Failure logging**: Write failed URLs to `failed_transfers.txt` for manual retry
- **Graceful degradation**: Continue processing remaining files on individual failures
- **Resume capability**: Track completed files in `completed.txt`, skip on restart
- **Signal handling**: Graceful shutdown on SIGINT/SIGTERM
- **HTTP error handling**: Special handling for 404 (log and skip), 503 (retry with backoff)

#### 4. Progress Tracking
- **Console output**: Update every 1000 files with progress percentage and ETA
- **Metrics displayed**:
  - Files completed / total
  - Current transfer rate (files/sec, MB/sec)
  - Estimated time remaining
  - Success/failure counts
  - Current error rate
- **Final report**: Summary statistics on completion

#### 5. Configuration
Simple configuration via environment variables or config file:
```
# Phase 1: Transfer
SOURCE_URLS_FILE=urls.txt
DESTINATION_BUCKET=my-destination-bucket
DESTINATION_PREFIX=images/
PRESERVE_PATH_STRUCTURE=false  # true to keep full path, false to flatten
AWS_REGION=us-west-2
CONCURRENCY=150
MAX_RETRIES=3
DOWNLOAD_TIMEOUT=30
UPLOAD_TIMEOUT=60
LOG_LEVEL=INFO
```

---

## Infrastructure Requirements

### EC2 Instance Specifications
- **Instance type**: `c5.2xlarge` (8 vCPUs, 16 GB RAM) - recommended for CloudFront throughput
- **Region**: `us-west-2` (Oregon) or as detected in Phase 0
- **Storage**: 50 GB EBS (for logs and state files only)
- **Network**: Enhanced networking enabled
- **IAM role**: S3 write permissions to destination bucket only

### Required AWS Permissions
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:PutObjectAcl"
      ],
      "Resource": "arn:aws:s3:::destination-bucket/*"
    }
  ]
}
```

### Python Dependencies
- `boto3` - AWS SDK
- `requests` - HTTP client with connection pooling
- `tqdm` - Progress bars (optional)
- Python 3.9+ standard library only

---

## Non-Functional Requirements

### Performance

**Phase 0 (URL Collection):**
- **Duration**: TBD based on API rate limits (estimate 1-6 hours)
- **Memory**: < 500 MB
- **API throughput**: Respect configured rate limits

**Phase 1 (Transfer):**
- **Target throughput**: 75-100 MB/sec sustained (CloudFront is fast!)
- **Expected completion**: 4-10 hours for 1.56 TB
- **Memory footprint**: < 2 GB RAM
- **CPU usage**: 60-80% utilization across cores

### Reliability
- **Uptime**: Tool must handle 12+ hour continuous operation per phase
- **Transient failure tolerance**: Network blips, temporary 503s, rate limits
- **Data integrity**: Verify with Content-Length checks
- **Idempotency**: Safe to re-run without duplication
- **Checkpoint recovery**: Resume from last good state on interruption

### Observability
- **Logging levels**: INFO for progress, ERROR for failures, DEBUG for troubleshooting
- **Log output**: Both console and file (`collection.log`, `migration.log`)
- **Monitoring**: Console output visible in SSH session or screen/tmux
- **Alerting**: None required (non-production system)
- **State files**: 
  - `urls.txt` - Complete list of source URLs
  - `completed.txt` - Successfully transferred files
  - `failed_transfers.txt` - Failed transfers for retry
  - `checkpoint.json` - API collection progress

### Simplicity
- **Two Python files**: 
  - `collect_urls.py` - Phase 0 API collection
  - `migrate.py` - Phase 1 transfer
- **No databases**: Use flat files for state management
- **No external services**: No queues, no distributed systems
- **Minimal setup**: Run with `python collect_urls.py` then `python migrate.py`

---

## Implementation Phases

### Phase 0: URL Collection Script (TBD - Pending API Details)
**Duration: 2-4 hours development + 1-6 hours execution**

Development tasks:
- API client implementation (pending API documentation)
- Pagination logic
- Rate limiting
- Progress tracking
- Checkpoint/resume capability
- URL validation and deduplication

**Deliverable**: `urls.txt` with ~4M CloudFront URLs

**Note**: Timeline for execution depends on:
- API rate limits
- Results per page
- Total API calls required
- Will be updated once API details are known

### Phase 1: Transfer Script MVP (2-3 hours)
- Basic single-threaded download/upload
- Simple progress counter
- Basic error handling
- Test with 1,000 images

### Phase 2: Transfer Script Production Ready (2-3 hours)
- Add multi-threading (150 workers)
- Implement retry logic and failure logging
- Add resume capability
- Enhance progress tracking with ETA
- Test with 100,000 images

### Phase 3: Execution (4-10 hours)
- Deploy to EC2 in detected region
- Run full migration
- Monitor progress
- Handle any issues

### Phase 4: Validation (1-2 hours)
- Verify file count matches
- Spot-check random samples
- Review failure log
- Retry failed transfers if any

---

## Risk Mitigation

### Risk: API Rate Limiting (Phase 0)
- **Mitigation**: Configurable rate limiting, exponential backoff
- **Fallback**: Run collection over longer period (12-24 hours)
- **Impact**: Delays start of Phase 1, but doesn't affect overall 48-hour goal

### Risk: API Changes or Downtime (Phase 0)
- **Mitigation**: Checkpoint progress every 10k URLs, resume capability
- **Fallback**: Manual intervention, contact API provider
- **Impact**: Could extend Phase 0 timeline

### Risk: Incomplete API Results (Phase 0)
- **Mitigation**: Validate expected count (~4M), log discrepancies
- **Fallback**: Multiple collection passes, manual verification
- **Impact**: May need to re-run collection

### Risk: CloudFront Rate Limiting (Phase 1)
- **Mitigation**: Implement exponential backoff, reduce concurrency if needed
- **Fallback**: Throttle to 50-100 workers instead of 150
- **Impact**: Extends transfer time to 8-12 hours (still within 48hr goal)

### Risk: EC2 Instance Termination (Phase 1)
- **Mitigation**: Resume capability via `completed.txt` tracking
- **Fallback**: Use Spot Instances with checkpointing every 10k files
- **Impact**: Minimal, can restart from last checkpoint

### Risk: Destination Bucket Quota (Phase 1)
- **Mitigation**: Verify bucket limits before starting (4M objects is well within S3 limits)
- **Fallback**: None needed (S3 has no practical object limits)

### Risk: Network Partition During Transfer
- **Mitigation**: Automatic retry logic, resume from completed.txt
- **Fallback**: Run from different region/instance
- **Impact**: Delay of 1-2 hours for failover

---

## Out of Scope

The following are explicitly NOT included in this effort:
- Image transformation or processing
- Metadata preservation beyond filename
- Database integration
- Web UI or API
- Real-time monitoring dashboard
- Permission/ACL migration
- Version control or change tracking
- Incremental sync or continuous replication
- Automated testing suite
- Multi-region distribution
- CDN configuration for destination
- Access log analysis

---

## Deliverables

1. **Python script** (`collect_urls.py`) - API collection tool
2. **Python script** (`migrate.py`) - Transfer executable
3. **Configuration files** (`collection.env`, `migration.env`) - Environment variable templates
4. **README** - Comprehensive setup and usage guide
5. **EC2 setup guide** - Instance launch and configuration steps
6. **API integration guide** - Template for API-specific implementation (to be completed when API details available)
7. **Post-migration validation script** - Verify transfer completeness

---

## Timeline

| Phase | Duration | Description |
|-------|----------|-------------|
| **Phase 0: Development** | | |
| URL Collection Script | 2-4 hours | API integration (pending details) |
| Transfer Script | 4-6 hours | Write and test migration tool |
| EC2 Setup | 30 minutes | Launch instance, install dependencies |
| **Phase 0: Execution** | | |
| URL Collection | 1-6 hours | Query API, build URL list (TBD based on API) |
| Region Detection | 5 minutes | Determine optimal EC2 placement |
| **Phase 1: Execution** | | |
| Migration Execution | 4-10 hours | Unattended transfer |
| Validation | 1-2 hours | Verify completeness |
| **Total** | **12-29 hours** | End-to-end completion |

**Note**: Phase 0 execution time is TBD pending API documentation. Conservative estimate of 1-6 hours based on typical API rate limits for 4M records.

---

## Success Metrics

### Phase 0 (URL Collection):
- **Completion**: All ~4M URLs collected
- **Accuracy**: < 0.1% duplicate or invalid URLs
- **Duration**: Complete within timeline based on API limits
- **Output validation**: `urls.txt` file size ~400-500 MB

### Phase 1 (Transfer):
- **Transfer success rate**: > 99.9% (< 4,000 failures acceptable)
- **Completion time**: < 12 hours for transfer phase
- **Cost**: < $75 total (EC2 + data transfer)
- **Manual intervention**: < 30 minutes (excluding monitoring)
- **Data integrity**: 100% (no corrupted files)

### Overall:
- **End-to-end completion**: < 48 hours
- **Total cost**: < $100

---

## Appendix A: CloudFront vs Direct S3 Considerations

**Why CloudFront is Actually Better:**
1. **Global edge caching**: Faster downloads from distributed edge locations
2. **No origin rate limits**: CloudFront handles traffic bursts better than direct S3
3. **Built-in retry logic**: CloudFront has automatic failover between edge locations
4. **Higher throughput**: Can sustain 75-100 MB/sec vs 50-75 MB/sec from S3

**Considerations:**
1. **No region optimization**: EC2 placement less critical since CloudFront is global
2. **Cache behavior**: Images likely cached at edges, so very fast downloads
3. **Cost**: Free for us (download from CloudFront), but we pay for S3 upload

---

## Appendix B: API Integration Template (TBD)

**When API details become available, document:**

```python
# Template structure for API integration
class ImageURLCollector:
    def __init__(self, api_config):
        self.base_url = api_config['base_url']
        self.auth_token = api_config['auth_token']
        self.rate_limit = api_config['rate_limit']
    
    def collect_all_urls(self):
        """
        Iterate through API and collect all image URLs.
        Implementation depends on:
        - Pagination mechanism (page numbers, cursor, offset)
        - Response structure (where URLs are in JSON)
        - Rate limiting approach (headers, fixed delay)
        - Total count availability (for progress tracking)
        """
        pass
```

**Required API Information:**
- [ ] Base URL / Endpoint
- [ ] Authentication method (API key, Bearer token, none)
- [ ] Pagination mechanism (how to iterate through results)
- [ ] Response structure (JSON schema showing where URLs are)
- [ ] Rate limits (requests per second/minute/hour)
- [ ] Total count endpoint (to verify completeness)
- [ ] Error response format
- [ ] Retry-After headers or backoff requirements

---

## Appendix C: Alternative Approaches Considered

### Option A: AWS DataSync
- **Rejected**: Requires source credentials (not available) and doesn't work with CloudFront

### Option B: Local Machine Transfer
- **Rejected**: 3-4x slower, less reliable, bandwidth intensive

### Option C: Lambda Functions
- **Rejected**: Overkill for one-time migration, harder to monitor, potential timeout issues, cold start overhead

### Option D: Third-party Transfer Tools
- **Rejected**: Added complexity, security concerns, cost unclear, may not handle CloudFront well

### Option E: Direct CloudFront-to-S3 AWS Integration
- **Rejected**: No native AWS service for this, would still need custom scripting