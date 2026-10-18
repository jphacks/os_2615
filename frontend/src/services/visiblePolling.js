/* 前回の応答後に次回取得を予約し、非表示中・停止後は追加取得しない。 */
export function startVisiblePolling(task, { target = document, intervalMs = 5000,
  setTimer = setTimeout, clearTimer = clearTimeout, onError = () => {} } = {}) {
  let stopped = false, running = false, timer;
  async function poll() {
    clearTimer(timer);
    if (stopped || running || target.visibilityState !== 'visible') return;
    running = true;
    try { await task(); } catch (error) { onError(error); }
    finally {
      running = false;
      if (!stopped && target.visibilityState === 'visible') timer = setTimer(poll, intervalMs);
    }
  }
  target.addEventListener('visibilitychange', poll);
  void poll();
  return () => { stopped = true; clearTimer(timer); target.removeEventListener('visibilitychange', poll); };
}
