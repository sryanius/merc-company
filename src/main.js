import { boot } from './ui/app.js';

// 부팅 중 터진 예외를 화면에 그대로 노출한다 (빌드 스텝이 없으므로 콘솔만 보면 놓치기 쉽다).
function fatal(err) {
  console.error(err);
  const host = document.getElementById('screen');
  if (!host) return;
  host.innerHTML = `<div class="panel"><h3>초기화 실패</h3>
    <pre class="tiny muted" style="white-space:pre-wrap">${String(err?.stack || err).replace(/[<>]/g, '')}</pre></div>`;
}

window.addEventListener('unhandledrejection', (e) => fatal(e.reason));
try { boot(); } catch (e) { fatal(e); }
