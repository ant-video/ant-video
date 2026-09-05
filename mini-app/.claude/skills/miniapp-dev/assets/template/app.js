/*!
 * __NAME__ —— 小程序入口逻辑。
 *
 * 宿主在 document-start 注入 window.ant；浏览器里由 ant-mock.js 顶替。
 * 所有 ant.* 都返回 Promise，失败时 reject 的 Error 带 code / api 字段。
 */
(function () {
  'use strict';

  var output = document.getElementById('output');

  function show(title, data) {
    output.textContent =
      title + '\n' + (typeof data === 'string' ? data : JSON.stringify(data, null, 2));
  }

  /** 统一的失败展示。用 e.code 做分支判断，比 message 稳定。 */
  function fail(name) {
    return function (e) {
      show(name + ' 失败', (e && e.code ? '[' + e.code + '] ' : '') + ((e && e.message) || e));
    };
  }

  /* ---------------- 业务动作 ---------------- */

  var actions = {
    hello: function () {
      return ant.ui
        .toast('你好，__NAME__')
        .then(function () {
          return ant.storage.set('last_open', new Date().toISOString());
        })
        .then(function () {
          return ant.storage.get('last_open');
        })
        .then(function (value) {
          show('storage.last_open', value);
        });
    },
    keys: function () {
      return ant.storage.keys().then(function (keys) {
        show('storage.keys', keys.length ? keys : '还没存过东西');
      });
    }
  };

  document.body.addEventListener('click', function (event) {
    var button = event.target.closest('button[data-action]');
    if (!button) return;
    var handler = actions[button.getAttribute('data-action')];
    if (!handler) return;
    Promise.resolve().then(handler).catch(fail(button.getAttribute('data-action')));
  });

  /* ---------------- 环境与生命周期 ---------------- */

  ant.env
    .getSystemInfo()
    .then(function (info) {
      document.getElementById('env').textContent =
        info.platform +
        ' · ' +
        (info.isTV ? 'TV' : '触屏') +
        ' · sdk v' +
        info.sdkVersion +
        (info.devMode ? ' · 调试模式' : '');
      if (info.isTV) document.body.classList.add('tv');
    })
    .catch(function () {
      /* 拿不到环境信息不影响主流程 */
    });

  ant.onHide(function () {
    /* 切后台了：停掉轮询与计时器 */
  });

  ant.onShow(function () {
    /* 回到前台：需要的话刷新数据 */
  });

  /* ---------------- TV 遥控 ----------------
   * TV 上 WebView 不参与系统焦点，方向键由容器转发到这里。
   * 删掉这段，小程序在电视上就完全没法操作了。
   */
  ant.tv.onKey(function (event) {
    var items = Array.prototype.slice.call(
      document.querySelectorAll('button:not([disabled]), a[href], [tabindex="0"]')
    );
    if (!items.length) return;

    var index = items.indexOf(document.activeElement);
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
      index = (index + 1) % items.length;
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
      index = index <= 0 ? items.length - 1 : index - 1;
    } else if (event.key === 'Enter' || event.key === 'Select') {
      if (document.activeElement) document.activeElement.click();
      return;
    } else {
      return;
    }

    items[index].focus();
    items[index].scrollIntoView({ block: 'nearest' });
  });
})();
