/*
Slack Botの識別情報・表示名取得とDM返信を担当する。生のAPIエラーは公開しない。
*/
import { AppError, deliveryUnknown, invalidInput, providerError } from '../../utils/errors.js';
import { MAX_IMAGE_BYTES, imageType } from '../../repositories/mediaRepository.js';
import { mapSlackSentMessage } from './slackMapper.js';

export function createSlackClient(webClient, { now = Date.now, accessToken = process.env.SLACK_BOT_TOKEN, fetchImpl = fetch } = {}) {
  const names = new Map();
  let identity;
  const client = {
    async getImage(fileId) {
      if (!/^F[A-Z0-9]+$/.test(fileId)) throw invalidInput();
      try {
        const result = await webClient.files.info({ file: fileId });
        if (!result.ok || !result.file) throw new Error('File unavailable');
        if (result.file.size > MAX_IMAGE_BYTES) throw new AppError(413, 'IMAGE_TOO_LARGE', '画像の受信上限（1MB）を超えています。');
        if (!['image/png','image/jpeg'].includes(result.file.mimetype)) throw new AppError(400,'UNSUPPORTED_IMAGE','JPEG・PNG以外の画像は保存できません。');
        const url = new URL(result.file.url_private_download || result.file.url_private);
        if (url.protocol !== 'https:' || url.hostname !== 'files.slack.com' || url.port || url.username || url.password || !accessToken) throw new Error('Invalid download');
        const response = await fetchImpl(url.href, {headers:{Authorization:`Bearer ${accessToken}`},redirect:'error',signal:AbortSignal.timeout(10000)});
        if ([401,403].includes(response.status)) throw new AppError(502,'SLACK_FILE_PERMISSION','Slack画像を取得できません。Botのfiles:read権限と再インストールを確認してください。');
        if (!response.ok) throw new Error('Download failed');
        if (Number(response.headers.get('content-length')) > MAX_IMAGE_BYTES) { await response.body?.cancel(); throw new AppError(413,'IMAGE_TOO_LARGE','画像の受信上限（1MB）を超えています。'); }
        const reader=response.body.getReader();let size=0;const chunks=[];
        try { while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_IMAGE_BYTES){await reader.cancel();throw new AppError(413,'IMAGE_TOO_LARGE','画像の受信上限（1MB）を超えています。');}chunks.push(Buffer.from(value));} }
        finally { reader.releaseLock(); }
        return Buffer.concat(chunks);
      } catch(error) {
        if (['IMAGE_TOO_LARGE','UNSUPPORTED_IMAGE','SLACK_FILE_PERMISSION'].includes(error?.code)) throw error;
        if (error?.data?.error === 'missing_scope') throw new AppError(502,'SLACK_FILE_PERMISSION','Slack画像を取得できません。Botのfiles:read権限と再インストールを確認してください。');
        throw new AppError(502,'PROVIDER_ERROR','Slack画像を取得できませんでした。ファイルの共有範囲と接続を確認してください。');
      }
    },
    async sendImage({ conversation, contact, media, bytes }) {
      if (conversation.platform !== 'slack' || contact.platform !== 'slack' ||
          !/^D[A-Z0-9]+$/.test(conversation.platformConversationId) || !Buffer.isBuffer(bytes) ||
          !bytes.length || bytes.length > MAX_IMAGE_BYTES || imageType(bytes) !== media?.mimeType) throw invalidInput();
      const account = await client.getIdentity();
      if (!contact.platformUserId.startsWith(`${account.teamId}:`)) throw invalidInput();
      let result;
      try {
        result = await webClient.filesUploadV2({ channel_id: conversation.platformConversationId,
          file: bytes, filename: media.mimeType === 'image/png' ? 'konekuto.png' : 'konekuto.jpg', title: 'こねくとからの画像' });
      } catch (error) {
        if (error?.data?.error === 'missing_scope') throw new AppError(502, 'SLACK_FILE_WRITE_PERMISSION', 'Slack画像送信にはBotのfiles:write権限が必要です。権限追加後にワークスペースへ再インストールしてください。');
        const definite = error?.code === 'slack_webapi_rate_limited_error' ||
          error?.code === 'slack_webapi_platform_error' && ['not_authed', 'invalid_auth', 'token_revoked', 'account_inactive', 'channel_not_found', 'not_in_channel', 'file_uploads_disabled'].includes(error.data?.error);
        throw definite ? providerError() : deliveryUnknown();
      }
      // SDK v7はfilesにcompleteUploadExternalの応答を格納する。
      const files = result?.files?.flatMap(item => Array.isArray(item.files) ? item.files : [item]);
      const file = files?.[0];
      if (!result?.ok || !/^F[A-Z0-9]+$/.test(file?.id) || files.length !== 1) throw deliveryUnknown();
      return { platform: 'slack', messageType: 'image', platformMessageId: file.id,
        senderId: account.botUserId, text: '[画像]', timestamp: new Date(now()).toISOString(), isFromMe: true, media,
        metadata: { fileId: file.id, channelId: conversation.platformConversationId, botId: account.botId } };
    },
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
    async getDisplayName(userId, { refresh = false } = {}) {
      const cached = names.get(userId);
      if (!refresh && cached && now() - cached.at < 5 * 60 * 1000) return cached.name;
      // 再登録時は以前の人物のキャッシュを使わない。取得失敗時も古い名へ戻さない。
      names.delete(userId);
      try {
        const result = await webClient.users.info({ user: userId });
        if (!result.ok) throw new Error('Profile request failed');
        const user = result.user;
        const name = [user?.profile?.display_name, user?.profile?.real_name, user?.real_name, user?.name]
          .find(value => typeof value === 'string' && value.trim());
        if (!name) throw new Error('Missing display name');
        names.set(userId, { name, at: now() });
        return name;
      } catch {
        throw new AppError(502, 'PROVIDER_ERROR', 'Slackプロフィールを取得できませんでした。');
      }
    }
  };
  return client;
}
