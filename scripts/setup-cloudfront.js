#!/usr/bin/env node

/**
 * CloudFront Distribution Setup Script
 * 
 * Creates a CloudFront distribution to serve images from S3 bucket
 * with optimal caching and security settings.
 */

import {
  CloudFrontClient,
  CreateDistributionCommand,
  GetDistributionCommand,
  CreateOriginAccessControlCommand,
} from '@aws-sdk/client-cloudfront';
import { S3Client, PutBucketPolicyCommand, GetBucketPolicyCommand } from '@aws-sdk/client-s3';
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import config from '../config.js';
import dotenv from 'dotenv';
import { promises as fs } from 'fs';

dotenv.config();

const REGION = config.AWS_REGION;
const BUCKET_NAME = config.S3_BUCKET_NAME;

// Colors for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[36m',
  red: '\x1b[31m',
};

const { green, yellow, blue, red, reset, bright } = colors;

/**
 * Print colored message
 */
function print(message, color = reset) {
  console.log(`${color}${message}${reset}`);
}

/**
 * Print section header
 */
function printHeader(message) {
  console.log();
  print('='.repeat(70), blue);
  print(message, bright);
  print('='.repeat(70), blue);
  console.log();
}

/**
 * Create AWS clients
 */
function createClients() {
  const clientConfig = {
    region: REGION,
  };

  if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
    clientConfig.credentials = {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    };
  }

  return {
    cloudfront: new CloudFrontClient({ ...clientConfig, region: 'us-east-1' }), // CloudFront is global, uses us-east-1
    s3: new S3Client(clientConfig),
    sts: new STSClient(clientConfig),
  };
}

/**
 * Get AWS account ID
 */
async function getAccountId(stsClient) {
  try {
    const command = new GetCallerIdentityCommand({});
    const response = await stsClient.send(command);
    return response.Account;
  } catch (error) {
    throw new Error(`Failed to get AWS Account ID: ${error.message}`);
  }
}

/**
 * Create Origin Access Control (OAC)
 */
async function createOriginAccessControl(cfClient) {
  try {
    print('Creating Origin Access Control (OAC)...', yellow);
    
    const command = new CreateOriginAccessControlCommand({
      OriginAccessControlConfig: {
        Name: `west-auction-images-oac-${Date.now()}`,
        Description: 'OAC for West Auction images S3 bucket',
        SigningProtocol: 'sigv4',
        SigningBehavior: 'always',
        OriginAccessControlOriginType: 's3',
      },
    });

    const response = await cfClient.send(command);
    const oacId = response.OriginAccessControl.Id;
    
    print(`✓ OAC Created: ${oacId}`, green);
    return oacId;
  } catch (error) {
    throw new Error(`Failed to create OAC: ${error.message}`);
  }
}

/**
 * Create CloudFront distribution
 */
async function createDistribution(cfClient, oacId) {
  try {
    print('Creating CloudFront distribution...', yellow);
    
    const originDomain = `${BUCKET_NAME}.s3.${REGION}.amazonaws.com`;
    const callerReference = `west-auction-${Date.now()}`;
    
    const command = new CreateDistributionCommand({
      DistributionConfig: {
        CallerReference: callerReference,
        Comment: 'West Auction Images CDN',
        Enabled: true,
        
        // Origins
        Origins: {
          Quantity: 1,
          Items: [
            {
              Id: 'west-auction-s3-origin',
              DomainName: originDomain,
              OriginAccessControlId: oacId,
              S3OriginConfig: {
                OriginAccessIdentity: '', // Empty for OAC
              },
            },
          ],
        },
        
        // Default Cache Behavior
        DefaultCacheBehavior: {
          TargetOriginId: 'west-auction-s3-origin',
          ViewerProtocolPolicy: 'redirect-to-https',
          AllowedMethods: {
            Quantity: 2,
            Items: ['GET', 'HEAD'],
            CachedMethods: {
              Quantity: 2,
              Items: ['GET', 'HEAD'],
            },
          },
          Compress: true,
          
          // Use managed cache policy: CachingOptimized
          CachePolicyId: '658327ea-f89d-4fab-a63d-7e88639e58f6',
          
          // Use managed origin request policy: CORS-S3Origin
          OriginRequestPolicyId: '88a5eaf4-2fd4-4709-b370-b4c650ea3fcf',
          
          // Use managed response headers policy: SimpleCORS
          ResponseHeadersPolicyId: '60669652-455b-4ae9-85a4-c4c02393f86c',
          
          TrustedSigners: {
            Enabled: false,
            Quantity: 0,
          },
          TrustedKeyGroups: {
            Enabled: false,
            Quantity: 0,
          },
        },
        
        // Price Class (use only North America and Europe for cost savings)
        PriceClass: 'PriceClass_100',
        
        // HTTPS only
        ViewerCertificate: {
          CloudFrontDefaultCertificate: true,
          MinimumProtocolVersion: 'TLSv1.2_2021',
        },
      },
    });

    const response = await cfClient.send(command);
    const distribution = response.Distribution;
    
    print(`✓ Distribution Created`, green);
    print(`  ID: ${distribution.Id}`, blue);
    print(`  Domain: ${distribution.DomainName}`, blue);
    print(`  Status: ${distribution.Status}`, blue);
    
    return {
      id: distribution.Id,
      domain: distribution.DomainName,
      arn: distribution.ARN,
    };
  } catch (error) {
    throw new Error(`Failed to create distribution: ${error.message}`);
  }
}

/**
 * Update S3 bucket policy to allow CloudFront access
 */
async function updateBucketPolicy(s3Client, accountId, distributionId) {
  try {
    print('Updating S3 bucket policy...', yellow);
    
    const policy = {
      Version: '2012-10-17',
      Statement: [
        {
          Sid: 'AllowCloudFrontServicePrincipal',
          Effect: 'Allow',
          Principal: {
            Service: 'cloudfront.amazonaws.com',
          },
          Action: 's3:GetObject',
          Resource: `arn:aws:s3:::${BUCKET_NAME}/*`,
          Condition: {
            StringEquals: {
              'AWS:SourceArn': `arn:aws:cloudfront::${accountId}:distribution/${distributionId}`,
            },
          },
        },
      ],
    };

    const command = new PutBucketPolicyCommand({
      Bucket: BUCKET_NAME,
      Policy: JSON.stringify(policy),
    });

    await s3Client.send(command);
    print(`✓ Bucket policy updated`, green);
  } catch (error) {
    print(`✗ Failed to update bucket policy: ${error.message}`, red);
    print(`  You may need to manually update the S3 bucket policy.`, yellow);
    print(`  See docs/CLOUDFRONT_SETUP.md for instructions.`, yellow);
  }
}

/**
 * Wait for distribution to be deployed
 */
async function waitForDeployment(cfClient, distributionId, maxWaitMinutes = 30) {
  print(`\nWaiting for distribution to deploy (this takes 15-20 minutes)...`, yellow);
  print(`You can close this script and check status later in AWS Console.`, blue);
  print(`Press Ctrl+C to exit (deployment will continue in background).`, blue);
  console.log();
  
  const startTime = Date.now();
  const maxWaitMs = maxWaitMinutes * 60 * 1000;
  let dots = 0;
  
  while (Date.now() - startTime < maxWaitMs) {
    try {
      const command = new GetDistributionCommand({ Id: distributionId });
      const response = await cfClient.send(command);
      const status = response.Distribution.Status;
      
      if (status === 'Deployed') {
        console.log(); // New line after dots
        print(`✓ Distribution deployed and ready!`, green);
        return true;
      }
      
      // Show progress dots
      process.stdout.write('.');
      dots++;
      if (dots % 60 === 0) {
        const elapsed = Math.floor((Date.now() - startTime) / 60000);
        console.log(` ${elapsed} min`);
      }
      
      // Wait 10 seconds before checking again
      await new Promise(resolve => setTimeout(resolve, 10000));
    } catch (error) {
      console.log(); // New line after dots
      print(`Warning: Could not check deployment status: ${error.message}`, yellow);
      break;
    }
  }
  
  console.log(); // New line after dots
  print(`Distribution is still deploying (takes up to 30 minutes).`, yellow);
  print(`Check AWS Console for deployment status.`, blue);
  return false;
}

/**
 * Save configuration to file
 */
async function saveConfig(distributionInfo) {
  try {
    const configData = {
      cloudfront: {
        distributionId: distributionInfo.id,
        domain: distributionInfo.domain,
        arn: distributionInfo.arn,
        createdAt: new Date().toISOString(),
      },
      s3: {
        bucket: BUCKET_NAME,
        region: REGION,
      },
      urls: {
        pattern: `https://${distributionInfo.domain}/lotimages/{auctionId}/{timestamp}/{filename}.jpg`,
        example: `https://${distributionInfo.domain}/lotimages/3483/1713553344/i0178-1.jpg`,
      },
    };
    
    await fs.writeFile(
      './data/cloudfront-config.json',
      JSON.stringify(configData, null, 2)
    );
    
    print(`✓ Configuration saved to: data/cloudfront-config.json`, green);
  } catch (error) {
    print(`Warning: Could not save config: ${error.message}`, yellow);
  }
}

/**
 * Print usage instructions
 */
function printUsageInstructions(distributionInfo) {
  printHeader('Setup Complete!');
  
  print('CloudFront Distribution Details:', bright);
  console.log();
  print(`  Distribution ID: ${distributionInfo.id}`, blue);
  print(`  CloudFront Domain: ${distributionInfo.domain}`, blue);
  console.log();
  
  print('Your New Image URLs:', bright);
  console.log();
  print(`  Pattern:`, blue);
  print(`    https://${distributionInfo.domain}/lotimages/{auctionId}/{timestamp}/{filename}.jpg`);
  console.log();
  print(`  Example:`, blue);
  print(`    https://${distributionInfo.domain}/lotimages/3483/1713553344/i0178-1.jpg`);
  console.log();
  
  print('Next Steps:', bright);
  console.log();
  print(`  1. Wait for deployment to complete (15-20 minutes)`, yellow);
  print(`  2. Test an image URL in your browser`, yellow);
  print(`  3. Update your application to use new CloudFront domain`, yellow);
  print(`  4. Monitor CloudFront metrics in AWS Console`, yellow);
  console.log();
  
  print('Test Command:', bright);
  console.log();
  print(`  curl -I https://${distributionInfo.domain}/lotimages/3483/1713553344/i0178-1.jpg`);
  console.log();
  
  print('Documentation:', bright);
  console.log();
  print(`  See docs/CLOUDFRONT_SETUP.md for detailed setup guide`, blue);
  print(`  CloudFront Console: https://console.aws.amazon.com/cloudfront/`, blue);
  console.log();
}

/**
 * Main setup function
 */
async function setup() {
  printHeader('CloudFront Distribution Setup');
  
  try {
    // Create clients
    print('Initializing AWS clients...', yellow);
    const clients = createClients();
    print('✓ AWS clients initialized', green);
    
    // Get account ID
    print('Retrieving AWS account information...', yellow);
    const accountId = await getAccountId(clients.sts);
    print(`✓ Account ID: ${accountId}`, green);
    
    // Create OAC
    const oacId = await createOriginAccessControl(clients.cloudfront);
    
    // Create distribution
    const distributionInfo = await createDistribution(clients.cloudfront, oacId);
    
    // Update bucket policy
    await updateBucketPolicy(clients.s3, accountId, distributionInfo.id);
    
    // Save configuration
    await saveConfig(distributionInfo);
    
    // Print instructions
    printUsageInstructions(distributionInfo);
    
    // Optionally wait for deployment
    print('Do you want to wait for deployment to complete? (Y/n): ', yellow);
    print('(Or press Ctrl+C to exit - deployment continues in background)', blue);
    
    // Auto-proceed after 5 seconds
    const autoWait = await Promise.race([
      new Promise(resolve => {
        process.stdin.once('data', data => {
          const answer = data.toString().trim().toLowerCase();
          resolve(answer !== 'n' && answer !== 'no');
        });
      }),
      new Promise(resolve => {
        setTimeout(() => {
          console.log();
          print('Auto-proceeding to wait for deployment...', blue);
          resolve(true);
        }, 5000);
      }),
    ]);
    
    if (autoWait) {
      await waitForDeployment(clients.cloudfront, distributionInfo.id);
      console.log();
      print('Setup complete! Your CloudFront distribution is ready to use.', green);
    } else {
      console.log();
      print('Setup initiated. Check AWS Console for deployment status.', blue);
    }
    
  } catch (error) {
    console.log();
    print('='.repeat(70), red);
    print('Setup Failed', red);
    print('='.repeat(70), red);
    console.log();
    print(`Error: ${error.message}`, red);
    console.log();
    print('Troubleshooting:', yellow);
    print('  1. Verify AWS credentials are configured', blue);
    print('  2. Ensure IAM user has CloudFront and S3 permissions', blue);
    print('  3. Check that S3 bucket exists and is accessible', blue);
    print('  4. See docs/CLOUDFRONT_SETUP.md for manual setup', blue);
    console.log();
    process.exit(1);
  }
}

// Run setup
setup();

