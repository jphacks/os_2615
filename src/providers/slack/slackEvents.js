/*
BoltのSocket Modeを起動し、DMを共通Serviceへ渡す。TokenやSDKの生ログは出さない。
*/
import { App, LogLevel, SocketModeReceiver } from '@slack/bolt';
import { logEvent } from '../../utils/logger.js';
import { createSlackClient } from './slackClient.js';
import { mapSlackEvent } from './slackMapper.js';
import { createMediaRepository } from '../../repositories/mediaRepository.js';
import { AppError } from '../../utils/errors.js';

// SDKから渡される引数は意図的に捨てる。ログレベル変更でも秘密情報を出力しない。
export const slackLogger = {
  debug() {}, info() {},
  warn() { logEvent('SLACK_WARNING'); },
  error() { logEvent('SLACK_ERROR'); },
  setName() {}, setLevel() {}, getLevel() { return LogLevel.WARN; }
};

export function createSlackMessageHandler(messages, { teamId, botUserId, getDisplayName, getImage, mediaRepository }) {
  return async ({ event, body = {} }) => {
    try {
      if (body.team_id && body.team_id !== teamId) return false;
      const options = { teamId, botUserId, eventId: body.event_id };
      const incoming = mapSlackEvent(event, options);
      if (!incoming || messages.isDuplicate(incoming)) return false;
      let displayName = null;
      try { displayName = await getDisplayName(event.user, { refresh: !messages.hasContact(incoming) }); }
      catch { logEvent('SLACK_PROFILE_UNAVAILABLE'); }
      const normalized = displayName ? mapSlackEvent(event, { ...options, displayName }) : incoming;
      const files = Array.isArray(event.files) ? event.files : [];
      if (!files.length) { await messages.receive(normalized); return true; }
      for (let i=0; i<files.length; i++) {
        const file=files[i];
        const item=structuredClone(normalized);
        item.message.platformMessageId=`${event.ts}:${file.id ?? i}`;
        if (messages.isDuplicate(item)) continue;
        item.message.text=i===0 && event.text ? event.text : '[画像]';
        try {
          if (!getImage || !mediaRepository) throw new Error('Image provider unavailable');
          item.message.media=await mediaRepository.save(await getImage(file.id),'slack');
          item.message.messageType='image';
        } catch(error) {
          item.message.messageType='other';
          const code=error?.code;
          const note=['IMAGE_TOO_LARGE','PAYLOAD_TOO_LARGE'].includes(code) ? '画像の受信上限（1MB）を超えたため保存できませんでした。'
            : code==='SLACK_FILE_PERMISSION' ? 'Slack画像を取得できません。Botのfiles:read権限と再インストールを確認してください。'
            : code==='UNSUPPORTED_IMAGE'||code==='VALIDATION_ERROR' ? 'JPEG・PNG以外のファイルは表示できません。' : 'Slack画像を取得できませんでした。ファイルの共有範囲と接続を確認してください。';
          item.message.text=(i===0 && event.text ? event.text+'\n' : '')+note;
          item.message.metadata.imageRejected=['IMAGE_TOO_LARGE','PAYLOAD_TOO_LARGE'].includes(code)?'too_large':'unavailable';
        }
        await messages.receive(item);
      }
      return true;
    } catch {
      logEvent('SLACK_RECEIVE_FAILED');
      return false;
    }
  };
}

export function createSlackReceiver(messages, {
  botToken = process.env.SLACK_BOT_TOKEN,
  appToken = process.env.SLACK_APP_TOKEN,
  AppClass = App,
  ReceiverClass = SocketModeReceiver,
  mediaRepository = createMediaRepository(),
  reconnectDelayMs = 5000
} = {}) {
  let app;
  let stopped = false;
  let started = false;
  let replyClient;
  const pending = new Set();
  let reconnectTimer;
  let connecting = false;
  let readyClient;
  function scheduleReconnect() {
    if (stopped || reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined;
      void connectSocket();
    }, reconnectDelayMs);
    reconnectTimer.unref?.();
  }
  async function connectSocket() {
    if (stopped || connecting) return false;
    connecting = true;
    try {
      await app.start();
      if (stopped) { await app.stop().catch(() => {}); return false; }
      clearTimeout(reconnectTimer); reconnectTimer = undefined;
      replyClient = readyClient;
      logEvent('SLACK_CONNECTED');
      return true;
    } catch {
      replyClient = undefined;
      logEvent('SLACK_START_FAILED');
      scheduleReconnect();
      return false;
    } finally { connecting = false; }
  }
  return {
    async sendText(input) {
      if (!botToken?.trim() || !appToken?.trim()) {
        throw new AppError(503, 'PROVIDER_NOT_CONFIGURED', 'Slackの認証情報が未設定です。');
      }
      if (!replyClient || stopped) throw new AppError(502, 'PROVIDER_ERROR', 'Slack接続の準備ができていません。');
      return replyClient.sendText(input);
    },
    async start() {
      if (stopped || started) return false;
      started = true;
      if (!botToken?.trim() || !appToken?.trim()) {
        logEvent('SLACK_NOT_CONFIGURED');
        return false;
      }
      try {
        const clientOptions = { timeout: 10000, retryConfig: { retries: 0 }, rejectRateLimitedCalls: true };
        const receiver = new ReceiverClass({ appToken, logger: slackLogger, autoReconnectEnabled: false,
          installerOptions: { clientOptions } });
        receiver.client.on('disconnected', () => {
          replyClient = undefined;
          if (!stopped && !connecting && readyClient) {
            logEvent('SLACK_DISCONNECTED');
            scheduleReconnect();
          }
        });
        app = new AppClass({
          token: botToken, appToken, socketMode: true, receiver, ignoreSelf: true,
          deferInitialization: true, logger: slackLogger,
          clientOptions
        });
        app.error(async () => logEvent('SLACK_RECEIVE_FAILED'));
        // 初期化中の認証エラーもこのtry内で受け、HTTPサーバーは維持する。
        await app.init();
        const client = createSlackClient(app.client, { accessToken: botToken });
        const identity = await client.getIdentity();
        if (stopped) return false;
        const handle = createSlackMessageHandler(messages, { ...identity, getDisplayName: client.getDisplayName, getImage: client.getImage, mediaRepository });
        app.event('message', async args => {
          if (stopped) return;
          const operation = handle(args);
          pending.add(operation);
          try { await operation; } finally { pending.delete(operation); }
        });
        readyClient = client;
        const connected = await connectSocket();
        if (!connected && app) await app.stop().catch(() => {});
        return connected;
      } catch {
        replyClient = undefined;
        logEvent('SLACK_START_FAILED');
        if (app) await app.stop().catch(() => {});
        return false;
      }
    },
    async stop() {
      if (stopped) return;
      stopped = true;
      clearTimeout(reconnectTimer); reconnectTimer = undefined;
      replyClient = undefined;
      if (app) {
        try { await app.stop(); } catch { logEvent('SLACK_ERROR'); }
      }
      await Promise.allSettled([...pending]);
    }
  };
}
