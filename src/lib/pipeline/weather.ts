// Weather integration using Open-Meteo (free, no API key required)
// Provides hourly weather forecasts up to 16 days ahead

interface WeatherResult {
  temp_f: number;
  condition: string;
  icon: string;
  weather_score: number; // 0-10, 10 = perfect
}

interface OpenMeteoHourly {
  time: string[];
  temperature_2m: number[];
  weathercode: number[];
  precipitation_probability: number[];
  windspeed_10m: number[];
}

// WMO Weather codes → human-readable + icon
const WMO_CODES: Record<number, { condition: string; icon: string }> = {
  0: { condition: 'Clear', icon: '☀️' },
  1: { condition: 'Mostly clear', icon: '🌤️' },
  2: { condition: 'Partly cloudy', icon: '⛅' },
  3: { condition: 'Overcast', icon: '☁️' },
  45: { condition: 'Foggy', icon: '🌫️' },
  48: { condition: 'Icy fog', icon: '🌫️' },
  51: { condition: 'Light drizzle', icon: '🌦️' },
  53: { condition: 'Drizzle', icon: '🌦️' },
  55: { condition: 'Heavy drizzle', icon: '🌧️' },
  61: { condition: 'Light rain', icon: '🌦️' },
  63: { condition: 'Rain', icon: '🌧️' },
  65: { condition: 'Heavy rain', icon: '🌧️' },
  71: { condition: 'Light snow', icon: '🌨️' },
  73: { condition: 'Snow', icon: '❄️' },
  75: { condition: 'Heavy snow', icon: '❄️' },
  80: { condition: 'Rain showers', icon: '🌦️' },
  81: { condition: 'Heavy showers', icon: '🌧️' },
  82: { condition: 'Violent showers', icon: '⛈️' },
  95: { condition: 'Thunderstorm', icon: '⛈️' },
  96: { condition: 'Thunderstorm + hail', icon: '⛈️' },
  99: { condition: 'Severe thunderstorm', icon: '⛈️' },
};

// Venue coordinates (lat, lon) — for MVP cities
const VENUE_COORDS: Record<string, { lat: number; lon: number }> = {
  'Comerica Park': { lat: 42.339, lon: -83.049 },
  'Ford Field': { lat: 42.34, lon: -83.045 },
  'Little Caesars Arena': { lat: 42.341, lon: -83.055 },
  'Fifth Third Field': { lat: 41.665, lon: -83.536 },
  'UPMC Park': { lat: 42.132, lon: -80.085 },
  'Van Andel Arena': { lat: 42.963, lon: -85.672 },
  'Keyworth Stadium': { lat: 42.388, lon: -83.094 },
  'Moda Center': { lat: 45.532, lon: -122.667 },
  'Providence Park': { lat: 45.522, lon: -122.692 },
  'Ron Tonkin Field': { lat: 45.528, lon: -122.914 },
  'Veterans Memorial Coliseum': { lat: 45.534, lon: -122.667 },
  // Los Angeles
  'Dodger Stadium': { lat: 34.074, lon: -118.24 },
  'Angel Stadium': { lat: 33.8, lon: -117.883 },
  'SoFi Stadium': { lat: 33.953, lon: -118.339 },
  'Dignity Health Sports Park': { lat: 33.864, lon: -118.261 },
  'BMO Stadium': { lat: 34.012, lon: -118.185 },
};

function celsiusToFahrenheit(c: number): number {
  return Math.round(c * 9 / 5 + 32);
}

/**
 * Calculate a weather score (0-10) for attending an outdoor game
 * 10 = perfect weather, 0 = terrible
 */
function calculateWeatherScore(
  tempF: number,
  weatherCode: number,
  precipProbability: number,
  windSpeed: number
): number {
  let score = 10;

  // Temperature scoring (ideal: 65-80°F)
  if (tempF >= 65 && tempF <= 80) {
    // perfect
  } else if (tempF >= 55 && tempF < 65) {
    score -= 1;
  } else if (tempF >= 80 && tempF < 90) {
    score -= 1;
  } else if (tempF >= 45 && tempF < 55) {
    score -= 2;
  } else if (tempF >= 90 && tempF < 95) {
    score -= 2;
  } else if (tempF >= 35 && tempF < 45) {
    score -= 3;
  } else if (tempF >= 95) {
    score -= 3;
  } else if (tempF < 35) {
    score -= 4;
  }

  // Precipitation scoring
  if (precipProbability > 70) score -= 3;
  else if (precipProbability > 50) score -= 2;
  else if (precipProbability > 30) score -= 1;

  // Weather code scoring (rain, snow, storms)
  if (weatherCode >= 95) score -= 3; // thunderstorms
  else if (weatherCode >= 61) score -= 2; // rain/snow
  else if (weatherCode >= 51) score -= 1; // drizzle

  // Wind scoring (km/h)
  if (windSpeed > 40) score -= 2;
  else if (windSpeed > 25) score -= 1;

  return Math.max(0, Math.min(10, score));
}

/**
 * Get weather forecast for a venue at a specific time
 */
export async function getWeatherForGame(
  venueName: string,
  startTime: string
): Promise<WeatherResult | null> {
  // Find venue coordinates
  const coords = Object.entries(VENUE_COORDS).find(([name]) =>
    venueName.toLowerCase().includes(name.toLowerCase().split(' ')[0])
  )?.[1];

  if (!coords) {
    console.warn(`No coordinates for venue: ${venueName}`);
    return null;
  }

  const gameDate = new Date(startTime);
  const dateStr = gameDate.toISOString().split('T')[0];

  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${coords.lat}&longitude=${coords.lon}&hourly=temperature_2m,weathercode,precipitation_probability,windspeed_10m&start_date=${dateStr}&end_date=${dateStr}&timezone=auto`;

    const response = await fetch(url);
    if (!response.ok) return null;

    const data = await response.json();
    const hourly: OpenMeteoHourly = data.hourly;

    // Find the hour closest to game time
    const gameHour = gameDate.getHours();
    const hourIndex = hourly.time.findIndex((t: string) => {
      const h = new Date(t).getHours();
      return h === gameHour;
    });

    if (hourIndex === -1) return null;

    const tempC = hourly.temperature_2m[hourIndex];
    const tempF = celsiusToFahrenheit(tempC);
    const weatherCode = hourly.weathercode[hourIndex];
    const precipProb = hourly.precipitation_probability[hourIndex];
    const windSpeed = hourly.windspeed_10m[hourIndex];

    const codeInfo = WMO_CODES[weatherCode] || { condition: 'Unknown', icon: '🌡️' };
    const weatherScore = calculateWeatherScore(tempF, weatherCode, precipProb, windSpeed);

    return {
      temp_f: tempF,
      condition: precipProb > 30
        ? `${codeInfo.condition}, ${precipProb}% rain`
        : codeInfo.condition,
      icon: codeInfo.icon,
      weather_score: weatherScore,
    };
  } catch (error) {
    console.error(`Weather fetch failed for ${venueName}:`, error);
    return null;
  }
}
