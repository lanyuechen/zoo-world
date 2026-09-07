#!/usr/bin/env python3
"""
从官方 PDF / LPSC 数据包重建中国生物多样性红色名录 JSON。

依赖：pip install pypdf rdata
数据：
  - 脊椎动物卷 PDF（生态环境部）
  - helixcn/LPSC dat_CBRL2020_higher_plants.rda（高等植物卷 2020）
"""
from __future__ import annotations

import json
import os
import re
import sys
import urllib.request
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / 'data' / 'protection'
CACHE = ROOT / 'data' / 'raw' / 'redlist-cache'
VERT_PDF_URL = 'https://www.mee.gov.cn/xxgk2018/xxgk/xxgk01/202305/W020230522536559098623.pdf'
PLANT_RDA_URL = 'https://raw.githubusercontent.com/helixcn/LPSC/main/data/dat_CBRL2020_higher_plants.rda'
ANNOUNCE_URL = 'https://www.mee.gov.cn/xxgk2018/xxgk/xxgk01/202305/t20230522_1030745.html'
PLANT_PDF_URL = 'https://www.mee.gov.cn/xxgk2018/xxgk/xxgk01/202305/W020230522536560832337.pdf'

CAT_LABEL = {
    'EX': '绝灭',
    'EW': '野外绝灭',
    'RE': '地区绝灭',
    'CR': '极危',
    'EN': '濒危',
    'VU': '易危',
    'NT': '近危',
    'LC': '无危',
    'DD': '数据缺乏',
    'NE': '未评估',
    'NA': '不适用',
}
CATS = r'(EX|EW|RE|CR|EN|VU|NT|LC|DD|NE|NA)'


def label(cat: str) -> str:
    return f'{CAT_LABEL.get(cat, cat)}（{cat}）'


def download(url: str, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and dest.stat().st_size > 1000:
        return
    print(f'下载 {url}')
    req = urllib.request.Request(url, headers={'User-Agent': 'zoo-world-redlist-builder/1.0'})
    with urllib.request.urlopen(req, timeout=120) as res, open(dest, 'wb') as f:
        f.write(res.read())


def build_vertebrates(pdf_path: Path) -> list[dict]:
    from pypdf import PdfReader

    text = '\n'.join((p.extract_text() or '') for p in PdfReader(str(pdf_path)).pages)
    text = text.replace('\r', '')
    text = re.sub(r'([a-z])\s*\n\s*([a-z])', r'\1 \2', text)
    pat = re.compile(
        r'\b([A-Z][a-z]+(?:\s+(?:×\s*)?[a-z][a-z\-]*'
        r'(?:\s+(?:var\.|subsp\.)\s+[a-z\-]+|\s+[a-z\-]+)?)*)\s+'
        + CATS
        + r'\b'
    )
    by: dict[str, dict] = {}
    for m in pat.finditer(text):
        latin = re.sub(r'\s+', ' ', m.group(1).strip())
        cat = m.group(2)
        words = latin.split()
        if len(words) < 2:
            continue
        if words[0].endswith(('idae', 'aceae', 'inae')):
            continue
        key = latin.lower()
        if key not in by:
            by[key] = {
                'scientificName': latin,
                'chineseName': '',
                'category': cat,
                'label': label(cat),
                'group': 'vertebrate',
            }
    return sorted(by.values(), key=lambda x: x['scientificName'])


def build_plants(rda_path: Path) -> list[dict]:
    import rdata

    converted = rdata.conversion.convert(rdata.parser.parse_file(str(rda_path)))
    df = converted['dat_CBRL2020_higher_plants']
    out: list[dict] = []
    seen: set[str] = set()
    for _, row in df.iterrows():
        latin = str(row['species']).strip()
        if not latin or latin == 'nan':
            continue
        cat = str(row['iucn_red_list_category']).strip().upper().replace(' ', '')
        if cat not in CAT_LABEL:
            continue
        key = latin.lower()
        if key in seen:
            continue
        seen.add(key)
        zh = str(row['species_cn']).strip()
        if zh == 'nan':
            zh = ''
        out.append(
            {
                'scientificName': latin,
                'chineseName': zh,
                'category': cat,
                'label': label(cat),
                'group': 'plant',
            }
        )
    return sorted(out, key=lambda x: x['scientificName'])


def main() -> None:
    CACHE.mkdir(parents=True, exist_ok=True)
    vert_pdf = CACHE / 'china-redlist-vertebrates-2020.pdf'
    plant_rda = CACHE / 'dat_CBRL2020_higher_plants.rda'
    download(VERT_PDF_URL, vert_pdf)
    download(PLANT_RDA_URL, plant_rda)

    print('解析脊椎动物卷…')
    verts = build_vertebrates(vert_pdf)
    print('  ', len(verts), dict(Counter(v['category'] for v in verts)))

    print('解析高等植物卷…')
    plants = build_plants(plant_rda)
    print('  ', len(plants), dict(Counter(p['category'] for p in plants)))

    now = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    animal_out = {
        'title': '中国生物多样性红色名录—脊椎动物卷（2020）',
        'shortTitle': '红色名录（脊椎动物）',
        'version': '2020',
        'source': '生态环境部、中国科学院公告（2023年第15号）',
        'sourceUrl': ANNOUNCE_URL,
        'pdfUrl': VERT_PDF_URL,
        'compiledAt': now,
        'notes': [
            '评估对象为中国分布脊椎动物（智人除外）',
            '等级采用 IUCN 红色名录类别：EX/EW/RE/CR/EN/VU/NT/LC/DD',
        ],
        'species': verts,
    }
    plant_out = {
        'title': '中国生物多样性红色名录—高等植物卷（2020）',
        'shortTitle': '红色名录（高等植物）',
        'version': '2020',
        'source': '生态环境部、中国科学院公告（2023年第15号）',
        'sourceUrl': ANNOUNCE_URL,
        'pdfUrl': PLANT_PDF_URL,
        'dataSource': 'helixcn/LPSC dat_CBRL2020_higher_plants（中国生物多样性红色名录2020）',
        'compiledAt': now,
        'notes': [
            '评估对象为中国分布高等植物',
            '等级采用 IUCN 红色名录类别：EX/EW/RE/CR/EN/VU/NT/LC/DD',
        ],
        'species': plants,
    }

    ap = OUT_DIR / 'china-redlist-vertebrates-2020.json'
    pp = OUT_DIR / 'china-redlist-plants-2020.json'
    ap.write_text(json.dumps(animal_out, ensure_ascii=False, separators=(',', ':')), encoding='utf8')
    pp.write_text(json.dumps(plant_out, ensure_ascii=False, separators=(',', ':')), encoding='utf8')
    print(f'写入 {ap} ({ap.stat().st_size/1e6:.2f} MB)')
    print(f'写入 {pp} ({pp.stat().st_size/1e6:.2f} MB)')


if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        print(e, file=sys.stderr)
        sys.exit(1)
