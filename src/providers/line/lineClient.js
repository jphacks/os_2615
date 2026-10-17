/*
LINEプロフィールの表示名を取得する。Token・外部エラー本文は外へ出さない。
*/
import { AppError } from '../../utils/errors.js';

export function createLineClient({ accessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN, fetchImpl = fetch } = {}) {
  const names = new Map();
  return {
    async getDisplayName(userId) {
      if (names.has(userId)) return names.get(userId);
      if (!accessToken) throw new AppError(503, 'PROVIDER_NOT_CONFIGURED', 'LINEの認証情報が未設定です。');
      try {
        const response = await fetchImpl(`https://api.line.me/v2/bot/profile/${encodeURIComponent(userId)}`, {
          headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(1500)
        });
        if (!response.ok) throw new Error('Profile request failed');
        const profile = await response.json();
        if (typeof profile.displayName !== 'string' || !profile.displayName.trim()) throw new Error('Invalid profile');
        names.set(userId, profile.displayName);
        return profile.displayName;
      } catch {
        throw new AppError(502, 'PROVIDER_ERROR', 'LINEプロフィールを取得できませんでした。');
      }
    }
  };
}
