"""小说解析、分页和实际 Python 小程序路由契约，不依赖外网。"""

import pathlib
import runpy
import sys
import unittest
from unittest.mock import patch

ROOT = pathlib.Path(__file__).parents[1]
APP_DIR = ROOT / "miniapps" / "sudugu-reader"
namespace = runpy.run_path(str(APP_DIR / "app.py"))
backend = namespace["_backend"]
spider = backend["_spider"]

DETAIL = '''<div class="item"><a href="/51/#dir"><img src="/cover.jpg"></a>
<div class="itemtxt"><h1><i>30万字</i><a href="/51/#dir">测试小说</a></h1>
<p><span>已完结</span></p><p><a href="/author/">作者：测试作者</a></p></div></div>
<div class="des">书籍简介</div><div id="list" class="dir"><a href="/51/1.html">第一章</a>
<a href="/51/2.html">第二章</a><a href="/51/3.html">第十章</a>
<a href="/51/4.html">第2章</a><a href="/51/5.html">番外</a>
<a href="/51/1.html">重复第一章</a><a href="/999/2.html">其它书籍</a></div>'''
CHAPTER = '''<h1>测试小说&gt; 第一章</h1><div class="con">第一段中文正文，正文比二十字更长一些。<br>
第二段原文保留中文和段落。<script>恶意脚本</script><div style="display: none">隐藏广告</div></div>
<div class="prenext"><a href="/51/#dir">目录</a><a href="/51/1-2.html">下一页</a></div>'''


class SuduguReaderTest(unittest.TestCase):
    def test_detail_keeps_chinese_and_extra_chapters_in_directory_order(self):
        with patch.object(spider, "_fetch", return_value=DETAIL):
            result = namespace["detail"]("51")
        self.assertEqual(result["vod_name"], "测试小说")
        self.assertEqual(result["vod_actor"], "测试作者")
        self.assertEqual(result["vod_content"], "书籍简介")
        self.assertEqual([c["title"] for c in result["chapters"]], ["第一章", "第二章", "第十章", "第2章", "番外"])

    def test_chapter_keeps_text_and_continuation_page_without_ads(self):
        with patch.object(spider, "_fetch", return_value=CHAPTER):
            result = namespace["chapter"]("https://www.suduguu.com/51/1.html")
        self.assertEqual(result["title"], "第一章")
        self.assertIn("第二段", result["content"])
        self.assertNotIn("恶意脚本", result["content"])
        self.assertNotIn("隐藏广告", result["content"])
        self.assertTrue(result["nextPageUrl"].endswith("/51/1-2.html"))
        with patch.object(spider, "_fetch", return_value=CHAPTER):
            self.assertNotIn("error", namespace["chapter"]("https://www.suduguu.com/51/1-2.html"))

    def test_homepage_cannot_be_mistaken_for_chapter(self):
        with patch.object(spider, "_fetch", return_value=DETAIL):
            self.assertIn("error", namespace["chapter"]("/51/123.html"))

    def test_listing_uses_current_page_urls_and_last_page(self):
        html = DETAIL + '<div class="page"><a href="/xuanhuan/89.html">末页</a></div>'
        with patch.object(spider, "_fetch", return_value=html) as fetch:
            result = namespace["listing"]("xuanhuan", 2)
        fetch.assert_called_once_with("/xuanhuan/2.html")
        self.assertEqual(result["pagecount"], 89)
        self.assertEqual(len(result["list"]), 1)

    def test_search_matches_current_form_and_no_result_is_not_an_error(self):
        with patch.object(spider, "_fetch", return_value='<div class="container"></div>') as fetch:
            result = namespace["search"]("测试 小说", 1)
        self.assertTrue(fetch.call_args.args[0].startswith("/i/sor.aspx?key="))
        self.assertEqual(result["list"], [])
        self.assertNotIn("error", result)

    def test_invalid_identifiers_and_arbitrary_hosts_do_not_fetch(self):
        with patch.object(spider, "_fetch") as fetch:
            self.assertIn("error", namespace["detail"]("../51"))
            self.assertIn("error", namespace["chapter"]("https://evil.example/51/1.html"))
            self.assertIn("error", namespace["listing"]("../anything"))
        fetch.assert_not_called()

    def test_site_redirect_cannot_escape_allowed_hosts(self):
        class Redirect:
            status_code = 302
            headers = {"Location": "http://127.0.0.1/private"}
            def __enter__(self): return self
            def __exit__(self, *args): return False
        with patch.object(spider.session, "get", return_value=Redirect()) as fetch:
            with self.assertRaises(ValueError):
                spider._fetch("https://www.suduguu.com/")
        self.assertEqual(fetch.call_count, 1)

    def test_network_failure_has_retryable_business_error(self):
        with patch.object(spider, "_fetch", side_effect=TimeoutError("页面读取超时")):
            result = namespace["home"]()
        self.assertEqual(result["code"], "SOURCE_FAILED")
        self.assertIn("超时", result["error"])

    def test_flask_routes_return_json_and_failures_use_http_error(self):
        client = namespace["app"].test_client()
        self.assertEqual(client.get("/check").json["runtime"], "python")
        with patch.object(spider, "_fetch", return_value=DETAIL):
            self.assertEqual(client.get("/api/detail?id=51").json["vod_name"], "测试小说")
        self.assertEqual(client.get("/api/detail?id=../51").status_code, 502)
        self.assertEqual(client.get("/api/unknown").status_code, 404)

    def test_host_runner_loads_real_entry_with_derived_filename_and_reuses_wsgi_state(self):
        if not (ROOT / "lib" / "python" / "spider_runner.py").exists():
            self.skipTest("宿主 runner 集成只在 Flutter 源码仓库执行")
        sys.path.insert(0, str(ROOT / "lib" / "python"))
        from spider_runner import SpiderRunner
        runner = SpiderRunner()
        code = (APP_DIR / "app.py").read_text()
        self.assertTrue(runner.load_app("app_test_reader", code, str(APP_DIR))["success"])
        module = runner._spiders["app_test_reader"]["module"]
        self.assertTrue(runner.load_app("app_test_reader", code, str(APP_DIR))["success"])
        self.assertIs(module, runner._spiders["app_test_reader"]["module"])
        with patch.object(module["_backend"]["_spider"], "_fetch", return_value=DETAIL):
            result = runner.call_app("app_test_reader", "detail", ["51"])
        self.assertTrue(result["success"])
        self.assertEqual(result["result"]["vod_name"], "测试小说")
        self.assertTrue(callable(runner.get_wsgi_app("app_test_reader")))


if __name__ == "__main__":
    unittest.main()
