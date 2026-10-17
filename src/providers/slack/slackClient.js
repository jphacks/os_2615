/*
Slack Botの識別情報・表示名取得とDM返信を担当する。生のAPIエラーは公開しない。
*/
import { AppError, deliveryUnknown, invalidInput, providerError } from '../../utils/errors.js';
import { mapSlackSentMessage } from './slackMapper.js';

export function createSlackClient(webClient) {
  const names = new Map();
  let identity;
  const client = {
    async sendText({ conversation, contact, text }) {
      if (conversation.platform !== 'slack' || contact.platform !== 'slack' ||
          !/^D[A-Z0-9]+$/.test(conversation.platformConversationId)) throw invalidInput();
      const account = await client.getIdentity();
      if (!contact.platformUserId.startsWith(`${account.teamId}:`)) throw invalidInput();
      let result;
      try {
        result = await webClient.chat.postMessage({ channel: conversation.platformConversationId,
          text, mrkdwn: false, unfurl_links: false, unfurl_media: false });
      } catch (error) {
        const uncertain = ['internal_error', 'fatal_error', 'request_timeout', 'service_unavailable'];
        const definite = (error?.code === 'slack_webapi_platform_error' && !uncertain.includes(error.data?.error)) ||
          error?.code === 'slack_webapi_rate_limited_error' ||
          (error?.code === 'slack_webapi_http_error' && error.statusCode >= 400 && error.statusCode < 500 && error.statusCode !== 408);
        throw definite ? providerError() : deliveryUnknown();
      }
      if (!result?.ok) {
        if (['internal_error', 'fatal_error', 'request_timeout', 'service_unavailable'].includes(result?.error)) throw deliveryUnknown();
        throw providerError();
      }
      try {
        if (result.channel !== conversation.platformConversationId) throw new Error('Unexpected destination');
        return mapSlackSentMessage(result, { ...account, text });
      } catch { throw deliveryUnknown(); }
    },
    async getIdentity() {
      if (identity) return identity;
      try {
        const result = await webClient.auth.test();
        if (!result.ok || ![result.team_id, result.user_id, result.bot_id].every(value =>
          typeof value === 'string' && value)) throw new Error('Invalid identity');
        identity = { teamId: result.team_id, botUserId: result.user_id, botId: result.bot_id };
        return identity;
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
  return client;
}
