import { buildQuery, request, restPath } from './supabase'

export interface AccountProfile {
  avatar: string | null
  nickName: string
}

/** Read the signed-in account only; the platform owns and edits this profile. */
export async function getAccountProfile(token: string, userId: string): Promise<AccountProfile | null> {
  const rows = await request<Array<{ avatar: string | null; nick_name: string | null; user_name: string | null }>>(
    restPath('sys_user', buildQuery({ select: 'avatar,nick_name,user_name', auth_user_id: `eq.${userId}`, deleted_at: 'is.null', limit: 1 })),
    { token }
  )
  const row = rows[0]
  return row ? { avatar: row.avatar, nickName: row.nick_name || row.user_name || '' } : null
}
