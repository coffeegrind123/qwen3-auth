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

## Using Your API Key

Once you get your API key, use it to make requests to the Qwen API:

**Endpoint:** `https://portal.qwen.ai/v1/chat/completions`

**Example curl command:**
```bash
curl -X POST "https://portal.qwen.ai/v1/chat/completions" \
  -H "Authorization: Bearer YOUR_API_KEY_HERE" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d '{
    "model": "qwen3-coder-plus",
    "messages": [
      {
        "role": "user",
        "content": "Write a simple Python function to calculate fibonacci numbers"
      }
    ],
    "temperature": 0.7,
    "max_tokens": 1000
  }'
```

Replace `YOUR_API_KEY_HERE` with the actual API key you get from running `npm run auth`.

## What happens when you authenticate

1. Run `npm run auth`
2. Open the URL it shows you
3. Login to Qwen in your browser
4. The script will save your tokens

## Troubleshooting

**No credentials found**: Run `npm run auth`

**Token expired**: Run `npm run auth` again
