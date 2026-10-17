/*
BoltのSocket Modeを起動し、DMを共通Serviceへ渡す。TokenやSDKの生ログは出さない。
*/
import { App, LogLevel } from '@slack/bolt';
import { logEvent } from '../../utils/logger.js';
import { createSlackClient } from './slackClient.js';
import { mapSlackEvent } from './slackMapper.js';

// SDKから渡される引数は意図的に捨てる。ログレベル変更でも秘密情報を出力しない。
export const slackLogger = {
  debug() {}, info() {},
  warn() { logEvent('SLACK_WARNING'); },
  error() { logEvent('SLACK_ERROR'); },
  setName() {}, setLevel() {}, getLevel() { return LogLevel.WARN; }
};

export function createSlackMessageHandler(messages, { teamId, botUserId, getDisplayName }) {
  return async ({ event, body = {} }) => {
    try {
      if (body.team_id && body.team_id !== teamId) return false;
      const options = { teamId, botUserId, eventId: body.event_id };
      const incoming = mapSlackEvent(event, options);
      if (!incoming || messages.isDuplicate(incoming)) return false;
      let displayName = null;
      try { displayName = await getDisplayName(event.user); }
      catch { logEvent('SLACK_PROFILE_UNAVAILABLE'); }
      await messages.receive(displayName ? mapSlackEvent(event, { ...options, displayName }) : incoming);
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
  AppClass = App
} = {}) {
  let app;
  let stopped = false;
  let started = false;
  const pending = new Set();
  return {
    async start() {
      if (stopped || started) return false;
      started = true;
      if (!botToken?.trim() || !appToken?.trim()) {
        logEvent('SLACK_NOT_CONFIGURED');
        return false;
      }
      try {
        app = new AppClass({
          token: botToken, appToken, socketMode: true, ignoreSelf: true,
          deferInitialization: true, logger: slackLogger,
          clientOptions: { timeout: 5000, retryConfig: { retries: 0 }, rejectRateLimitedCalls: true }
        });
        app.error(async () => logEvent('SLACK_RECEIVE_FAILED'));
        // 初期化中の認証エラーもこのtry内で受け、HTTPサーバーは維持する。
        await app.init();
        const client = createSlackClient(app.client);
        const identity = await client.getIdentity();
        if (stopped) return false;
        const handle = createSlackMessageHandler(messages, { ...identity, getDisplayName: client.getDisplayName });
        app.event('message', async args => {
          if (stopped) return;
          const operation = handle(args);
          pending.add(operation);
          try { await operation; } finally { pending.delete(operation); }
        });
        await app.start();
        if (stopped) { await app.stop(); return false; }
        logEvent('SLACK_CONNECTED');
        return true;
      } catch {
        logEvent('SLACK_START_FAILED');
        if (app) await app.stop().catch(() => {});
        return false;
      }
    },
    async stop() {
      if (stopped) return;
      stopped = true;
      if (app) {
        try { await app.stop(); } catch { logEvent('SLACK_ERROR'); }
      }
      await Promise.allSettled([...pending]);
    }
  };
}
