/*
固定イベント名のみを出力し、生エラー・入力・認証情報をログへ渡さない。
*/
const events = new Set(['SCHEDULE_PROCESS_FAILED', 'SERVER_STARTED', 'STARTUP_FAILED', 'REQUEST_FAILED', 'SERVER_ERROR', 'LINE_PROFILE_UNAVAILABLE',
  'SLACK_DISCONNECTED', 'SLACK_NOT_CONFIGURED', 'SLACK_CONNECTED', 'SLACK_START_FAILED', 'SLACK_PROFILE_UNAVAILABLE',
  'SLACK_RECEIVE_FAILED', 'SLACK_WARNING', 'SLACK_ERROR']);
export function logEvent(event) {
  if (events.has(event)) console.log(JSON.stringify({ event }));
}
