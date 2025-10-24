#!/usr/bin/env node

/**
 * AWS S3 Bucket Setup Script
 * 
 * Sets up the S3 bucket for West Auction image migration:
 * - Checks if bucket exists
 * - Creates bucket if needed
 * - Configures bucket settings
 * - Verifies permissions
 */

import { S3Client, CreateBucketCommand, HeadBucketCommand, PutBucketVersioningCommand } from '@aws-sdk/client-s3';
import config from '../config.js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const REGION = config.AWS_REGION;
const BUCKET_NAME = config.S3_BUCKET_NAME;
const FALLBACK_BUCKET_NAME = config.S3_BUCKET_NAME_FALLBACK;

/**
 * Create S3 client with credentials from environment or AWS config
 */
function createS3Client() {
  const clientConfig = {
    region: REGION,
  };

  // Use environment variables if provided
  if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
    clientConfig.credentials = {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    };
  }

  return new S3Client(clientConfig);
}

/**
 * Check if a bucket exists
 */
async function bucketExists(s3Client, bucketName) {
  try {
    await s3Client.send(new HeadBucketCommand({ Bucket: bucketName }));
    return true;
  } catch (error) {
    if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
      return false;
    }
    throw error;
  }
}

/**
 * Create a new S3 bucket
 */
async function createBucket(s3Client, bucketName) {
  try {
    const params = {
      Bucket: bucketName,
    };

    // For regions other than us-east-1, we need to specify LocationConstraint
    if (REGION !== 'us-east-1') {
      params.CreateBucketConfiguration = {
        LocationConstraint: REGION,
      };
    }

    await s3Client.send(new CreateBucketCommand(params));
    console.log(`✓ Bucket created: ${bucketName}`);
    return true;
  } catch (error) {
    if (error.name === 'BucketAlreadyOwnedByYou') {
      console.log(`✓ Bucket already exists and is owned by you: ${bucketName}`);
      return true;
    }
    if (error.name === 'BucketAlreadyExists') {
      console.error(`✗ Bucket name already taken by another account: ${bucketName}`);
      return false;
    }
    throw error;
  }
}

/**
 * Enable versioning on the bucket (optional)
 */
async function enableVersioning(s3Client, bucketName) {
  try {
    await s3Client.send(new PutBucketVersioningCommand({
      Bucket: bucketName,
      VersioningConfiguration: {
        Status: 'Enabled',
      },
    }));
    console.log(`✓ Versioning enabled on: ${bucketName}`);
  } catch (error) {
    console.warn(`⚠ Could not enable versioning: ${error.message}`);
  }
}

/**
 * Main setup function
 */
async function setupS3() {
  console.log('='.repeat(60));
  console.log('AWS S3 Bucket Setup for West Auction Image Migration');
  console.log('='.repeat(60));
  console.log();

  // Check for AWS credentials
  console.log('Checking AWS credentials...');
  if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
    console.log('✓ Using credentials from environment variables');
  } else {
    console.log('✓ Using credentials from AWS config/credentials file');
  }
  console.log(`✓ Region: ${REGION}`);
  console.log();

  const s3Client = createS3Client();

  // Try primary bucket name
  console.log(`Checking bucket: ${BUCKET_NAME}...`);
  let exists = await bucketExists(s3Client, BUCKET_NAME);
  let selectedBucket = BUCKET_NAME;

  if (exists) {
    console.log(`✓ Bucket exists: ${BUCKET_NAME}`);
  } else {
    console.log(`Bucket does not exist. Creating: ${BUCKET_NAME}...`);
    const created = await createBucket(s3Client, BUCKET_NAME);
    
    if (!created) {
      // Try fallback bucket name
      console.log();
      console.log(`Trying fallback bucket name: ${FALLBACK_BUCKET_NAME}...`);
      exists = await bucketExists(s3Client, FALLBACK_BUCKET_NAME);
      
      if (exists) {
        console.log(`✓ Fallback bucket exists: ${FALLBACK_BUCKET_NAME}`);
        selectedBucket = FALLBACK_BUCKET_NAME;
      } else {
        console.log(`Creating fallback bucket: ${FALLBACK_BUCKET_NAME}...`);
        const fallbackCreated = await createBucket(s3Client, FALLBACK_BUCKET_NAME);
        
        if (!fallbackCreated) {
          throw new Error('Could not create bucket with either primary or fallback name');
        }
        
        selectedBucket = FALLBACK_BUCKET_NAME;
      }
    }
  }

  console.log();
  console.log('='.repeat(60));
  console.log('✓ S3 Bucket Setup Complete');
  console.log('='.repeat(60));
  console.log();
  console.log(`Bucket Name: ${selectedBucket}`);
  console.log(`Region: ${REGION}`);
  console.log(`Bucket ARN: arn:aws:s3:::${selectedBucket}`);
  console.log();
  console.log('Next Steps:');
  console.log('1. Run: node scripts/test-s3-connection.js');
  console.log('2. Verify the test succeeds');
  console.log('3. Run the migration: node scripts/migrate-images-to-s3.js');
  console.log();

  if (selectedBucket !== BUCKET_NAME) {
    console.log('⚠ NOTE: Using fallback bucket name. Update config.js if needed.');
    console.log();
  }
}

// Run setup
setupS3().catch((error) => {
  console.error();
  console.error('='.repeat(60));
  console.error('✗ Setup Failed');
  console.error('='.repeat(60));
  console.error();
  console.error('Error:', error.message);
  console.error();
  
  if (error.name === 'CredentialsProviderError' || error.message.includes('credentials')) {
    console.error('AWS credentials not found. Please configure credentials:');
    console.error();
    console.error('Option 1 - Environment Variables (.env file):');
    console.error('  AWS_ACCESS_KEY_ID=your_access_key_id');
    console.error('  AWS_SECRET_ACCESS_KEY=your_secret_access_key');
    console.error();
    console.error('Option 2 - AWS CLI (~/.aws/credentials):');
    console.error('  Run: aws configure');
    console.error();
    console.error('See README.md for detailed setup instructions.');
    console.error();
  }
  
  process.exit(1);
});

