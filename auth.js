// auth.js — 纯前端简易登录（仅挡外行，非真正鉴权；要真安全需后端）
// 会话策略：localStorage（长期记住登录态，登录一次后免重复登录）
//   想改成"每次开浏览器都要重登（更安全）"：把下方两处 localStorage 改回 localStorage
(function () {
  'use strict';

  // 密码用 base64 遮蔽（不是加密）。改成你自己的密码：
  //   浏览器按 F12 → Console，输入  btoa('你的密码')  回车，把结果替换下面这行
  var PASSWORD_B64 = 'NTIwNTA2'; // 

  var mask = document.getElementById('authMask');
  var app = document.getElementById('appWrap');
  var titleEl = document.getElementById('pageTitle');
  var REAL_TITLE = '美瞳种草文案生成器';

  function showApp() {
    if (mask) mask.style.display = 'none';
    if (app) app.style.display = '';
    if (titleEl) titleEl.textContent = REAL_TITLE;
  }
  function showMask() {
    if (mask) mask.style.display = 'flex';
    if (app) app.style.display = 'none';
  }

  var authed = false;
  try { authed = localStorage.getItem('auth_ok') === '1'; } catch (e) {}

  if (authed) { showApp(); return; }  // 本次会话已登录，直接进
  showMask();

  var btn = document.getElementById('authSubmit');
  var input = document.getElementById('authPwd');
  var err = document.getElementById('authErr');

  function tryLogin() {
    var val = input ? input.value : '';
    var b64 = '';
    try { b64 = btoa(val); } catch (e) {}
    if (b64 === PASSWORD_B64) {
      try { localStorage.setItem('auth_ok', '1'); } catch (e) {}
      showApp();
    } else {
      if (err) err.textContent = '密码错误';
      if (input) { input.value = ''; input.focus(); }
    }
  }
  if (btn) btn.onclick = tryLogin;
  if (input) input.addEventListener('keydown', function (e) { if (e.key === 'Enter') tryLogin(); });
})();
