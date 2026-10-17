/*
Slack Botの識別情報とユーザー表示名を取得する。生のAPIエラーは公開しない。
*/
import { AppError } from '../../utils/errors.js';

export function createSlackClient(webClient) {
  const names = new Map();
  return {
    async getIdentity() {
      try {
        const result = await webClient.auth.test();
        if (!result.ok || ![result.team_id, result.user_id, result.bot_id].every(value =>
          typeof value === 'string' && value)) throw new Error('Invalid identity');
        return { teamId: result.team_id, botUserId: result.user_id, botId: result.bot_id };
      } catch {
        throw new AppError(502, 'PROVIDER_ERROR', 'Slack Botの認証を確認できませんでした。');
      }
    },
    async getDisplayName(userId) {
      if (names.has(userId)) return names.get(userId);
      try {
        const result = await webClient.users.info({ user: userId });
        if (!result.ok) throw new Error('Profile request failed');
        const user = result.user;
        const name = [user?.profile?.display_name, user?.profile?.real_name, user?.real_name, user?.name]
          .find(value => typeof value === 'string' && value.trim());
        if (!name) throw new Error('Missing display name');
        names.set(userId, name);
        return name;
      } catch {
        throw new AppError(502, 'PROVIDER_ERROR', 'Slackプロフィールを取得できませんでした。');
      }
    }
  };
}
