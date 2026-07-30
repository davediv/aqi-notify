/**
 * AQI Notify - Multi-city Air Quality Monitor
 *
 * A Cloudflare Worker that monitors air quality in Bangkok, Bandung,
 * Jakarta, and Pare (Kediri), then sends notifications via Telegram.
 *
 * Air quality and weather data: https://open-meteo.com/
 */

const CONFIG = {
	ALERT_THRESHOLD: 100,
	LOCATIONS: [
		{ name: 'Bangkok', country: 'Thailand', latitude: 13.75398, longitude: 100.50144 },
		{ name: 'Bandung', country: 'Indonesia', latitude: -6.92222, longitude: 107.60694 },
		{ name: 'Jakarta', country: 'Indonesia', latitude: -6.21462, longitude: 106.84513 },
		{ name: 'Pare (Kediri)', country: 'Indonesia', latitude: -7.7679, longitude: 112.198 },
	],
	CRON: {
		HOURLY: '0 * * * *',
		DAILY_SUMMARY: '0 1 * * *', // 1:00 AM UTC = 8:00 AM in all configured cities (UTC+7)
	},
} as const;

const AQI_LEVELS = [
	{ max: 50, level: 'Good', emoji: '🟢', advisory: 'Air quality is satisfactory with little or no risk.' },
	{
		max: 100,
		level: 'Moderate',
		emoji: '🟡',
		advisory: 'Air quality is acceptable. Unusually sensitive people should consider limiting prolonged outdoor activity.',
	},
	{
		max: 150,
		level: 'Unhealthy for Sensitive Groups',
		emoji: '🟠',
		advisory: 'Sensitive groups should limit prolonged outdoor activity. The general public is less likely to be affected.',
	},
	{
		max: 200,
		level: 'Unhealthy',
		emoji: '🔴',
		advisory: 'Everyone should reduce prolonged outdoor activity. Sensitive groups should avoid it where possible.',
	},
	{
		max: 300,
		level: 'Very Unhealthy',
		emoji: '🟣',
		advisory: 'Avoid outdoor activity where possible. Everyone may experience more serious health effects.',
	},
	{
		max: Infinity,
		level: 'Hazardous',
		emoji: '🟤',
		advisory: 'Stay indoors and avoid outdoor activity. Emergency-level health effects are more likely for everyone.',
	},
] as const;

type PollutantKey = 'pm25' | 'pm10' | 'o3' | 'no2' | 'so2' | 'co';

const POLLUTANT_LABELS: Record<PollutantKey, string> = {
	pm25: 'PM2.5',
	pm10: 'PM10',
	o3: 'O₃',
	no2: 'NO₂',
	so2: 'SO₂',
	co: 'CO',
};

interface OpenMeteoAirQualityResponse {
	current: {
		time: string;
		us_aqi: number | null;
		us_aqi_pm2_5: number | null;
		us_aqi_pm10: number | null;
		us_aqi_nitrogen_dioxide: number | null;
		us_aqi_carbon_monoxide: number | null;
		us_aqi_ozone: number | null;
		us_aqi_sulphur_dioxide: number | null;
		pm10: number | null;
		pm2_5: number | null;
		carbon_monoxide: number | null;
		nitrogen_dioxide: number | null;
		sulphur_dioxide: number | null;
		ozone: number | null;
	};
}

interface OpenMeteoWeatherResponse {
	current: {
		temperature_2m: number | null;
		relative_humidity_2m: number | null;
		wind_speed_10m: number | null;
	};
}

interface AQIData {
	location: string;
	country: string;
	aqi: number;
	dominantPollutant: PollutantKey;
	pollutants: Record<PollutantKey, number>;
	weather: {
		temperature: number;
		humidity: number;
		wind: number;
	};
	time: string;
}

function getAQILevel(aqi: number) {
	return AQI_LEVELS.find((level) => aqi <= level.max) ?? AQI_LEVELS[AQI_LEVELS.length - 1];
}

function getErrorMessage(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}

function requireNumber(value: number | null, field: string, minimum = 0): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum) {
		throw new Error(`Invalid ${field} value received: ${value}`);
	}

	return value;
}

async function fetchJSON<T>(url: URL, serviceName: string): Promise<T> {
	const response = await fetch(url, {
		headers: { Accept: 'application/json' },
	});

	if (!response.ok) {
		throw new Error(`${serviceName} error: ${response.status} ${response.statusText}`);
	}

	return response.json<T>();
}

function buildAirQualityURL(): URL {
	const url = new URL('https://air-quality-api.open-meteo.com/v1/air-quality');
	url.searchParams.set('latitude', CONFIG.LOCATIONS.map(({ latitude }) => latitude).join(','));
	url.searchParams.set('longitude', CONFIG.LOCATIONS.map(({ longitude }) => longitude).join(','));
	url.searchParams.set(
		'current',
		[
			'us_aqi',
			'us_aqi_pm2_5',
			'us_aqi_pm10',
			'us_aqi_nitrogen_dioxide',
			'us_aqi_carbon_monoxide',
			'us_aqi_ozone',
			'us_aqi_sulphur_dioxide',
			'pm10',
			'pm2_5',
			'carbon_monoxide',
			'nitrogen_dioxide',
			'sulphur_dioxide',
			'ozone',
		].join(',')
	);
	url.searchParams.set('timezone', 'auto');
	return url;
}

function buildWeatherURL(): URL {
	const url = new URL('https://api.open-meteo.com/v1/forecast');
	url.searchParams.set('latitude', CONFIG.LOCATIONS.map(({ latitude }) => latitude).join(','));
	url.searchParams.set('longitude', CONFIG.LOCATIONS.map(({ longitude }) => longitude).join(','));
	url.searchParams.set('current', 'temperature_2m,relative_humidity_2m,wind_speed_10m');
	url.searchParams.set('wind_speed_unit', 'ms');
	url.searchParams.set('timezone', 'auto');
	return url;
}

function getDominantPollutant(current: OpenMeteoAirQualityResponse['current']): PollutantKey {
	const components: Array<[PollutantKey, number]> = [
		['pm25', requireNumber(current.us_aqi_pm2_5, 'PM2.5 AQI')],
		['pm10', requireNumber(current.us_aqi_pm10, 'PM10 AQI')],
		['no2', requireNumber(current.us_aqi_nitrogen_dioxide, 'NO₂ AQI')],
		['co', requireNumber(current.us_aqi_carbon_monoxide, 'CO AQI')],
		['o3', requireNumber(current.us_aqi_ozone, 'O₃ AQI')],
		['so2', requireNumber(current.us_aqi_sulphur_dioxide, 'SO₂ AQI')],
	];

	return components.reduce((highest, component) => (component[1] > highest[1] ? component : highest))[0];
}

async function fetchAQI(): Promise<AQIData[]> {
	const [airQualityResponses, weatherResponses] = await Promise.all([
		fetchJSON<OpenMeteoAirQualityResponse[]>(buildAirQualityURL(), 'Open-Meteo Air Quality API'),
		fetchJSON<OpenMeteoWeatherResponse[]>(buildWeatherURL(), 'Open-Meteo Weather API'),
	]);

	if (!Array.isArray(airQualityResponses) || airQualityResponses.length !== CONFIG.LOCATIONS.length) {
		throw new Error('Open-Meteo returned incomplete air quality data');
	}

	if (!Array.isArray(weatherResponses) || weatherResponses.length !== CONFIG.LOCATIONS.length) {
		throw new Error('Open-Meteo returned incomplete weather data');
	}

	return CONFIG.LOCATIONS.map((location, index) => {
		const airQuality = airQualityResponses[index]?.current;
		const weather = weatherResponses[index]?.current;

		if (!airQuality || !weather || typeof airQuality.time !== 'string') {
			throw new Error(`Open-Meteo returned incomplete data for ${location.name}`);
		}

		return {
			location: location.name,
			country: location.country,
			aqi: requireNumber(airQuality.us_aqi, `${location.name} AQI`),
			dominantPollutant: getDominantPollutant(airQuality),
			pollutants: {
				pm25: requireNumber(airQuality.pm2_5, `${location.name} PM2.5`),
				pm10: requireNumber(airQuality.pm10, `${location.name} PM10`),
				o3: requireNumber(airQuality.ozone, `${location.name} O₃`),
				no2: requireNumber(airQuality.nitrogen_dioxide, `${location.name} NO₂`),
				so2: requireNumber(airQuality.sulphur_dioxide, `${location.name} SO₂`),
				co: requireNumber(airQuality.carbon_monoxide, `${location.name} CO`),
			},
			weather: {
				temperature: requireNumber(weather.temperature_2m, `${location.name} temperature`, -Infinity),
				humidity: requireNumber(weather.relative_humidity_2m, `${location.name} humidity`),
				wind: requireNumber(weather.wind_speed_10m, `${location.name} wind speed`),
			},
			time: airQuality.time,
		};
	});
}

async function sendTelegram(env: Env, message: string): Promise<void> {
	if (!message.trim()) {
		throw new Error('Cannot send an empty message to Telegram');
	}

	const body: Record<string, string | number> = {
		chat_id: env.TELEGRAM_CHAT_ID,
		text: message,
		parse_mode: 'HTML',
	};

	if (env.TELEGRAM_THREAD_ID) {
		const threadId = Number.parseInt(env.TELEGRAM_THREAD_ID, 10);
		if (!Number.isFinite(threadId)) {
			throw new Error('TELEGRAM_THREAD_ID must be a number');
		}
		body.message_thread_id = threadId;
	}

	const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	});

	if (!response.ok) {
		const error = await response.text();
		throw new Error(`Telegram API error: ${response.status} - ${error.slice(0, 500)}`);
	}
}

function formatNumber(value: number): string {
	return new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(value);
}

function formatLocation(data: AQIData): string[] {
	const level = getAQILevel(data.aqi);
	const pollutants = data.pollutants;

	return [
		`${level.emoji} <b>${data.location}</b> · <b>AQI ${formatNumber(data.aqi)}</b>`,
		`${level.level} · Main: ${POLLUTANT_LABELS[data.dominantPollutant]}`,
		`PM2.5 ${formatNumber(pollutants.pm25)} · PM10 ${formatNumber(pollutants.pm10)} · O₃ ${formatNumber(pollutants.o3)} µg/m³`,
		`NO₂ ${formatNumber(pollutants.no2)} · SO₂ ${formatNumber(pollutants.so2)} · CO ${formatNumber(pollutants.co)} µg/m³`,
		`🌡️ ${formatNumber(data.weather.temperature)}°C · 💧 ${formatNumber(data.weather.humidity)}% · 💨 ${formatNumber(data.weather.wind)} m/s`,
	];
}

interface MessageOptions {
	title: string;
	titleEmoji: string;
	subtitle: string;
	footer?: string;
}

function formatMessage(data: AQIData[], options: MessageOptions): string {
	if (data.length === 0) {
		throw new Error('Cannot format a report without location data');
	}

	const worstLocation = data.reduce((worst, location) => (location.aqi > worst.aqi ? location : worst));
	const divider = '━━━━━━━━━━━━━━';
	const parts = [
		divider,
		`${options.titleEmoji} <b>${options.title}</b>`,
		`<i>${options.subtitle}</i>`,
	];

	for (const location of data) {
		parts.push('', ...formatLocation(location));
	}

	parts.push(
		'',
		`🏥 <b>Guidance — ${worstLocation.location}:</b>`,
		getAQILevel(worstLocation.aqi).advisory
	);

	if (options.footer) {
		parts.push('', options.footer);
	}

	parts.push('', `🕒 Updated ${data[0].time.replace('T', ' ')} GMT+7`, 'Data: Open-Meteo', divider);

	return parts.join('\n');
}

function formatAlertMessage(data: AQIData[], subtitle?: string): string {
	return formatMessage(data, {
		title: 'Air Quality Alert',
		titleEmoji: '⚠️',
		subtitle: subtitle ?? `${data.length} ${data.length === 1 ? 'city is' : 'cities are'} above AQI ${CONFIG.ALERT_THRESHOLD}`,
	});
}

function formatDailySummary(data: AQIData[]): string {
	return formatMessage(data, {
		title: 'Daily Air Quality Summary',
		titleEmoji: '🌏',
		subtitle: 'Bangkok · Bandung · Jakarta · Pare (Kediri)',
		footer: 'Take care and have a good day! 🌅',
	});
}

function getAlertLocations(data: AQIData[]): AQIData[] {
	return data.filter(({ aqi }) => aqi > CONFIG.ALERT_THRESHOLD);
}

async function handleWithError(operation: () => Promise<Response>, errorStatus = 500): Promise<Response> {
	try {
		return await operation();
	} catch (error) {
		return new Response(`Error: ${getErrorMessage(error)}`, { status: errorStatus });
	}
}

export default {
	async fetch(req: Request, env: Env): Promise<Response> {
		const url = new URL(req.url);

		if (url.pathname === '/test-alert') {
			return handleWithError(async () => {
				const data = await fetchAQI();
				const alertLocations = getAlertLocations(data);
				const reportData = alertLocations.length > 0 ? alertLocations : data;
				const subtitle =
					alertLocations.length > 0
						? `Manual test · ${alertLocations.length} ${alertLocations.length === 1 ? 'city is' : 'cities are'} above AQI ${CONFIG.ALERT_THRESHOLD}`
						: `Manual test · no city is above AQI ${CONFIG.ALERT_THRESHOLD}, showing all`;

				await sendTelegram(env, formatAlertMessage(reportData, subtitle));
				return Response.json({ sent: true, alertLocations: alertLocations.map(({ location }) => location) });
			});
		}

		if (url.pathname === '/test-summary') {
			return handleWithError(async () => {
				const data = await fetchAQI();
				await sendTelegram(env, formatDailySummary(data));
				return Response.json({ sent: true, locations: data.map(({ location }) => location) });
			});
		}

		if (url.pathname === '/check') {
			return handleWithError(async () => {
				const data = await fetchAQI();
				return Response.json({
					threshold: CONFIG.ALERT_THRESHOLD,
					source: 'Open-Meteo',
					locations: data,
				});
			});
		}

		return new Response(
			`AQI Notify - Multi-city Air Quality Monitor

Locations:
- Bangkok
- Bandung
- Jakarta
- Pare (Kediri)

Endpoints:
- /check - Get current data for all locations (JSON)
- /test-alert - Send a test alert notification
- /test-summary - Send a test daily summary

Scheduled tasks:
- Hourly check: Alerts for locations above AQI ${CONFIG.ALERT_THRESHOLD}
- Daily summary: All locations at 8:00 AM GMT+7
`,
			{ status: 200 }
		);
	},

	async scheduled(controller: ScheduledController, env: Env): Promise<void> {
		// The hourly and daily cron expressions overlap at 01:00 UTC. Let the
		// daily summary cover that hour so Telegram receives only one report.
		if (
			controller.cron === CONFIG.CRON.HOURLY &&
			new Date(controller.scheduledTime).getUTCHours() === 1
		) {
			console.log(JSON.stringify({ event: 'hourly_alert_skipped_for_daily_summary' }));
			return;
		}

		try {
			const data = await fetchAQI();

			console.log(
				JSON.stringify({
					event: 'aqi_check',
					cron: controller.cron,
					locations: data.map(({ location, aqi }) => ({ location, aqi })),
				})
			);

			if (controller.cron === CONFIG.CRON.DAILY_SUMMARY) {
				await sendTelegram(env, formatDailySummary(data));
				console.log(JSON.stringify({ event: 'daily_summary_sent', locationCount: data.length }));
				return;
			}

			const alertLocations = getAlertLocations(data);
			if (alertLocations.length > 0) {
				await sendTelegram(env, formatAlertMessage(alertLocations));
				console.log(
					JSON.stringify({
						event: 'threshold_alert_sent',
						threshold: CONFIG.ALERT_THRESHOLD,
						locations: alertLocations.map(({ location, aqi }) => ({ location, aqi })),
					})
				);
			}
		} catch (error) {
			console.error(
				JSON.stringify({
					event: 'aqi_check_failed',
					cron: controller.cron,
					error: getErrorMessage(error),
				})
			);
			throw error;
		}
	},
} satisfies ExportedHandler<Env>;
