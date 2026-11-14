export interface WeatherCity {
  id: number
  name: string
  latitude: number
  longitude: number
  region: string
}

export interface WeatherReport {
  temperature: number
  code: number
  low: number
  high: number
  updatedAt: number
}

/** One foreground, approximate fix is enough for weather. Never track in the background. */
export async function getWeatherLocation(): Promise<WeatherCity> {
  let latitude: number
  let longitude: number
  try {
    // #ifdef H5
    const { Capacitor } = await import('@capacitor/core')
    if (Capacitor.isNativePlatform()) {
      const { Geolocation } = await import('@capacitor/geolocation')
      let permission = await Geolocation.checkPermissions()
      if (permission.coarseLocation === 'prompt' || permission.coarseLocation === 'prompt-with-rationale') {
        permission = await Geolocation.requestPermissions({ permissions: ['coarseLocation'] })
      }
      if (permission.coarseLocation !== 'granted') throw new Error('LOCATION_DENIED')
      const position = await Geolocation.getCurrentPosition({ enableHighAccuracy: false, timeout: 12000, maximumAge: 30 * 60_000 })
      latitude = position.coords.latitude
      longitude = position.coords.longitude
    } else {
      if (!navigator.geolocation) throw new Error('LOCATION_UNAVAILABLE')
      const position = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: false, timeout: 12000, maximumAge: 30 * 60_000 }))
      latitude = position.coords.latitude
      longitude = position.coords.longitude
    }
    // #endif
    // #ifndef H5
    const position = await new Promise<UniApp.GetLocationSuccess>((resolve, reject) =>
      uni.getLocation({ type: 'wgs84', isHighAccuracy: false, success: resolve, fail: reject }))
    latitude = position.latitude
    longitude = position.longitude
    // #endif
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    const code = cause && typeof cause === 'object' && 'code' in cause ? cause.code : undefined
    if (code === 1 || code === 'OS-PLUG-GLOC-0003' || /denied|auth deny|authorize.*fail/i.test(message)) {
      throw new Error('未开启定位，请在浏览器或系统设置允许定位后重试')
    }
    throw new Error('暂时无法定位，请开启设备定位后重试，或手动选择城市')
  }
  const lat = Number(latitude.toFixed(2))
  const lon = Number(longitude.toFixed(2))
  let name = '当前位置'
  try {
    const data = await getJson(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=zh`)
    if (record(data)) {
      const parts = [data.city, data.locality].filter((value): value is string => typeof value === 'string' && Boolean(value))
      name = [...new Set(parts)].join(' · ') || name
    }
  } catch (error) {
    console.warn('[weather] location name unavailable', error)
  }
  return { id: -1, name, region: '设备定位 · 仅用于获取当地天气', latitude: lat, longitude: lon }
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function isWeatherCity(value: unknown): value is WeatherCity {
  return record(value) && typeof value.id === 'number' && typeof value.name === 'string' &&
    typeof value.region === 'string' && typeof value.latitude === 'number' &&
    Number.isFinite(value.latitude) && Math.abs(value.latitude) <= 90 &&
    typeof value.longitude === 'number' && Number.isFinite(value.longitude) && Math.abs(value.longitude) <= 180
}

export function isWeatherReport(value: unknown): value is WeatherReport {
  return record(value) && ['temperature', 'code', 'low', 'high', 'updatedAt'].every(
    key => typeof value[key] === 'number' && Number.isFinite(value[key])
  )
}

function getJson(url: string): Promise<unknown> {
  return new Promise((resolve, reject) => uni.request({
    url, timeout: 8000,
    success: response => response.statusCode === 200 ? resolve(response.data) : reject(new Error('天气服务暂不可用，请稍后重试')),
    fail: () => reject(new Error('无法获取天气，请检查网络后重试'))
  }))
}

export async function searchWeatherCities(name: string): Promise<WeatherCity[]> {
  const data = await getJson(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name.trim())}&count=5&language=zh&format=json`)
  if (!record(data) || !Array.isArray(data.results)) return []
  return data.results.flatMap((item: unknown) => {
    if (!record(item)) return []
    const city = { ...item, region: [item.admin1, item.country].filter(value => typeof value === 'string').join(' · ') }
    return isWeatherCity(city) ? [city] : []
  })
}

export async function getCityWeather(city: WeatherCity): Promise<WeatherReport> {
  const data = await getJson(`https://api.open-meteo.com/v1/forecast?latitude=${city.latitude}&longitude=${city.longitude}&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=1`)
  if (!record(data) || !record(data.current) || !record(data.daily)) throw new Error('天气数据暂不可用，请稍后重试')
  const report = {
    temperature: data.current.temperature_2m, code: data.current.weather_code,
    low: Array.isArray(data.daily.temperature_2m_min) ? data.daily.temperature_2m_min[0] : undefined,
    high: Array.isArray(data.daily.temperature_2m_max) ? data.daily.temperature_2m_max[0] : undefined,
    updatedAt: Date.now()
  }
  if (!isWeatherReport(report)) throw new Error('天气数据暂不可用，请稍后重试')
  return report
}

export function weatherDescription(code: number) {
  if (code === 0) return '晴'
  if (code === 1) return '晴间多云'
  if (code === 2) return '多云'
  if (code === 3) return '阴'
  if (code <= 48) return '雾'
  if (code >= 95) return '雷雨'
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return '雪'
  return '雨'
}
