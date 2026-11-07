"""基于附件速读谷 Spider 的阅读适配层。

保留原采集脚本，修正站点迁移、目录顺序、正文选择器和分页。
入口用 runpy 按包内路径加载，避免宿主多个 Python 小程序的同名 import 串包。
"""

import re
import runpy
import threading
from pathlib import Path
from urllib.parse import urlencode, urljoin, urlsplit

from bs4 import BeautifulSoup

OriginalSpider = runpy.run_path(str(Path(__file__).parent / "sudugu_spider.py"))["Spider"]
ALLOWED_HOSTS = {"sudugu.org", "www.sudugu.org", "suduguu.com", "www.suduguu.com"}
BOOK_PATH = re.compile(r"^/(\d+)/?(?:#dir)?$")
CHAPTER_PATH = re.compile(r"^/(\d+)/(\d+)(?:[-_](\d+))?\.html$")


class ReaderSpider(OriginalSpider):
    def init(self, extend=""):
        super().init(extend)
        # 2026-11-08 实测：附件中的 sudugu.org 重定向到此域名。
        self.host = "https://www.suduguu.com"
        self.session.headers["Referer"] = self.host + "/"

    def _fix_url(self, value):
        return urljoin(self.host + "/", value) if value else ""

    def safe_url(self, value):
        url = self._fix_url(value)
        parts = urlsplit(url)
        if parts.scheme != "https" or parts.hostname not in ALLOWED_HOSTS or parts.username or parts.password or parts.port not in {None, 443}:
            raise ValueError("只支持速读谷站内 HTTPS 地址")
        return url

    def _fetch(self, url, timeout=12):
        url = self.safe_url(url)
        # Python 请求不经过 ant.request 的白名单；在采集层限制域名与重定向。
        for _ in range(4):
            with self.session.get(url, timeout=(4, timeout), allow_redirects=False, stream=True) as response:
                if response.status_code in {301, 302, 303, 307, 308}:
                    url = self.safe_url(urljoin(url, response.headers.get("Location", "")))
                    continue
                response.raise_for_status()
                chunks, size = [], 0
                for chunk in response.iter_content(65536):
                    size += len(chunk)
                    if size > 3 * 1024 * 1024:
                        raise ValueError("站点页面过大，请稍后重试")
                    chunks.append(chunk)
                return b"".join(chunks).decode("utf-8", errors="replace")
        raise ValueError("站点重定向次数过多")

    def _parse_book_item(self, item):
        book = super()._parse_book_item(item)
        if not book:
            return None
        title = item.select_one("h1 a, h3 a, h2 a")
        if title:
            book["vod_name"] = title.get_text(strip=True)
        author = next((a.get_text(strip=True) for a in item.select("p a") if "作者" in a.get_text()), "")
        book["vod_actor"] = re.sub(r"^作者[：:]\s*", "", author)
        return book

    def _extract_category_books(self, html):
        soup = BeautifulSoup(html, "html.parser")
        books, seen = [], set()
        for item in soup.select(".item, .search-item"):
            book = self._parse_book_item(item)
            if book and book["vod_id"] not in seen:
                seen.add(book["vod_id"])
                books.append(book)
        if not books:
            for anchor in soup.select(".container a[href]"):
                parts = urlsplit(self._fix_url(anchor["href"]))
                match = BOOK_PATH.fullmatch(parts.path)
                title = anchor.get_text(strip=True) or anchor.get("title", "")
                if not match or not title or match[1] in seen or title in {"开始阅读", "全文目录"}:
                    continue
                seen.add(match[1])
                image = anchor.find("img")
                books.append({"vod_id": match[1], "vod_name": title,
                              "vod_pic": self._fix_url(image.get("src", "")) if image else "",
                              "vod_remarks": ""})
        return books

    def pagination(self, html, page):
        soup = BeautifulSoup(html, "html.parser")
        numbers = [page]
        for anchor in soup.select(".page a, .pages a, .pagination a"):
            href = anchor.get("href", "")
            match = re.search(r"(?:index_|/)(\d+)\.html|[?&]page=(\d+)", href)
            if match:
                numbers.append(int(match[1] or match[2]))
        return max(numbers)

    def book(self, book_id):
        html = self._fetch(f"/{book_id}/")
        soup = BeautifulSoup(html, "html.parser")
        container = soup.select_one(".item")
        metadata = self._parse_book_item(container) if container else None
        if not metadata or metadata["vod_id"] != book_id:
            raise ValueError("未找到这本小说，可能已下架，请返回书城重试")
        title = soup.select_one(".item h1 a, .item h3 a") or soup.select_one("h1")
        metadata["vod_name"] = title.get_text(strip=True) if title else metadata["vod_name"]
        intro = soup.select_one(".intro, .desc, .des")
        metadata["vod_content"] = intro.get_text("\n", strip=True) if intro else "暂无简介"
        directory = soup.select_one("#list, .dir, .chapter-list") or soup
        chapters, seen = [], set()
        for anchor in directory.select("a[href]"):
            url = self._fix_url(anchor["href"])
            match = CHAPTER_PATH.fullmatch(urlsplit(url).path)
            name = anchor.get_text(strip=True)
            if not match or match[1] != book_id or url in seen or not name or name in {"上一章", "下一章", "开始阅读"}:
                continue
            self.safe_url(url)
            seen.add(url)
            chapters.append({"title": name, "url": url})
        if not chapters:
            raise ValueError("未找到小说目录，请稍后重试")
        # 直接保留站点目录的顺序；中文章号、番外、感言不能按首个阿拉伯数字排序。
        metadata["chapters"] = chapters
        return metadata

    def chapter(self, value):
        url = self.safe_url(value)
        match = CHAPTER_PATH.fullmatch(urlsplit(url).path)
        if not match:
            raise ValueError("章节地址格式不正确")
        soup = BeautifulSoup(self._fetch(url), "html.parser")
        title_tag = soup.select_one("h1, h2, h3")
        title = title_tag.get_text(strip=True).split(">")[-1].strip() if title_tag else "章节正文"
        content_node = soup.select_one(".con, #content, #chapter-content, .chapter-content, .novel-content, .book-content, #nr, #nr1")
        if content_node is None:
            raise ValueError("未找到章节正文，站点可能已改版，请稍后重试")
        for tag in content_node.select("script, style, iframe, .prenext, .ad, [style*='display:none'], [style*='display: none']"):
            tag.decompose()
        text = content_node.get_text("\n", strip=True)
        paragraphs = [line.strip() for line in text.splitlines() if line.strip()]
        if len("".join(paragraphs)) < 20:
            raise ValueError("章节正文为空，请重试")
        previous, following, next_page, previous_page = "", "", "", ""
        for anchor in soup.select(".prenext a[href], .page a[href], .pages a[href]"):
            label = anchor.get_text(strip=True)
            link = self._fix_url(anchor["href"])
            target = CHAPTER_PATH.fullmatch(urlsplit(link).path)
            if not target or target[1] != match[1]:
                continue
            self.safe_url(link)
            if "下一页" in label or "下页" in label:
                next_page = link
            elif "上一页" in label or "上页" in label:
                previous_page = link
            elif "下一章" in label:
                following = link
            elif "上一章" in label:
                previous = link
        return {"title": title, "content": "\n\n".join(paragraphs), "url": url,
                "previousUrl": previous, "nextUrl": following, "nextPageUrl": next_page,
                "previousPageUrl": previous_page}


_spider = ReaderSpider()
_spider.init()
_lock = threading.RLock()


def home():
    with _lock:
        html = _spider._fetch(_spider.host)
        return {"categories": _spider.homeContent()["class"],
                "list": _spider._extract_all_books(html)[:30], "source": _spider.host}


def listing(category="all", page=1):
    page = max(1, min(int(page), 10000))
    if category not in _spider.class_map:
        raise ValueError("未知小说分类")
    # 全部改用最新更新列表，避免附件把首页推荐当成无限分页。
    slug = "zuixin" if category == "all" else category
    path = f"/{slug}/" if page == 1 else f"/{slug}/{page}.html"
    with _lock:
        html = _spider._fetch(path)
        return {"list": _spider._extract_category_books(html), "page": page,
                "pagecount": _spider.pagination(html, page)}


def search(keyword, page=1):
    keyword = str(keyword).strip()[:80]
    if not keyword:
        raise ValueError("请输入书名或作者")
    page = max(1, min(int(page), 10000))
    with _lock:
        # 当前站点搜索表单是 /i/sor.aspx?key=，附件的 so.aspx?keyword= 只返回空表单。
        html = _spider._fetch("/i/sor.aspx?" + urlencode({"key": keyword, "page": page}))
        return {"list": _spider._extract_category_books(html), "page": page,
                "pagecount": _spider.pagination(html, page)}


def detail(book_id):
    book_id = str(book_id)
    if not re.fullmatch(r"\d+", book_id):
        raise ValueError("书籍编号格式不正确")
    with _lock:
        return _spider.book(book_id)


def chapter(url):
    with _lock:
        return _spider.chapter(str(url))
