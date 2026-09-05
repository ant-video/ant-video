(function () {
  'use strict';

  document.body.addEventListener('click', function (event) {
    var button = event.target.closest('button[data-action]');
    if (!button) return;
    var action = button.getAttribute('data-action');
    if (action === 'local') {
      ant.navigateTo('local.html');
    } else if (action === 'back') {
      ant.navigateBack();
    } else if (action === 'toast') {
      ant.ui.toast('第二页里的 window.ant 正常可用');
    }
  });

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
