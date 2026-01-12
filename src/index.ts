/**
 * AQI Notify - Bangkok Air Quality Monitor
 *
 * A Cloudflare Worker that monitors Bangkok's Air Quality Index (AQI)
 * and sends notifications via Telegram.
 *
 * Features:
 * - Hourly AQI check with threshold alerts (AQI > 100)
 * - Daily summary at 8:00 AM Bangkok time (1:00 AM UTC)
 * - Full health advisory with pollutant breakdown
 *
 * API: https://aqicn.org/api/
 */

// Configuration
const CONFIG = {
	ALERT_THRESHOLD: 100,
	CITY: 'bangkok',
	CRON: {
		HOURLY: '0 * * * *',
		DAILY_SUMMARY: '0 1 * * *', // 1:00 AM UTC = 8:00 AM Bangkok (UTC+7)
	},
} as const;

// AQI levels and their health implications
const AQI_LEVELS = [
	{ max: 50, level: 'Good', emoji: '🟢', advisory: 'Air quality is satisfactory with little or no risk.' },
	{
		max: 100,
		level: 'Moderate',
		emoji: '🟡',
		advisory: 'Air quality is acceptable. However, there may be moderate health concern for very sensitive people.',
	},
	{
		max: 150,
		level: 'Unhealthy for Sensitive Groups',
		emoji: '🟠',
		advisory:
			'Members of sensitive groups may experience health effects. General public is less likely to be affected.',
	},
	{
		max: 200,
		level: 'Unhealthy',
		emoji: '🔴',
		advisory:
			'Everyone may begin to experience health effects. Sensitive groups may experience more serious effects. Consider wearing a mask outdoors.',
	},
	{
		max: 300,
		level: 'Very Unhealthy',
		emoji: '🟣',
		advisory: 'Health alert: everyone may experience more serious health effects. Avoid outdoor activities.',
	},
	{
		max: Infinity,
		level: 'Hazardous',
		emoji: '🟤',
		advisory: 'Health warning of emergency conditions. Everyone is more likely to be affected. Stay indoors.',
	},
] as const;

// Pollutant display labels
const POLLUTANT_LABELS: Record<string, string> = {
	pm25: 'PM2.5',
	pm10: 'PM10',
	o3: 'O₃',
	no2: 'NO₂',
	so2: 'SO₂',
	co: 'CO',
};

// AQICN API response types
interface AQICNResponse {
	status: string;
	data: {
		aqi: number;
		idx: number;
		city: {
			name: string;
			geo: [number, number];
			url: string;
		};
		dominentpol: string; // Note: This is the actual API field name (typo in API)
		iaqi: {
			pm25?: { v: number };
			pm10?: { v: number };
			o3?: { v: number };
			no2?: { v: number };
			so2?: { v: number };
			co?: { v: number };
			t?: { v: number };
			h?: { v: number };
			w?: { v: number };
			p?: { v: number };
		};
		time: {
			s: string;
			tz: string;
			iso: string;
		};
	};
}

interface AQIData {
	aqi: number;
	city: string;
	dominantPollutant: string;
	pollutants: {
		pm25?: number;
		pm10?: number;
		o3?: number;
		no2?: number;
		so2?: number;
		co?: number;
	};
	weather: {
		temperature?: number;
		humidity?: number;
		wind?: number;
	};
	time: string;
}

function getAQILevel(aqi: number) {
	return AQI_LEVELS.find((level) => aqi <= level.max) || AQI_LEVELS[AQI_LEVELS.length - 1];
}

function getErrorMessage(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}

async function fetchAQI(env: Env): Promise<AQIData> {
	const response = await fetch(`https://api.waqi.info/feed/${CONFIG.CITY}/?token=${env.AQICN_TOKEN}`);

	if (!response.ok) {
		throw new Error(`AQICN API error: ${response.status} ${response.statusText}`);
	}

	const json = (await response.json()) as AQICNResponse;

	if (json.status !== 'ok') {
		throw new Error(`AQICN API returned error status: ${json.status}`);
	}

	const { data } = json;

	// Validate required fields
	if (!data || !data.city || !data.city.name) {
		throw new Error('Incomplete data structure in API response');
	}

	// Validate AQI value (API returns -1 when data is unavailable)
	if (typeof data.aqi !== 'number' || data.aqi < 0) {
		throw new Error(`Invalid AQI value received: ${data.aqi}`);
	}

	return {
		aqi: data.aqi,
		city: data.city.name,
		dominantPollutant: data.dominentpol,
		pollutants: {
			pm25: data.iaqi.pm25?.v,
			pm10: data.iaqi.pm10?.v,
			o3: data.iaqi.o3?.v,
			no2: data.iaqi.no2?.v,
			so2: data.iaqi.so2?.v,
			co: data.iaqi.co?.v,
		},
		weather: {
			temperature: data.iaqi.t?.v,
			humidity: data.iaqi.h?.v,
			wind: data.iaqi.w?.v,
		},
		time: data.time.s,
	};
}

async function sendTelegram(env: Env, message: string): Promise<void> {
	if (!message.trim()) {
		throw new Error('Cannot send empty message to Telegram');
	}

	const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;

	const body: Record<string, string | number> = {
		chat_id: env.TELEGRAM_CHAT_ID,
		text: message,
		parse_mode: 'HTML',
	};

	// Add thread_id if provided (for topic-based groups)
	if (env.TELEGRAM_THREAD_ID) {
		body.message_thread_id = parseInt(env.TELEGRAM_THREAD_ID, 10);
	}

	const response = await fetch(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	});

	if (!response.ok) {
		const error = await response.text();
		throw new Error(`Telegram API error: ${response.status} - ${error}`);
	}
}

function formatPollutants(pollutants: AQIData['pollutants']): string {
	const lines = Object.entries(pollutants)
		.filter(([_, value]) => value !== undefined)
		.map(([key, value]) => `• ${POLLUTANT_LABELS[key] || key}: ${value}`);

	return lines.length > 0 ? lines.join('\n') : 'No pollutant data available';
}

function formatWeather(weather: AQIData['weather']): string {
	const parts: string[] = [];

	if (weather.temperature !== undefined) parts.push(`${weather.temperature}°C`);
	if (weather.humidity !== undefined) parts.push(`${weather.humidity}% humidity`);
	if (weather.wind !== undefined) parts.push(`Wind: ${weather.wind} m/s`);

	return parts.length > 0 ? parts.join(' | ') : '';
}

interface MessageOptions {
	title: string;
	titleEmoji: string;
	aqiLabel: string;
	footer?: string;
}

function formatMessage(data: AQIData, options: MessageOptions): string {
	const level = getAQILevel(data.aqi);
	const weatherInfo = formatWeather(data.weather);

	const parts = [
		`${options.titleEmoji} <b>${options.title}</b>`,
		'',
		`<b>${options.aqiLabel}: ${data.aqi}</b> - ${level.level} ${level.emoji}`,
		'',
		'📊 <b>Pollutants:</b>',
		formatPollutants(data.pollutants),
		'',
		'🏥 <b>Health Advisory:</b>',
		level.advisory,
	];

	if (weatherInfo) {
		parts.push('', `🌡️ ${weatherInfo}`);
	}

	if (options.footer) {
		parts.push('', options.footer);
	}

	parts.push('', `⏰ ${data.time}`);

	return parts.join('\n');
}

function formatAlertMessage(data: AQIData): string {
	return formatMessage(data, {
		title: 'Bangkok Air Quality Alert',
		titleEmoji: '⚠️',
		aqiLabel: 'AQI',
	});
}

function formatDailySummary(data: AQIData): string {
	return formatMessage(data, {
		title: 'Bangkok Daily Air Quality Summary',
		titleEmoji: '📋',
		aqiLabel: 'Current AQI',
		footer: 'Have a good day! 🌅',
	});
}

async function handleWithError(
	operation: () => Promise<Response>,
	errorStatus = 500
): Promise<Response> {
	try {
		return await operation();
	} catch (error) {
		return new Response(`Error: ${getErrorMessage(error)}`, { status: errorStatus });
	}
}

export default {
	async fetch(req: Request, env: Env): Promise<Response> {
		const url = new URL(req.url);

		// Allow manual testing via HTTP
		if (url.pathname === '/test-alert') {
			return handleWithError(async () => {
				const data = await fetchAQI(env);
				await sendTelegram(env, formatAlertMessage(data));
				return new Response(`Alert sent! AQI: ${data.aqi}`, { status: 200 });
			});
		}

		if (url.pathname === '/test-summary') {
			return handleWithError(async () => {
				const data = await fetchAQI(env);
				await sendTelegram(env, formatDailySummary(data));
				return new Response(`Summary sent! AQI: ${data.aqi}`, { status: 200 });
			});
		}

		if (url.pathname === '/check') {
			return handleWithError(async () => {
				const data = await fetchAQI(env);
				return Response.json(data, { status: 200 });
			});
		}

		// Default response with usage instructions
		return new Response(
			`AQI Notify - Bangkok Air Quality Monitor

Endpoints:
- /check - Get current AQI data (JSON)
- /test-alert - Send a test alert notification
- /test-summary - Send a test daily summary

Scheduled tasks:
- Hourly check: Sends alert if AQI > ${CONFIG.ALERT_THRESHOLD}
- Daily summary: Sent at 8:00 AM Bangkok time
`,
			{ status: 200 }
		);
	},

	async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
		const cronPattern = controller.cron;
		const isDailySummary = cronPattern === CONFIG.CRON.DAILY_SUMMARY;

		try {
			const data = await fetchAQI(env);
			console.log(`AQI check at ${new Date().toISOString()}: AQI = ${data.aqi}`);

			// Daily summary at 8:00 AM Bangkok time (1:00 AM UTC)
			if (isDailySummary) {
				await sendTelegram(env, formatDailySummary(data));
				console.log('Daily summary sent');
				return;
			}

			// Hourly check - only send alert if AQI exceeds threshold
			if (data.aqi > CONFIG.ALERT_THRESHOLD) {
				await sendTelegram(env, formatAlertMessage(data));
				console.log(`Alert sent: AQI ${data.aqi} exceeds threshold ${CONFIG.ALERT_THRESHOLD}`);
			}
		} catch (error) {
			// Silent retry - just log the error, will try again next hour
			console.error(`AQI check failed: ${getErrorMessage(error)}`);
		}
	},
} satisfies ExportedHandler<Env>;
