import { defineStore } from 'pinia'
import { getCityWeather, getWeatherLocation, isWeatherCity, isWeatherReport, weatherDescription, type WeatherCity, type WeatherReport } from '@/api/weather'
import { dayKey, todayKey } from '@/utils/format'

const KEY = 'note-weather'

function restore(): { city: WeatherCity | null; report: WeatherReport | null; source: 'location' | 'city' } {
  try {
    const saved: unknown = uni.getStorageSync(KEY)
    const value: unknown = typeof saved === 'string' ? JSON.parse(saved) : saved
    if (value && typeof value === 'object' && 'city' in value && isWeatherCity(value.city)) {
      return { city: value.city, report: 'report' in value && isWeatherReport(value.report) ? value.report : null,
        source: 'source' in value && value.source === 'city' ? 'city' : 'location' }
    }
  } catch (error) {
    console.warn('[weather] unable to restore preference', error)
  }
  return { city: null, report: null, source: 'location' }
}

export const useWeatherStore = defineStore('weather', {
  state: () => ({ ...restore(), loading: false, locating: false, locationAttempted: false, error: '' }),
  getters: {
    fresh: state => Boolean(state.report && dayKey(new Date(state.report.updatedAt).toISOString()) === todayKey()),
    headerLabel(): string {
      if (this.fresh && this.report) return `${weatherDescription(this.report.code)} · ${Math.round(this.report.temperature)}°C`
      if (this.locating) return '正在定位…'
      if (!this.city) return this.error ? '定位未完成' : '当地天气'
      return this.loading ? '更新天气中…' : '天气待更新'
    },
    icon(): 'sun' | 'rain' | 'cloud' | 'snow' | 'fog' | 'storm' {
      if (!this.fresh || !this.report) return 'cloud'
      const code = this.report.code
      if (code === 0) return 'sun'
      if (code === 45 || code === 48) return 'fog'
      if (code >= 95) return 'storm'
      if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow'
      return code >= 51 ? 'rain' : 'cloud'
    }
  },
  actions: {
    async refresh(force = false) {
      if (this.loading) return
      if (!force && this.report && Date.now() - this.report.updatedAt < 30 * 60_000) return
      if (!force && this.source === 'location' && this.locationAttempted && !this.city) return
      this.loading = true
      this.error = ''
      try {
        if (this.source === 'location') {
          this.locating = true
          this.locationAttempted = true
          const location = await getWeatherLocation()
          if (this.city && (this.city.latitude !== location.latitude || this.city.longitude !== location.longitude)) this.report = null
          this.city = location
          this.locating = false
        }
        const city = this.city
        if (!city) return
        const report = await getCityWeather(city)
        if (city.id !== this.city?.id) return
        this.report = report
        uni.setStorageSync(KEY, JSON.stringify({ city, report, source: this.source }))
      } catch (error) {
        this.error = error instanceof Error ? error.message : '天气暂不可用，请稍后重试'
      } finally {
        this.locating = false
        this.loading = false
      }
    },
    async selectCity(city: WeatherCity) {
      this.source = 'city'
      this.city = city
      this.report = null
      this.error = ''
      try {
        uni.setStorageSync(KEY, JSON.stringify({ city, report: null, source: 'city' }))
      } catch (error) {
        console.warn('[weather] unable to save preference', error)
      }
      await this.refresh(true)
    },
    async useCurrentLocation() {
      if (this.source !== 'location') { this.city = null; this.report = null }
      this.source = 'location'
      uni.removeStorageSync(KEY)
      await this.refresh(true)
    }
  }
})
