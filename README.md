# AQI Notify

A Cloudflare Worker that monitors Air Quality Index (AQI) in Bangkok, Bandung, Jakarta, and Pare (Kediri), then sends a single polished report to Telegram.

## Features

- **Four Locations** - Bangkok, Bandung, Jakarta, and Pare (Kediri)
- **Hourly Threshold Alerts** - One report containing only locations whose US AQI exceeds 100
- **Daily Summary** - One report for all locations at 8:00 AM GMT+7
- **Useful at a Glance** - AQI level, dominant pollutant, pollutant concentrations, weather, and guidance
- **Zero Cost** - Runs on Cloudflare Workers free tier
- **Easy to Customize** - Change locations, threshold, or notification times

## Sample Notification

```
🌏 Daily Air Quality Summary
Bangkok · Bandung · Jakarta · Pare (Kediri)

🟡 Bangkok · AQI 55
Moderate · Main: PM2.5
PM2.5 7.6 · PM10 10.7 · O₃ 91 µg/m³
NO₂ 9 · SO₂ 5.3 · CO 543 µg/m³
🌡️ 30.8°C · 💧 71% · 💨 2.3 m/s

🔴 Bandung · AQI 178
Unhealthy · Main: PM2.5
PM2.5 51.3 · PM10 53 · O₃ 227 µg/m³
NO₂ 8.5 · SO₂ 27.3 · CO 768 µg/m³
🌡️ 29.3°C · 💧 46% · 💨 2 m/s

🏥 Guidance — Bandung:
Everyone should reduce prolonged outdoor activity. Sensitive groups
should avoid it where possible.

🕒 Updated 2026-07-30 14:00 GMT+7
Data: Open-Meteo
```

## Prerequisites

1. [Node.js](https://nodejs.org/) (v18+)
2. [Cloudflare account](https://dash.cloudflare.com/sign-up) (free)
3. Telegram bot token (create via [@BotFather](https://t.me/botfather))

## Quick Start

### 1. Clone and Install

```bash
git clone https://github.com/davediv/aqi-notify.git
cd aqi-notify
npm install
```

### 2. Set Up Telegram

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
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_CHAT_ID
npx wrangler secret put TELEGRAM_THREAD_ID  # optional

# Deploy
npm run deploy
```

## Configuration

### Change Locations

Edit `src/index.ts` and update `CONFIG.LOCATIONS` using the desired coordinates:

```typescript
const CONFIG = {
  LOCATIONS: [
    {
      name: 'Bandung',
      country: 'Indonesia',
      latitude: -6.92222,
      longitude: 107.60694,
    },
  ],
}
```

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
| `GET /check` | Returns current AQI and weather data for all locations as JSON |
| `GET /test-alert` | Sends a test alert notification |
| `GET /test-summary` | Sends a test daily summary |

### Scheduled Tasks

| Cron | Description |
|------|-------------|
| `0 * * * *` | Hourly check, with one alert for locations above the threshold |
| `0 1 * * *` | Daily summary at 8:00 AM GMT+7 |

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

**"Open-Meteo returned incomplete data"**
- Check the Open-Meteo service status and Worker logs
- Confirm every configured latitude and longitude is valid

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

- Air quality and weather data from [Open-Meteo](https://open-meteo.com/)
- Powered by [Cloudflare Workers](https://workers.cloudflare.com/)
