# Python 最小示例

点击“调用 Python hello”，页面通过 ant.python.call('hello', {name:'蚂蚁影视'}, 2) 得到顶层函数
直接返回的 JSON，sum 为 5。manifest 同时声明 python 权限与 python.entry，不需要独立服务器。

app.py 也导出 serve(request)：miniapp://com.example.python.demo/check 返回 Python 服务状态，
未知路径使用 `_status: 404`。不要自行 app.run() 或监听端口。

本地只需 Python 标准库：

```bash
python3 .agents/skills/miniapp-dev/scripts/dev_python.py miniapps/python-demo --port 3000
python3 .agents/skills/miniapp-dev/scripts/pack_miniapp.py miniapps/python-demo
```

公开项目在 mini-app/ 中运行，把 .agents/skills/ 替换为 skills/。
最终导入 zip 验证内嵌执行；本地 mock 和宿主 dev server 调试不能验证实际 Python 运行时。
