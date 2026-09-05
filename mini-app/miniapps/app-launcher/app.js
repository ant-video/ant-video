(function () {
  'use strict';

  var output = document.getElementById('output');

  function show(title, value) {
    output.textContent =
      title + '\n' + (typeof value === 'string' ? value : JSON.stringify(value, null, 2));
    ant.log(title + ': ' + JSON.stringify(value));
  }

  function showError(error) {
    var code = error && error.code ? error.code : 'UNKNOWN';
    var message = error && error.message ? error.message : String(error);
    show('打开失败 [' + code + ']', message);
    if (code === 'APP_NOT_INSTALLED') {
      ant.ui.toast('请先从市场安装目标小程序');
    }
  }

  function openTarget(button) {
    if (!ant.miniApp || typeof ant.miniApp.open !== 'function') {
      show('宿主版本过低', 'ant.miniApp 需要 SDK v3');
      return;
    }
    var appId = button.getAttribute('data-app-id');
    var path = button.getAttribute('data-path') || undefined;
    var title = button.getAttribute('data-title') || '启动台入口';
    button.disabled = true;
    ant.miniApp
      .open({
        appId: appId,
        path: path,
        params: {
          title: title,
          requestId: Date.now().toString(36),
          sentAt: new Date().toISOString()
        }
      })
      .then(function (result) {
        show(result.opened ? '目标已打开' : '用户取消', result);
      })
      .catch(showError)
      .then(function () {
        button.disabled = false;
      });
  }

  document.body.addEventListener('click', function (event) {
    var target = event.target.closest('button[data-app-id]');
    if (target) {
      openTarget(target);
      return;
    }
    if (event.target.closest('[data-action="read-options"]')) {
      if (!ant.miniApp) {
        show('启动参数', '当前宿主不支持 SDK v3');
        return;
      }
      ant.miniApp
        .getLaunchOptions()
        .then(function (options) {
          show('启动参数', options || '本次从小程序中心直接启动');
        })
        .catch(showError);
    }
  });

  if (ant.miniApp) {
    ant.miniApp.onOpen(function (options) {
      show('收到新的 miniApp.open', options);
    });
  }

  ant.tv.onKey(function (event) {
    var items = Array.prototype.slice.call(
      document.querySelectorAll('button:not([disabled]), a[href]')
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
