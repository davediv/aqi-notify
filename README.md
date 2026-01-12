# AQI Notify

A Cloudflare Worker that monitors Air Quality Index (AQI) and sends notifications via Telegram. Get hourly alerts when air quality becomes unhealthy and daily summaries to start your day informed.

## Features

- **Hourly Threshold Alerts** - Get notified when AQI exceeds 100 (Unhealthy for Sensitive Groups)
- **Daily Summary** - Receive a morning report at 8:00 AM (configurable timezone)
- **Full Health Advisory** - AQI level, pollutant breakdown (PM2.5, PM10, O₃, etc.), weather conditions, and health recommendations
- **Zero Cost** - Runs on Cloudflare Workers free tier
- **Easy to Customize** - Change city, threshold, or notification times

## Sample Notification

```
⚠️ Bangkok Air Quality Alert

AQI: 156 - Unhealthy 🔴

📊 Pollutants:
• PM2.5: 89
• PM10: 45
• O₃: 32

🏥 Health Advisory:
Everyone may begin to experience health effects. Sensitive groups
may experience more serious effects. Consider wearing a mask outdoors.

🌡️ 28°C | 65% humidity | Wind: 2 m/s

⏰ 2024-01-15 14:00:00
```

## Prerequisites

1. [Node.js](https://nodejs.org/) (v18+)
2. [Cloudflare account](https://dash.cloudflare.com/sign-up) (free)
3. [AQICN API token](https://aqicn.org/data-platform/token/) (free)
4. Telegram bot token (create via [@BotFather](https://t.me/botfather))

## Quick Start

### 1. Clone and Install

```bash
git clone https://github.com/davediv/aqi-notify.git
cd aqi-notify
npm install
```

### 2. Get Your API Tokens

**AQICN Token:**
1. Go to https://aqicn.org/data-platform/token/
2. Enter your email and get a free token

**Telegram Bot:**
1. Message [@BotFather](https://t.me/botfather) on Telegram
2. Send `/newbot` and follow the prompts
3. Copy the bot token

**Telegram Chat ID:**
1. Message [@userinfobot](https://t.me/userinfobot) on Telegram
2. It will reply with your chat ID

**Telegram Thread ID (optional):**
- Only needed if sending to a topic in a group
- Right-click on the topic → Copy Link → the number after the last `/` is the thread ID

### 3. Configure Environment

For local development, create `.dev.vars`:

```bash
cp .dev.vars.example .dev.vars
```

Edit `.dev.vars`:
```
AQICN_TOKEN=your_aqicn_token
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
TELEGRAM_CHAT_ID=your_chat_id
TELEGRAM_THREAD_ID=optional_thread_id
```

### 4. Test Locally

```bash
npm run dev
```

Then test the endpoints:
```bash
# Check current AQI
curl http://localhost:8787/check

# Send test alert
curl http://localhost:8787/test-alert

# Send test daily summary
curl http://localhost:8787/test-summary
```

### 5. Deploy to Cloudflare

```bash
# Login to Cloudflare
npx wrangler login

# Add secrets
npx wrangler secret put AQICN_TOKEN
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_CHAT_ID
npx wrangler secret put TELEGRAM_THREAD_ID  # optional

# Deploy
npm run deploy
```

## Configuration

### Change City

Edit `src/index.ts` and update the `CONFIG` object:

```typescript
const CONFIG = {
  ALERT_THRESHOLD: 100,
  CITY: 'shanghai',  // Change to your city
  // ...
}
```

Find your city name at https://aqicn.org/city/all/

### Change Alert Threshold

```typescript
const CONFIG = {
  ALERT_THRESHOLD: 150,  // Only alert when "Unhealthy"
  // ...
}
```

AQI Levels:
| AQI | Level | Color |
|-----|-------|-------|
| 0-50 | Good | 🟢 |
| 51-100 | Moderate | 🟡 |
| 101-150 | Unhealthy for Sensitive Groups | 🟠 |
| 151-200 | Unhealthy | 🔴 |
| 201-300 | Very Unhealthy | 🟣 |
| 300+ | Hazardous | 🟤 |

### Change Schedule

Edit `wrangler.jsonc`:

```jsonc
{
  "triggers": {
    "crons": [
      "0 * * * *",    // Hourly check (every hour at minute 0)
      "0 1 * * *"     // Daily summary (1:00 AM UTC = 8:00 AM UTC+7)
    ]
  }
}
```

And update `CONFIG.CRON` in `src/index.ts` to match.

**Timezone Note:** Cloudflare cron uses UTC. To convert:
- 8:00 AM Bangkok (UTC+7) = 1:00 AM UTC
- 8:00 AM Tokyo (UTC+9) = 11:00 PM UTC (previous day)
- 8:00 AM New York (UTC-5) = 1:00 PM UTC

## API Reference

### HTTP Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /` | Shows usage information |
| `GET /check` | Returns current AQI data as JSON |
| `GET /test-alert` | Sends a test alert notification |
| `GET /test-summary` | Sends a test daily summary |

### Scheduled Tasks

| Cron | Description |
|------|-------------|
| `0 * * * *` | Hourly AQI check, alerts if above threshold |
| `0 1 * * *` | Daily summary at 8:00 AM Bangkok time |

## Development

```bash
# Start dev server
npm run dev

# Type check
npx tsc --noEmit

# Regenerate Cloudflare types
npm run cf-typegen

# Deploy
npm run deploy
```

## Troubleshooting

**"Invalid AQI value received: -1"**
- The AQICN API returns -1 when data is unavailable for the city
- Try a different city or check https://aqicn.org for available stations

**Telegram message not received**
- Verify your bot token and chat ID
- Make sure you've started a conversation with the bot first
- Check if thread ID is correct (for topic groups)

**Cron not triggering**
- Cloudflare Workers free tier has limited cron invocations
- Check the Workers dashboard for logs and errors

## License

MIT

## Acknowledgments

- Air quality data from [World Air Quality Index Project](https://aqicn.org/)
- Powered by [Cloudflare Workers](https://workers.cloudflare.com/)
