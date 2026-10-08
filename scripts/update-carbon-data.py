#!/usr/bin/env python3
"""全国碳市场行情每日更新：抓取 CEA（carbonmarket.cn）+ CCER（ccer.com.cn），
合并写入 EnvLab-交互实验集/11-碳与碳市场/carbon-data.json。
设计为 GitHub Actions 每日定时运行；本地也可直接跑。
只用标准库，零依赖。
"""
import json, re, sys, os, urllib.request, datetime

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_PATH = os.path.join(REPO_ROOT, "EnvLab-交互实验集", "11-碳与碳市场", "carbon-data.json")
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"}

def get(url, referer=None, timeout=30):
    h = dict(UA)
    if referer:
        h["Referer"] = referer
    req = urllib.request.Request(url, headers=h)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", "replace")

def num(s):
    return float(s.replace(",", "").strip() or 0)

def fetch_cea():
    """返回 {date: dict}，含挂牌+大宗合并。"""
    html = get("https://carbonmarket.cn/ets/cets/")
    tables = re.findall(r'<table class="table table-hover text-center".*?</table>', html, re.S)
    out = {}
    # 表0：挂牌协议 日期 开盘 收盘 最高 最低 涨跌 成交量 成交额 振幅
    for tr in re.findall(r"<tr.*?>(.*?)</tr>", tables[0], re.S)[1:]:
        c = [re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", x)).strip()
             for x in re.findall(r"<t[dh].*?>(.*?)</t[dh]>", tr, re.S)]
        if len(c) < 8 or not re.match(r"\d{4}-\d{2}-\d{2}", c[0]):
            continue
        out[c[0]] = {"date": c[0], "open": num(c[1]), "close": num(c[2]),
                     "high": num(c[3]), "low": num(c[4]),
                     "listed_vol": num(c[6]), "listed_amt": num(c[7]),
                     "block_vol": 0, "block_amt": 0}
    # 表1：大宗协议 日期 成交量 成交额 均价 折溢价
    if len(tables) > 1:
        for tr in re.findall(r"<tr.*?>(.*?)</tr>", tables[1], re.S)[1:]:
            c = [re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", x)).strip()
                 for x in re.findall(r"<t[dh].*?>(.*?)</t[dh]>", tr, re.S)]
            if len(c) < 4 or not re.match(r"\d{4}-\d{2}-\d{2}", c[0]):
                continue
            d = out.setdefault(c[0], {"date": c[0], "open": 0, "close": 0, "high": 0,
                                      "low": 0, "listed_vol": 0, "listed_amt": 0,
                                      "block_vol": 0, "block_amt": 0})
            d["block_vol"] = num(c[1]); d["block_amt"] = num(c[2])
    for d in out.values():
        d["tot_vol"] = d["listed_vol"] + d["block_vol"]
        d["tot_amt"] = d["listed_amt"] + d["block_amt"]
    return out

CCER_INDEX = "https://www.ccer.com.cn/wcm/ccer/data/2502lshq.json"
CCER_REFERER = "https://www.ccer.com.cn/wcm/ccer/html/2502lshq/index.html"

def parse_ccer_article(url):
    """解析一篇 CCER 日行情文章，返回 dict（含累计值）或 None。"""
    page = get(url, referer=CCER_REFERER)
    body = re.sub(r"<[^>]+>", "", re.search(r'<div id="zoom".*?</div>', page, re.S).group(0))
    mc = re.search(r"累计成交量([\d,]+)吨，累计成交额([\d,\.]+)元", body)
    cum = {"cum_vol": num(mc.group(1)), "cum_amt": num(mc.group(2))} if mc else {"cum_vol": None, "cum_amt": None}
    m = re.search(r"成交量([\d,]+)吨，成交额([\d,\.]+)元，成交均价([\d\.]+)元/吨", body)
    if m:
        return {"vol": num(m.group(1)), "amt": num(m.group(2)), "avg": float(m.group(3)), **cum}
    if "无成交" in body:
        return {"vol": 0, "amt": 0, "avg": None, **cum}
    return None

def fetch_ccer(ccer_map):
    """抓取近 400 天内缺失的 CCER 日行情，返回 [dict]（含无成交日，avg=None）。"""
    idx = get(CCER_INDEX, referer=CCER_REFERER)
    rows = json.loads(idx)["rows"]
    cutoff = (datetime.date.today() - datetime.timedelta(days=400)).isoformat()
    new = []
    for r in rows:
        pub = (r.get("publishedTime") or "")[:10]
        if pub < cutoff or pub in ccer_map:
            continue
        url = "https://www.ccer.com.cn/wcm/ccer/html/" + r["url"]
        try:
            art = parse_ccer_article(url)
        except Exception as e:
            print(f"  [warn] 文章抓取失败 {pub}: {e}", file=sys.stderr)
            continue
        if art is None:
            print(f"  [warn] 解析失败 {pub}", file=sys.stderr)
            continue
        art["date"] = pub
        new.append(art)
        print(f"  CCER {pub}: " + ("无成交" if not art["avg"] else f"均价{art['avg']} 成交量{art['vol']:g}"))
    return sorted(new, key=lambda x: x["date"])

def main():
    old = json.load(open(DATA_PATH, encoding="utf-8"))
    cea_map = {x["date"]: x for x in old["cea"]}
    ccer_map = {x["date"]: x for x in old["ccer"]}
    print(f"现有数据: CEA {len(cea_map)} 天 (至 {max(cea_map)}), CCER {len(ccer_map)} 天 (至 {max(ccer_map)})")

    print("抓取 CEA...")
    fresh_cea = fetch_cea()
    n_cea = 0
    for d, x in fresh_cea.items():
        if d not in cea_map:
            cea_map[d] = x; n_cea += 1
    print(f"  新增 CEA {n_cea} 天，最新 {max(cea_map)}")

    print("抓取 CCER...")
    new_ccer = fetch_ccer(ccer_map)
    for x in new_ccer:
        ccer_map[x["date"]] = x
    print(f"  新增 CCER {len(new_ccer)} 天，最新 {max(ccer_map)}")

    for x in cea_map.values():  # 历史遗留累计字段不再维护，统一去掉
        x.pop("cum_vol", None); x.pop("cum_amt", None)
    cea = sorted(cea_map.values(), key=lambda x: x["date"])[-400:]
    ccer = sorted(ccer_map.values(), key=lambda x: x["date"])
    # 最新一条 CCER 若缺累计值，补抓一次（仅 1 个请求）
    if ccer and not ccer[-1].get("cum_vol"):
        try:
            rows = json.loads(get(CCER_INDEX, referer=CCER_REFERER))["rows"]
            r = next((x for x in rows if (x.get("publishedTime") or "")[:10] == ccer[-1]["date"]), None)
            if r:
                art = parse_ccer_article("https://www.ccer.com.cn/wcm/ccer/html/" + r["url"])
                if art and art.get("cum_vol"):
                    ccer[-1]["cum_vol"] = art["cum_vol"]
                    ccer[-1]["cum_amt"] = art["cum_amt"]
                    print(f"  已补最新日累计值：{art['cum_vol']:g} 吨")
        except Exception as e:
            print(f"  [warn] 累计值回填失败: {e}", file=sys.stderr)
    latest = max(max(cea_map), max(ccer_map))
    out = {"updated": latest, "stale": False,
           "source": "CEA: carbonmarket.cn / CCER: ccer.com.cn（自建每日管线）",
           "cea": cea, "ccer": ccer}
    json.dump(out, open(DATA_PATH, "w", encoding="utf-8"), ensure_ascii=False)
    print(f"已写入 {DATA_PATH}，数据截至 {latest}，CEA {len(cea)} 天 / CCER {len(ccer)} 天")

    print("抓取 CCER 官方资讯...")
    update_ccer_news()


# ---------------- CCER 官方资讯（近期动态） ----------------
NEWS_CHANNELS = [
    ("2408scdt1", "市场动态"),
    ("2311ptggc1", "平台公告"),
]
NEWS_PATH = os.path.join(REPO_ROOT, "EnvLab-交互实验集", "11-碳与碳市场", "ccer-news.json")

def fetch_ccer_news():
    """抓取 CCER 官方市场动态+平台公告，返回按日期倒序的资讯列表。"""
    items = []
    for code, cat in NEWS_CHANNELS:
        try:
            idx = get(f"https://www.ccer.com.cn/wcm/ccer/data/{code}.json",
                      referer=f"https://www.ccer.com.cn/wcm/ccer/html/{code}/index.html")
            rows = json.loads(idx)["rows"]
        except Exception as e:
            print(f"  [warn] 资讯频道 {code} 抓取失败: {e}", file=sys.stderr)
            continue
        for r in rows:
            title = (r.get("title") or "").strip()
            pub = (r.get("publishedTime") or "")[:10]
            url = (r.get("url") or "").strip()
            if not title or not pub or not url:
                continue
            # 跳过每日行情（已在行情看板覆盖）
            if "交易行情" in title:
                continue
            items.append({
                "date": pub,
                "title": title,
                "url": "https://www.ccer.com.cn/wcm/ccer/html/" + url,
                "category": cat,
            })
    # 按日期去重倒序
    seen, out = set(), []
    for it in sorted(items, key=lambda x: x["date"], reverse=True):
        key = (it["date"], it["title"])
        if key in seen:
            continue
        seen.add(key)
        out.append(it)
    return out[:30]

def update_ccer_news():
    news = fetch_ccer_news()
    if not news:
        print("  [warn] 未抓到资讯，跳过写入", file=sys.stderr)
        return False
    payload = {"updated": news[0]["date"],
               "source": "全国温室气体自愿减排交易系统（ccer.com.cn）官方资讯",
               "items": news}
    json.dump(payload, open(NEWS_PATH, "w", encoding="utf-8"), ensure_ascii=False)
    print(f"  资讯 {len(news)} 条，最新 {news[0]['date']}：{news[0]['title'][:30]}")
    return True

if __name__ == "__main__":
    main()
