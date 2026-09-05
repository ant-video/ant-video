(function () {
  'use strict';

  var output = document.getElementById('output');
  var source = document.getElementById('source');
  var seenRequestId = '';

  function show(title, value) {
    output.textContent =
      title + '\n' + (typeof value === 'string' ? value : JSON.stringify(value, null, 2));
  }

  function persist(options) {
    var requestId = String(options && options.params && options.params.requestId || '');
    if (requestId && requestId === seenRequestId) return Promise.resolve();
    seenRequestId = requestId;
    return ant.storage.getJSON('launch-history', []).then(function (history) {
      var next = Array.isArray(history) ? history.slice(0, 9) : [];
      next.unshift({
        receivedAt: new Date().toISOString(),
        sourceAppId: options.sourceAppId,
        path: options.path || null,
        params: options.params || {}
      });
      return ant.storage.setJSON('launch-history', next);
    });
  }

  function receive(options, channel) {
    if (!options) {
      source.textContent = '小程序中心';
      show('直接启动', '没有跨小程序启动参数');
      return Promise.resolve();
    }
    source.textContent = options.sourceAppName || options.sourceAppId || '未知来源';
    show(channel, options);
    return persist(options);
  }

  function fail(error) {
    show(
      '读取失败',
      (error && error.code ? '[' + error.code + '] ' : '') +
        ((error && error.message) || String(error))
    );
  }

  if (ant.miniApp) {
    ant.miniApp.onOpen(function (options) {
      receive(options, 'miniApp.onOpen').catch(fail);
    });
    ant.miniApp
      .getLaunchOptions()
      .then(function (options) {
        return receive(options, 'miniApp.getLaunchOptions');
      })
      .catch(fail);
  } else {
    show('宿主版本过低', 'ant.miniApp 需要 SDK v3');
  }

  if (document.body.getAttribute('data-page') === 'detail') {
    var id = new URL(location.href).searchParams.get('id');
    document.getElementById('detail-id').textContent = id ? '#' + id : '';
  }

  document.body.addEventListener('click', function (event) {
    var button = event.target.closest('button[data-action]');
    if (!button) return;
    var action = button.getAttribute('data-action');
    if (action === 'detail') {
      ant.navigateTo('detail.html?id=local');
    } else if (action === 'back') {
      ant.navigateBack();
    } else if (action === 'home') {
      ant.redirectTo('index.html');
    } else if (action === 'history') {
      ant.storage.getJSON('launch-history', []).then(function (history) {
        show('最近 ' + history.length + ' 次', history);
      }).catch(fail);
    } else if (action === 'clear') {
      ant.storage.remove('launch-history').then(function () {
        show('接收历史', '已清空');
        return ant.ui.toast('历史已清空');
      }).catch(fail);
    }
  });

  ant.tv.onKey(function (event) {
    var items = Array.prototype.slice.call(document.querySelectorAll('button:not([disabled])'));
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
  });
})();
