/* 示例小程序：演示 ant.* 的用法，可直接当模板改。 */
var output = document.getElementById('output');

function show(label, value) {
  var text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  output.textContent = '[' + label + ']\n' + text;
  ant.log(label + ': ' + text);
}

function fail(label) {
  return function (error) {
    show(label + ' 失败', (error && error.code ? error.code + ' - ' : '') + (error && error.message));
  };
}

ant.env.getSystemInfo().then(function (info) {
  document.getElementById('env').textContent =
    info.platform + (info.isTV ? ' / TV' : '') + ' · SDK v' + info.sdkVersion +
    (info.devMode ? ' · 调试模式' : '');
});

var actions = {
  toast: function () {
    return ant.ui.toast('来自小程序的 Toast').then(function () {
      show('ui.toast', 'ok');
    });
  },
  confirm: function () {
    return ant.ui
      .confirm({ title: '确认', content: '这是一个由小程序发起的确认框' })
      .then(function (ok) {
        show('ui.confirm', ok ? '用户点了确定' : '用户取消了');
      });
  },
  sheet: function () {
    return ant.ui.actionSheet(['第一项', '第二项', '第三项']).then(function (index) {
      show('ui.actionSheet', '选中下标 ' + index);
    });
  },
  loading: function () {
    ant.ui.loading('处理中…');
    return new Promise(function (resolve) {
      setTimeout(function () {
        ant.ui.hideLoading().then(function () {
          show('ui.loading', '已关闭');
          resolve();
        });
      }, 1500);
    });
  },
  clipboard: function () {
    return ant.clipboard
      .set('hello from mini app')
      .then(function () {
        return ant.clipboard.get();
      })
      .then(function (text) {
        show('clipboard', text);
      });
  },
  request: function () {
    return ant
      .request({ url: 'https://www.baidu.com', timeout: 8000 })
      .then(function (res) {
        show('request', 'HTTP ' + res.statusCode + '，响应长度 ' + res.data.length);
      });
  },
  // 二进制响应：protobuf / gzip / brotli / GBK 网页都得走这条，缺省的
  // responseType:'text' 会让宿主按 charset 解码，字节经此一遭就毁了。
  'request-bytes': function () {
    if (typeof ant.requestBytes !== 'function') {
      show('requestBytes', '当前宿主的 SDK 版本太低（需要 v2）');
      return Promise.resolve();
    }
    return ant
      .requestBytes({ url: 'https://www.baidu.com/favicon.ico', timeout: 8000 })
      .then(function (bytes) {
        var head = Array.prototype.slice
          .call(bytes.subarray(0, 4))
          .map(function (b) {
            return b.toString(16).padStart(2, '0');
          })
          .join(' ');
        show('requestBytes', bytes.length + ' 字节，前 4 字节 ' + head);
      });
  },
  'storage-set': function () {
    return ant.storage
      .setJSON('demo', { at: new Date().toISOString(), n: Math.random() })
      .then(function () {
        show('storage.set', 'ok');
      });
  },
  'storage-get': function () {
    return ant.storage.getJSON('demo', null).then(function (value) {
      show('storage.get', value === null ? '还没有数据' : value);
    });
  },
  play: function () {
    return ant.player.open({
      url: 'https://media.w3.org/2010/05/sintel/trailer.mp4',
      title: '示例视频'
    });
  },
  'player-state': function () {
    return ant.player.getState().then(function (state) {
      show('player.getState', state);
    });
  },
  'source-list': function () {
    return ant.source.list().then(function (sites) {
      show('source.list', sites.length ? sites : '宿主还没有配置任何站点');
    });
  },
  'source-search': function () {
    return ant.source.list().then(function (sites) {
      if (!sites.length) {
        show('source.search', '宿主还没有配置任何站点');
        return;
      }
      return ant.source
        .search({ siteKey: sites[0].key, wd: '斗罗', page: 1 })
        .then(function (res) {
          var list = (res && res.list) || [];
          show(
            'source.search',
            sites[0].name + ' 命中 ' + list.length + ' 条：\n' +
              list.slice(0, 5).map(function (item) {
                return '· ' + item.vod_name;
              }).join('\n')
          );
        });
    });
  },
  navigate: function () {
    return ant.navigateTo('page2.html');
  },
  'open-miniapp': function () {
    if (!ant.miniApp) {
      show('miniApp.open', '当前宿主 SDK 版本太低（需要 v3）');
      return Promise.resolve();
    }
    return ant.miniApp
      .open({
        appId: 'com.leospring.launch_target',
        path: 'detail.html?id=demo',
        params: {
          title: '来自示例小程序',
          requestId: 'demo-' + Date.now().toString(36)
        }
      })
      .then(function (result) {
        show('miniApp.open', result);
      });
  },
  'launch-options': function () {
    if (!ant.miniApp) {
      show('miniApp.getLaunchOptions', '当前宿主 SDK 版本太低（需要 v3）');
      return Promise.resolve();
    }
    return ant.miniApp.getLaunchOptions().then(function (options) {
      show('miniApp.getLaunchOptions', options || '本次是从小程序中心直接启动');
    });
  },
  exit: function () {
    return ant.exitMiniApp();
  }
};

document.body.addEventListener('click', function (event) {
  var button = event.target.closest('button[data-action]');
  if (!button) return;
  var name = button.getAttribute('data-action');
  var handler = actions[name];
  if (!handler) return;
  Promise.resolve()
    .then(handler)
    .catch(fail(name));
});

ant.player.onStateChange(function (state) {
  show('player.stateChange', state);
});

ant.player.onClose(function () {
  show('player.close', '播放页已关闭');
});

if (ant.miniApp) {
  ant.miniApp.onOpen(function (options) {
    show('miniApp.onOpen', options);
  });
}

/* TV：把遥控方向键映射成焦点移动，宿主会转发 keydown 事件。 */
ant.tv.onKey(function (event) {
  var focusables = Array.prototype.slice.call(document.querySelectorAll('button'));
  if (!focusables.length) return;
  var index = focusables.indexOf(document.activeElement);
  if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
    index = (index + 1) % focusables.length;
  } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
    index = index <= 0 ? focusables.length - 1 : index - 1;
  } else if (event.key === 'Select' || event.key === 'Enter') {
    if (document.activeElement) document.activeElement.click();
    return;
  } else {
    return;
  }
  focusables[index].focus();
  focusables[index].scrollIntoView({ block: 'nearest' });
});
