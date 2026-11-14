<script setup lang="ts">
import { ref } from 'vue'
import { searchWeatherCities, weatherDescription, type WeatherCity } from '@/api/weather'
import { useWeatherStore } from '@/stores/weather'
import { formatTime } from '@/utils/format'
import NoteIcon from './NoteIcon.vue'
import NoteSheet from './NoteSheet.vue'

const weather = useWeatherStore()
defineProps<{ show: boolean }>()
const emit = defineEmits<{ 'update:show': [value: boolean] }>()
const keyword = ref('')
const results = ref<WeatherCity[]>([])
const searching = ref(false)
const searched = ref(false)
const error = ref('')
const manualOpen = ref(false)

async function search() {
  if (searching.value || keyword.value.trim().length < 2) return
  searching.value = true
  searched.value = false
  error.value = ''
  results.value = []
  try {
    results.value = await searchWeatherCities(keyword.value)
    searched.value = true
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '城市搜索失败，请重试'
  } finally {
    searching.value = false
  }
}
</script>

<template>
  <NoteSheet :show="show" title="今天的天气" label="当前位置的天气" @update:show="emit('update:show', $event)">
    <view class="weather-panel">
      <view v-if="weather.city" class="weather-current">
        <view><text class="weather-city">{{ weather.city.name }}</text><text class="weather-region">{{ weather.city.region }}</text></view>
        <text v-if="weather.report" class="weather-temperature">{{ Math.round(weather.report.temperature) }}°C</text>
      </view>
      <text v-if="weather.report" class="weather-detail">{{ weatherDescription(weather.report.code) }} · {{ Math.round(weather.report.low) }}°–{{ Math.round(weather.report.high) }}° · {{ formatTime(new Date(weather.report.updatedAt).toISOString()) }} 更新{{ weather.fresh ? '' : '（上次缓存）' }}</text>
      <text v-if="weather.error" class="weather-error" role="alert">{{ weather.error }}</text>
      <button class="note-btn note-btn--secondary weather-refresh" :disabled="weather.loading" @tap="weather.source === 'location' ? weather.refresh(true) : weather.useCurrentLocation()">{{ weather.locating ? '正在定位…' : weather.loading ? '更新中…' : weather.source === 'location' ? '刷新当地天气' : '使用当前位置' }}</button>
      <text class="weather-hint">按设备当前位置获取天气。定位仅在使用时读取，天气由 Open-Meteo 提供，位置名称由 BigDataCloud 提供。</text>
      <button class="note-btn note-btn--plain weather-manual-toggle" :aria-expanded="manualOpen" @tap="manualOpen = !manualOpen">{{ manualOpen ? '收起城市选择' : '手动选择城市' }}</button>
      <view v-if="manualOpen" class="weather-search">
        <wd-input v-model="keyword" placeholder="输入城市名或拼音…" aria-label="天气城市" clearable confirm-type="search" @confirm="search" />
        <button class="note-btn note-btn--secondary" :disabled="searching || keyword.trim().length < 2" @tap="search">{{ searching ? '查找中…' : '查找' }}</button>
      </view>
      <text v-if="manualOpen && error" class="weather-error" role="alert">{{ error }}</text>
      <text v-else-if="manualOpen && searched && !results.length" class="weather-hint">未找到城市，请尝试完整名称或拼音。</text>
      <button v-for="city in manualOpen ? results : []" :key="city.id" class="weather-result" :disabled="weather.loading" @tap="weather.selectCity(city)">
        <view><text class="weather-city">{{ city.name }}</text><text class="weather-region">{{ city.region }}</text></view>
        <NoteIcon :name="weather.city?.id === city.id ? 'check' : 'chevron-right'" size="32rpx" />
      </button>
    </view>
    <template #footer><button class="note-btn note-btn--primary" @tap="emit('update:show', false)">完成</button></template>
  </NoteSheet>
</template>

<style scoped lang="scss">
.weather-result::after { border: 0; }
.weather-panel {
  padding: 4rpx 32rpx 12rpx;
}
.weather-current, .weather-result {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24rpx;
}
.weather-current > view, .weather-result > view {
  display: grid;
  gap: 6rpx;
  min-width: 0;
}
.weather-city {
  color: var(--note-text);
  font-size: var(--note-font-body);
  font-weight: 600;
}
.weather-region, .weather-hint, .weather-detail {
  display: block;
  color: var(--note-text-2);
  font-size: var(--note-font-footnote);
  line-height: 1.6;
}
.weather-hint {
  margin: 12rpx 0;
}
.weather-temperature {
  font-size: var(--note-font-large);
  color: var(--note-text);
  font-variant-numeric: tabular-nums;
}
.weather-error {
  display: block;
  color: var(--note-danger);
  font-size: var(--note-font-footnote);
  line-height: 1.5;
  margin: 12rpx 0;
}
.weather-search {
  display: flex;
  align-items: center;
  gap: 16rpx;
  margin: 24rpx 0 12rpx;
}
.weather-search > :first-child {
  flex: 1;
  min-width: 0;
}
.weather-result {
  width: 100%;
  min-height: 64px;
  padding: 16rpx 0;
  margin: 0;
  border: 0;
  border-top: 1rpx solid var(--note-separator);
  background: transparent;
  text-align: left;
  color: var(--note-accent);
}
.weather-result:active {
  background: var(--note-fill);
}
.weather-refresh {
  margin-left: auto;
}
</style>
