/**
 * Environment bindings for the AQI Notify Worker
 *
 * These secrets must be set via `wrangler secret put`:
 * - wrangler secret put AQICN_TOKEN
 * - wrangler secret put TELEGRAM_BOT_TOKEN
 * - wrangler secret put TELEGRAM_CHAT_ID
 * - wrangler secret put TELEGRAM_THREAD_ID (optional)
 */
interface Env {
	/** AQICN API token from https://aqicn.org/data-platform/token/ */
	AQICN_TOKEN: string;

	/** Telegram bot token from @BotFather */
	TELEGRAM_BOT_TOKEN: string;

	/** Telegram chat ID to send notifications to */
	TELEGRAM_CHAT_ID: string;

	/** Optional: Telegram thread ID for topic-based groups */
	TELEGRAM_THREAD_ID?: string;
}
