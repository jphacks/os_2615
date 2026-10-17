/*
固定イベント名のみを出力し、生エラー・入力・認証情報をログへ渡さない。
*/
const events = new Set(['SERVER_STARTED', 'STARTUP_FAILED', 'REQUEST_FAILED', 'SERVER_ERROR', 'LINE_PROFILE_UNAVAILABLE']);
export function logEvent(event) {
  if (events.has(event)) console.log(JSON.stringify({ event }));
}
