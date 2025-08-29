#!/usr/bin/env node

const { promises: fs } = require('fs');
const path = require('path');
const { fetch } = require('undici');
const crypto = require('crypto');
const qrcode = require('qrcode-terminal');
const open = require('open');

// Configuration
const CONFIG = {
  QWEN_DIR: '.qwen',
  CREDENTIALS_FILE: 'oauth_creds.json',
  OAUTH_BASE_URL: 'https://chat.qwen.ai',
  SCOPE: 'openid profile email model.completion',
  GRANT_TYPE: 'urn:ietf:params:oauth:grant-type:device_code'
};

// Helper Functions
function generateRandomClientId() {
  return crypto.randomBytes(16).toString('hex');
}

function generateCodeVerifier() {
  return crypto.randomBytes(32).toString('base64url');
}

function generateCodeChallenge(codeVerifier) {
  const hash = crypto.createHash('sha256');
  hash.update(codeVerifier);
  return hash.digest('base64url');
}

class QwenAuth {
  constructor() {
    this.qwenDir = path.join(process.env.HOME || process.env.USERPROFILE, CONFIG.QWEN_DIR);
    this.credentialsPath = path.join(this.qwenDir, CONFIG.CREDENTIALS_FILE);
    this.clientId = generateRandomClientId();
  }

  // Ensure the .qwen directory exists
  async ensureDir() {
    try {
      await fs.mkdir(this.qwenDir, { recursive: true });
    } catch (error) {
      if (error.code !== 'EEXIST') {
        throw new Error(`Failed to create directory ${this.qwenDir}: ${error.message}`);
      }
    }
  }

  // Load existing credentials
  async loadCredentials() {
    try {
      const credentialsData = await fs.readFile(this.credentialsPath, 'utf8');
      return JSON.parse(credentialsData);
    } catch (error) {
      return null;
    }
  }

  // Save credentials to file
  async saveCredentials(credentials) {
    await this.ensureDir();
    await fs.writeFile(this.credentialsPath, JSON.stringify(credentials, null, 2));
  }

  // Check if token is still valid (with 30-second buffer)
  isTokenValid(credentials) {
    if (!credentials || !credentials.expiry_date) return false;
    return Date.now() < (credentials.expiry_date - 30000);
  }

  // Refresh access token using refresh token
  async refreshToken(credentials) {
    console.log('Refreshing authentication token...');
    
    const bodyData = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: credentials.refresh_token,
      client_id: this.clientId,
    });

    try {
      const response = await fetch(`${CONFIG.OAUTH_BASE_URL}/api/v1/oauth2/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
        },
        body: bodyData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`Token refresh failed: ${errorData.error} - ${errorData.error_description}`);
      }

      const tokenData = await response.json();
      const newCredentials = {
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token || credentials.refresh_token,
        token_type: tokenData.token_type,
        resource_url: tokenData.resource_url || credentials.resource_url,
        expiry_date: Date.now() + (tokenData.expires_in * 1000),
      };

      await this.saveCredentials(newCredentials);
      console.log('Token refresh completed successfully.\n');
      return newCredentials;
    } catch (error) {
      throw new Error(`Failed to refresh token: ${error.message}`);
    }
  }

  // Initiate OAuth device flow
  async initiateDeviceFlow() {
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);

    const bodyData = new URLSearchParams({
      client_id: this.clientId,
      scope: CONFIG.SCOPE,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });

    const response = await fetch(`${CONFIG.OAUTH_BASE_URL}/api/v1/oauth2/device/code`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      body: bodyData,
    });

    if (!response.ok) {
      const errorData = await response.text();
      throw new Error(`Device authorization failed: ${response.status} ${response.statusText}`);
    }

    const result = await response.json();
    
    if (!result.device_code) {
      throw new Error(`Device authorization failed: ${result.error || 'Unknown error'}`);
    }

    return { ...result, code_verifier: codeVerifier };
  }

  // Poll for token after user authorization
  async pollForToken(deviceCode, codeVerifier) {
    const maxAttempts = 60; // 5 minutes max
    let pollInterval = 5000; // 5 seconds

    console.log('Awaiting user authorization...');
    
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const bodyData = new URLSearchParams({
        grant_type: CONFIG.GRANT_TYPE,
        client_id: this.clientId,
        device_code: deviceCode,
        code_verifier: codeVerifier,
      });

      try {
        const response = await fetch(`${CONFIG.OAUTH_BASE_URL}/api/v1/oauth2/token`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Accept': 'application/json',
          },
          body: bodyData,
        });

        if (response.ok) {
          const tokenData = await response.json();
          return {
            access_token: tokenData.access_token,
            refresh_token: tokenData.refresh_token,
            token_type: tokenData.token_type,
            resource_url: tokenData.resource_url || tokenData.endpoint,
            expiry_date: Date.now() + (tokenData.expires_in * 1000),
          };
        }

        const errorData = await response.json();

        // Handle OAuth standard polling responses
        if (errorData.error === 'authorization_pending') {
          process.stdout.write('.');
          await new Promise(resolve => setTimeout(resolve, pollInterval));
          continue;
        }

        if (errorData.error === 'slow_down') {
          pollInterval = Math.min(pollInterval * 1.5, 10000);
          await new Promise(resolve => setTimeout(resolve, pollInterval));
          continue;
        }

        if (errorData.error === 'expired_token') {
          throw new Error('Device code expired. Please restart the authentication process.');
        }

        if (errorData.error === 'access_denied') {
          throw new Error('Authorization denied by user.');
        }

        throw new Error(`Authentication failed: ${errorData.error} - ${errorData.error_description}`);

      } catch (error) {
        if (error.message.includes('expired_token') || error.message.includes('access_denied')) {
          throw error;
        }
        // Continue polling for other errors
        await new Promise(resolve => setTimeout(resolve, pollInterval));
      }
    }

    throw new Error('Authentication timeout. Please try again.');
  }

  // Display authorization instructions
  displayAuthInstructions(deviceFlow) {
    console.log('\n' + '='.repeat(60));
    console.log('QWEN API AUTHENTICATION');
    console.log('='.repeat(60));
    console.log('\nPlease complete authentication by visiting:');
    console.log(`\n${deviceFlow.verification_uri_complete}\n`);
    
    console.log('Authorization Code:', deviceFlow.user_code);
    console.log('\nAlternatively, scan the QR code below:');
    
    qrcode.generate(deviceFlow.verification_uri_complete, { small: true });
    
    console.log('\nPress Ctrl+C to cancel authentication process\n');
  }

  // Format and display credentials
  displayCredentials(credentials) {
    console.log('\n' + '='.repeat(60));
    console.log('AUTHENTICATION COMPLETED');
    console.log('='.repeat(60));
    
    console.log('\nAPI Key:');
    console.log(credentials.access_token);
    
    const expiryDate = new Date(credentials.expiry_date);
    console.log(`\nExpiration: ${expiryDate.toLocaleString()}`);
    console.log(`Storage Location: ${this.credentialsPath}`);
    console.log('\nAuthentication process completed successfully.');
  }

  // Main authentication flow
  async authenticate() {
    try {
      console.log('Initializing Qwen API authentication...\n');
      
      // Start new authentication flow
      console.log('Initiating OAuth device authorization...');
      const deviceFlow = await this.initiateDeviceFlow();
      
      this.displayAuthInstructions(deviceFlow);
      
      // Try to open browser automatically
      try {
        await open(deviceFlow.verification_uri_complete);
        console.log('Default browser launched automatically');
      } catch (error) {
        console.log('Please manually open the provided URL in your browser');
      }
      
      // Poll for token
      const credentials = await this.pollForToken(deviceFlow.device_code, deviceFlow.code_verifier);
      
      // Save credentials
      await this.saveCredentials(credentials);
      
      console.log('\n'); // New line after polling dots
      this.displayCredentials(credentials);
      
      return credentials;
      
    } catch (error) {
      console.error('\nAuthentication failed:', error.message);
      process.exit(1);
    }
  }
}

// CLI interface
async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  
  const auth = new QwenAuth();
  
  switch (command) {
    case 'check':
      console.log('Verifying existing credentials...\n');
      const credentials = await auth.loadCredentials();
      if (credentials) {
        if (auth.isTokenValid(credentials)) {
          console.log('Valid credentials located.');
          auth.displayCredentials(credentials);
        } else {
          console.log('Credentials found but expired.');
          const expiryDate = new Date(credentials.expiry_date);
          console.log(`Expiration date: ${expiryDate.toLocaleString()}`);
          console.log('\nExecute without arguments to re-authenticate.');
        }
      } else {
        console.log('No credentials found.');
        console.log('Execute without arguments to authenticate.');
      }
      break;
      
    case 'clear':
      try {
        await auth.saveCredentials({});
        await require('fs').promises.unlink(auth.credentialsPath);
        console.log('Credentials cleared successfully.');
      } catch (error) {
        console.log('No credentials to clear.');
      }
      break;
      
    case 'help':
    case '--help':
    case '-h':
      console.log('Qwen Authentication Script');
      console.log('\nUsage:');
      console.log('  node auth.js         # Authenticate (default)');
      console.log('  node auth.js check   # Check existing credentials');
      console.log('  node auth.js clear   # Clear stored credentials');
      console.log('  node auth.js help    # Show this help');
      break;
      
    default:
      await auth.authenticate();
      break;
  }
}

// Run the script
if (require.main === module) {
  main().catch(error => {
    console.error('\nOperation failed:', error.message);
    process.exit(1);
  });
}

module.exports = { QwenAuth };
