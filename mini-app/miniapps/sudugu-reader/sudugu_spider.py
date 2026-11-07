# -*- coding: utf-8 -*-
# TVBox爬虫 - 速读谷
# 目标：https://www.sudugu.org/

import sys
import re
import json
import urllib.parse
from bs4 import BeautifulSoup
import requests

class Spider:
    def getName(self):
        return "速读谷"

    def init(self, extend=""):
        self.host = "https://www.sudugu.org"
        self.session = requests.Session()
        self.session.headers.update({
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Referer": self.host,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
            "Accept-Language": "zh-CN,zh;q=0.9",
            "Accept-Encoding": "gzip, deflate",
        })
        # 分类映射 + 特殊分类"全部"
        self.class_map = {
            "all": "全部",
            "xuanhuan": "玄幻小说",
            "xianxia": "仙侠小说",
            "dushi": "都市小说",
            "lishi": "历史小说",
            "junshi": "军事小说",
            "kehuan": "科幻小说",
            "yanqing": "言情小说",
        }

    def _fix_url(self, url):
        if not url:
            return ""
        if url.startswith("http"):
            return url
        if url.startswith("//"):
            return "https:" + url
        if url.startswith("/"):
            return self.host + url
        return self.host + "/" + url

    def _fetch(self, url, timeout=15):
        try:
            resp = self.session.get(url, timeout=timeout)
            resp.encoding = "utf-8"
            return resp.text
        except Exception as e:
            print(f"[Fetch Error] {url} -> {e}")
            return ""

    def homeContent(self, filter=False):
        classes = [{"type_id": tid, "type_name": name} for tid, name in self.class_map.items()]
        return {"class": classes}

    def homeVideoContent(self):
        """首页推荐 - 从多个板块提取"""
        try:
            html = self._fetch(self.host)
            if not html:
                return {"list": []}
            videos = self._extract_all_books(html)
            return {"list": videos[:30]}
        except Exception as e:
            print(f"首页异常: {e}")
            return {"list": []}

    def _extract_all_books(self, html):
        """从HTML中提取所有书籍（多策略）"""
        soup = BeautifulSoup(html, "html.parser")
        videos = []
        seen = set()

        # 策略1：从 item 类提取（首页最新更新）
        for item in soup.select(".container .item"):
            book = self._parse_book_item(item)
            if book and book["vod_id"] not in seen:
                seen.add(book["vod_id"])
                videos.append(book)

        # 策略2：从顶部排行列表提取
        for item in soup.select(".list.top .imga"):
            a_tag = item if item.name == "a" else item.find("a")
            if not a_tag:
                continue
            href = a_tag.get("href", "")
            id_match = re.search(r"/(\d+)/", href)
            vod_id = id_match.group(1) if id_match else ""
            if not vod_id or vod_id in seen:
                continue
            seen.add(vod_id)

            title = a_tag.get("title", "") or a_tag.get_text(strip=True)
            img = a_tag.find("img")
            pic = img.get("src", "") if img else ""
            pic = self._fix_url(pic)

            # 查找书籍名称（在列表项中的p标签里）
            parent = a_tag.parent
            if parent:
                p_tag = parent.find("p")
                if p_tag:
                    title = p_tag.get_text(strip=True)

            videos.append({
                "vod_id": vod_id,
                "vod_name": title or f"书籍{vod_id}",
                "vod_pic": pic,
                "vod_remarks": "排行"
            })

        # 策略3：从底部的热门小说列表提取
        for a in soup.select(".menu.mt10 ul li a"):
            href = a.get("href", "")
            id_match = re.search(r"/(\d+)/", href)
            vod_id = id_match.group(1) if id_match else ""
            if not vod_id or vod_id in seen:
                continue
            seen.add(vod_id)
            title = a.get_text(strip=True)
            videos.append({
                "vod_id": vod_id,
                "vod_name": title or f"书籍{vod_id}",
                "vod_pic": "",
                "vod_remarks": "推荐"
            })

        return videos

    def _parse_book_item(self, item):
        """解析单个书籍条目"""
        a_tag = item.find("a")
        if not a_tag:
            return None
        href = a_tag.get("href", "")
        id_match = re.search(r"/(\d+)/", href)
        vod_id = id_match.group(1) if id_match else ""
        if not vod_id:
            return None

        title_tag = item.find("h1") or item.find("h3")
        title = title_tag.get_text(strip=True) if title_tag else ""

        img = item.find("img")
        pic = img.get("src", "") if img else ""
        pic = self._fix_url(pic)

        remark = ""
        for span in item.select(".itemtxt p span, .txt p span"):
            text = span.get_text(strip=True)
            if text:
                if remark:
                    remark = remark + " " + text
                else:
                    remark = text

        return {
            "vod_id": vod_id,
            "vod_name": title,
            "vod_pic": pic,
            "vod_remarks": remark
        }

    def _extract_category_books(self, html):
        """从分类页提取书籍"""
        soup = BeautifulSoup(html, "html.parser")
        videos = []
        seen = set()

        # 从 .container .item 中提取
        for item in soup.select(".container .item"):
            book = self._parse_book_item(item)
            if book and book["vod_id"] not in seen:
                seen.add(book["vod_id"])
                videos.append(book)

        # 从列表页的其他格式提取
        for item in soup.select(".list .item, .item-list .item"):
            book = self._parse_book_item(item)
            if book and book["vod_id"] not in seen:
                seen.add(book["vod_id"])
                videos.append(book)

        # 从普通链接提取（兜底）
        for a in soup.find_all("a", href=re.compile(r"/\d+/")):
            href = a.get("href", "")
            if href == "/" or href.startswith("/i/") or href.startswith("/fenlei/"):
                continue
            id_match = re.search(r"/(\d+)/", href)
            vod_id = id_match.group(1) if id_match else ""
            if not vod_id or vod_id in seen:
                continue
            seen.add(vod_id)

            title = a.get_text(strip=True)
            if not title or len(title) < 2:
                continue

            # 尝试找图片
            pic = ""
            img_tag = a.find("img")
            if img_tag:
                pic = img_tag.get("src", "")
                pic = self._fix_url(pic)

            videos.append({
                "vod_id": vod_id,
                "vod_name": title,
                "vod_pic": pic,
                "vod_remarks": ""
            })

        return videos

    def categoryContent(self, tid, pg, filter=False, extend=None):
        pg = int(pg) if pg else 1

        # ===== 特殊处理："全部"分类 =====
        if tid == "all":
            return self._get_all_books(pg)

        # ===== 普通分类 =====
        if pg <= 1:
            url = f"{self.host}/{tid}/"
        else:
            url = f"{self.host}/{tid}/index_{pg}.html"

        html = self._fetch(url)
        if not html:
            return {"list": [], "page": pg, "pagecount": 1, "limit": 20, "total": 0}

        videos = self._extract_category_books(html)

        # 分页
        pagecount = 1
        soup = BeautifulSoup(html, "html.parser")
        pagination = soup.select(".pages, .page, .pagination")
        for p in pagination:
            for a in p.find_all("a"):
                href = a.get("href", "")
                m = re.search(r"index_(\d+)\.html", href)
                if m:
                    try:
                        num = int(m.group(1))
                        if num > pagecount:
                            pagecount = num
                    except:
                        pass
                # 也检查 ?page= 格式
                m2 = re.search(r"page=(\d+)", href)
                if m2:
                    try:
                        num = int(m2.group(1))
                        if num > pagecount:
                            pagecount = num
                    except:
                        pass

        # 如果当前页有内容且pagecount较小，尝试给更多页
        if len(videos) >= 10 and pagecount <= pg:
            pagecount = pg + 1

        return {
            "list": videos,
            "page": pg,
            "pagecount": max(pagecount, pg),
            "limit": 20,
            "total": max(pagecount, pg) * 20
        }

    def _get_all_books(self, pg):
        """获取全部书籍 - 从首页多个来源合并"""
        try:
            html = self._fetch(self.host)
            if not html:
                return {"list": [], "page": pg, "pagecount": 1, "limit": 20, "total": 0}

            # 提取所有书籍
            all_books = self._extract_all_books(html)

            # 分页
            pagecount = (len(all_books) + 19) // 20 if len(all_books) > 20 else 1
            start = (pg - 1) * 20
            end = start + 20
            page_books = all_books[start:end]

            return {
                "list": page_books,
                "page": pg,
                "pagecount": max(pagecount, pg),
                "limit": 20,
                "total": len(all_books)
            }
        except Exception as e:
            print(f"全部书籍异常: {e}")
            return {"list": [], "page": pg, "pagecount": 1, "limit": 20, "total": 0}

    def _extract_chapter_num(self, text):
        if not text:
            return 9999
        nums = re.findall(r'\d+', text)
        return int(nums[0]) if nums else 9999

    def detailContent(self, ids):
        vod_id = ids[0]
        url = f"{self.host}/{vod_id}/"
        html = self._fetch(url)

        if not html:
            return {"list": []}

        soup = BeautifulSoup(html, "html.parser")

        title = ""
        title_tag = soup.find("h1") or soup.find("h3")
        if title_tag:
            title = title_tag.get_text(strip=True)
        if not title:
            title_match = re.search(r"<title>(.*?)</title>", html)
            if title_match:
                title = title_match.group(1).strip()

        pic = ""
        img_tag = soup.find("img")
        if img_tag:
            pic = img_tag.get("src", "")
            pic = self._fix_url(pic)

        desc = ""
        desc_tag = soup.find("div", class_="intro") or soup.find("div", class_="desc")
        if desc_tag:
            desc = desc_tag.get_text(strip=True)

        chapters = []
        for a in soup.find_all("a", href=re.compile(r"/\d+/\d+\.html")):
            href = a.get("href", "")
            name = a.get_text(strip=True)
            if not name:
                name_match = re.search(r"/(\d+)\.html$", href)
                if name_match:
                    name = f"第{name_match.group(1)}章"
                else:
                    name = href.split("/")[-1].replace(".html", "")
            if any(kw in name for kw in ["上一章", "下一章", "返回", "目录", "首页"]):
                continue
            if href.startswith("/"):
                href = self._fix_url(href)
            chapters.append(f"{name}${href}")

        if not chapters:
            chapters.append(f"第1章$/{vod_id}/1.html")

        if chapters:
            chapters.sort(key=lambda x: self._extract_chapter_num(x.split("$")[0] if "$" in x else x))

        play_url = "#".join(chapters)

        return {
            "list": [{
                "vod_id": vod_id,
                "vod_name": title or "未命名",
                "vod_pic": pic,
                "vod_content": desc,
                "vod_play_from": "速读谷",
                "vod_play_url": play_url
            }]
    }

    def _extract_content(self, html):
        soup = BeautifulSoup(html, "html.parser")

        for selector in ["#content", "#chapter-content", ".content", ".chapter-content", ".novel-content", ".book-content", ".txt", ".text", "#nr", "#nr1"]:
            elem = soup.select_one(selector)
            if elem:
                content = elem.get_text("\n", strip=True)
                if len(content) > 50:
                    return content

        ps = soup.find_all("p")
        if ps:
            content = "\n".join([p.get_text(strip=True) for p in ps if len(p.get_text(strip=True)) > 10])
            if len(content) > 50:
                return content

        for div in soup.find_all("div"):
            if div.get("style") and "display:none" in div.get("style"):
                continue
            text = div.get_text(strip=True)
            if len(text) > 100 and len(text) < 20000:
                return text

        body = soup.find("body")
        if body:
            for tag in body.find_all(["script", "style"]):
                tag.decompose()
            content = body.get_text("\n", strip=True)
            if len(content) > 50:
                return content

        return ""

    def playerContent(self, flag, id, vipFlags=None):
        try:
            url = id if id.startswith("http") else self._fix_url(id)
            html = self._fetch(url)

            if not html:
                result_data = {'title': '错误', 'content': '页面加载失败'}
                return {
                    "parse": 0,
                    "playUrl": "",
                    "url": f"novel://{json.dumps(result_data, ensure_ascii=False)}",
                    "header": ""
                }

            soup = BeautifulSoup(html, "html.parser")

            title = ""
            title_tag = soup.find("h1") or soup.find("h2") or soup.find("h3")
            if title_tag:
                title = title_tag.get_text(strip=True)
            if not title:
                title_match = re.search(r"<title>(.*?)</title>", html)
                if title_match:
                    title = title_match.group(1).strip()
            if not title:
                title = "章节正文"

            content = self._extract_content(html)

            if not content or len(content) < 20:
                result_data = {'title': title, 'content': '未找到章节内容'}
                return {
                    "parse": 0,
                    "playUrl": "",
                    "url": f"novel://{json.dumps(result_data, ensure_ascii=False)}",
                    "header": ""
                }

            content = re.sub(r'\n\s*\n', '\n\n', content)
            content = content.strip()

            result_data = {'title': title, 'content': content}
            return {
                "parse": 0,
                "playUrl": "",
                "url": f"novel://{json.dumps(result_data, ensure_ascii=False)}",
                "header": ""
            }
        except Exception as e:
            print(f"playerContent error: {e}")
            result_data = {'title': '错误', 'content': f'发生异常: {str(e)}'}
            return {
                "parse": 0,
                "playUrl": "",
                "url": f"novel://{json.dumps(result_data, ensure_ascii=False)}",
                "header": ""
            }

    def searchContent(self, key, quick=False, pg="1"):
        pg = int(pg) if pg else 1
        enc_key = urllib.parse.quote(key)

        if pg <= 1:
            url = f"{self.host}/i/so.aspx?keyword={enc_key}"
        else:
            url = f"{self.host}/i/so.aspx?keyword={enc_key}&page={pg}"

        html = self._fetch(url)
        if not html:
            return {"list": [], "page": pg, "pagecount": 1, "limit": 20, "total": 0}

        soup = BeautifulSoup(html, "html.parser")
        videos = []
        seen = set()

        for item in soup.select(".item, .list .item, .search-item"):
            a_tag = item.find("a", href=re.compile(r"/\d+/"))
            if not a_tag:
                continue
            href = a_tag.get("href", "")
            id_match = re.search(r"/(\d+)/", href)
            vod_id = id_match.group(1) if id_match else ""
            if not vod_id or vod_id in seen:
                continue
            seen.add(vod_id)

            title = a_tag.get_text(strip=True)
            if not title:
                title = a_tag.get("title", "")
            if not title:
                title = f"小说{vod_id}"

            img = item.find("img")
            pic = img.get("src", "") if img else ""
            pic = self._fix_url(pic)

            remark = ""
            for span in item.find_all("span"):
                text = span.get_text(strip=True)
                if text and len(text) < 20:
                    remark = text
                    break

            videos.append({
                "vod_id": vod_id,
                "vod_name": title,
                "vod_pic": pic,
                "vod_remarks": remark
            })

        # 如果没找到，从普通链接提取
        if not videos:
            for a in soup.find_all("a", href=re.compile(r"/\d+/")):
                href = a.get("href", "")
                if href == "/" or href.startswith("/i/") or href.startswith("/fenlei/"):
                    continue
                id_match = re.search(r"/(\d+)/", href)
                vod_id = id_match.group(1) if id_match else ""
                if not vod_id or vod_id in seen:
                    continue
                seen.add(vod_id)

                title = a.get_text(strip=True)
                if not title or len(title) < 2:
                    continue

                videos.append({
                    "vod_id": vod_id,
                    "vod_name": title,
                    "vod_pic": "",
                    "vod_remarks": "搜索"
                })

        pagecount = 3 if len(videos) >= 20 else 1
        return {"list": videos, "page": pg, "pagecount": pagecount, "limit": 20, "total": pagecount * 20}

    def isVideoFormat(self, url):
        return False

    def manualVideoCheck(self):
        return False

    def destroy(self):
        if self.session:
            self.session.close()

    def localProxy(self, param):
        return None