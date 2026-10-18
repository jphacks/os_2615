/* モジュール取得失敗でも、真っ白なままにせず開き直せるようにする。 */
window.addEventListener('error', function (event) {
  var target = event.target;
  if (!target || target.tagName !== 'SCRIPT' || target.type !== 'module') return;
  var status = document.querySelector('#root [role="status"]');
  if (status) status.firstChild.textContent = '画面の読み込みに失敗しました。下のリンクから開き直してください。';
}, true);
