import { ApiRequestError, request } from './supabase'

export type CloudStorageAccess = 'closed' | 'login' | 'allowed' | 'denied'
let legacyConfigRequired = false

async function readLegacyConfig(): Promise<boolean> {
  const rows = await request<Array<{ param_value?: unknown }>>(
    '/rest/v1/sys_param?select=param_value&param_key=eq.website.config&enabled=eq.true&limit=1',
    { timeoutMs: 2500 }
  )
  let config = rows[0]?.param_value
  if (typeof config === 'string') {
    try { config = JSON.parse(config) as unknown } catch { return false }
  }
  return Boolean(config && typeof config === 'object' && 'noteStorageCloudEnabled' in config && config.noteStorageCloudEnabled === true)
}

/** The server resolves the caller from the session. */
export async function fetchCloudStorageAccess(token?: string): Promise<CloudStorageAccess> {
  if (!legacyConfigRequired) {
    try {
      const access = await request<unknown>('/rest/v1/rpc/get_note_cloud_access', { token, timeoutMs: 10000 })
      if (access === 'closed' || access === 'login' || access === 'allowed' || access === 'denied') return access
      throw new Error('无法核实云端存储权限，请稍后重试')
    } catch (error) {
      // Deployments without this RPC still enforce note ownership through RLS.
      if (!(error instanceof ApiRequestError) || error.code !== 'PGRST202') throw error
      legacyConfigRequired = true
    }
  }
  return await readLegacyConfig() ? (token ? 'allowed' : 'login') : 'closed'
}
