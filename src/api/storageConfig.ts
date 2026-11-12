import { request } from './supabase'

interface PublicWebsiteConfigRow {
  param_value?: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/** Reads only the public capability flag; it does not authenticate the user or read notes. */
export async function fetchCloudStorageAvailability(): Promise<boolean> {
  const rows = await request<PublicWebsiteConfigRow[]>(
    '/rest/v1/sys_param?select=param_value&param_key=eq.website.config&enabled=eq.true&limit=1',
    { timeoutMs: 2500 }
  )
  const value = rows[0]?.param_value
  let config: unknown = value

  if (typeof value === 'string') {
    try {
      config = JSON.parse(value) as unknown
    } catch {
      return false
    }
  }

  return isRecord(config) && config.noteStorageCloudEnabled === true
}
