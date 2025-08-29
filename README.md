# Qwen Authentication

Get access tokens for the Qwen API.

## Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/coffeegrind123/qwen3-auth.git
   cd qwen3-auth
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

## Usage

### Get access token
```bash
npm run auth
```

### Check if you have valid tokens
```bash
npm run check
```

### Delete saved tokens
```bash
npm run clear
```

## What happens when you authenticate

1. Run `npm run auth`
2. Open the URL it shows you
3. Login to Qwen in your browser
4. The script will save your tokens

## Output

You get your tokens like this:

```json
{
  "access_token": "your_token_here",
  "refresh_token": "your_refresh_token_here",
  "token_type": "Bearer",
  "resource_url": "portal.qwen.ai",
  "expiry_date": 1756446184390
}
```

## Troubleshooting

**No credentials found**: Run `npm run auth`

**Token expired**: Run `npm run auth` again

**Browser didn't open**: Copy the URL and paste it in your browser

**Permission denied**: You clicked "deny" in the browser - try again and click "allow"

## Requirements

- Node.js 16 or newer
- Internet connection

That's it.
