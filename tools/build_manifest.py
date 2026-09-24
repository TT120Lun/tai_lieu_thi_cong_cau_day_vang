# -*- coding: utf-8 -*-
"""
Quét thư mục files/docs, files/images và data/videos.txt -> sinh data/library.json
Cách dùng (chạy trong thư mục gốc của trang web):
    python tools/build_manifest.py

Quy ước thư mục:
    files/docs/<Tên dự án>/<tên tài liệu>.pdf      (chỉ nhận PDF; Word/Excel/bản vẽ hãy Save as PDF trước)
    files/images/<Tên dự án>/<tên ảnh>.jpg|png|webp
    data/videos.txt                                 (mỗi dòng 1 video YouTube)
Mô tả ngắn (tuỳ chọn): đặt file .txt cùng tên với tài liệu/ảnh, ví dụ  ban-ve-1.pdf -> ban-ve-1.txt
"""
import json, os, re, sys, datetime

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOCS = os.path.join(ROOT, "files", "docs")
IMGS = os.path.join(ROOT, "files", "images")
VIDS = os.path.join(ROOT, "data", "videos.txt")
OUT = os.path.join(ROOT, "data", "library.json")
IMG_EXT = {".jpg", ".jpeg", ".png", ".webp"}
NEED_PDF = {".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".dwg", ".dxf"}

def pretty(name):
    stem = os.path.splitext(name)[0]
    return re.sub(r"[_\-]+", " ", stem).strip()

def rel(path):
    return os.path.relpath(path, ROOT).replace("\\", "/")

def read_desc(path):
    txt = os.path.splitext(path)[0] + ".txt"
    if os.path.isfile(txt):
        with open(txt, encoding="utf-8-sig") as f:
            return f.read().strip()
    return ""

def project_of(base, path):
    parts = os.path.relpath(path, base).replace("\\", "/").split("/")
    return pretty(parts[0]) if len(parts) > 1 else "Chung"

def pdf_pages(path):
    try:
        import pymupdf as fitz
    except ImportError:
        try:
            import fitz
        except ImportError:
            return None
    try:
        with fitz.open(path) as d:
            return d.page_count
    except Exception:
        return None

def walk(base):
    for dp, dn, fn in os.walk(base):
        dn.sort()
        for f in sorted(fn):
            yield os.path.join(dp, f)

def yt_id(s):
    s = s.strip()
    m = re.search(r"(?:v=|youtu\.be/|embed/|shorts/)([A-Za-z0-9_-]{11})", s)
    if m:
        return m.group(1)
    return s if re.fullmatch(r"[A-Za-z0-9_-]{11}", s) else None

docs, imgs, vids, warns = [], [], [], []

for p in walk(DOCS):
    ext = os.path.splitext(p)[1].lower()
    name = os.path.basename(p)
    if ext == ".pdf":
        size = os.path.getsize(p) / 1048576
        docs.append({
            "title": pretty(name), "project": project_of(DOCS, p), "file": rel(p),
            "pages": pdf_pages(p), "size_mb": round(size, 1), "desc": read_desc(p),
        })
        if size > 25:
            warns.append("PDF > 25MB (GitHub web không cho upload): " + rel(p))
    elif ext in NEED_PDF:
        warns.append("BỎ QUA (cần Save as PDF trước): " + rel(p))

for p in walk(IMGS):
    ext = os.path.splitext(p)[1].lower()
    if ext in IMG_EXT:
        size = os.path.getsize(p) / 1048576
        imgs.append({
            "title": pretty(os.path.basename(p)), "project": project_of(IMGS, p),
            "file": rel(p), "desc": read_desc(p),
        })
        if size > 3:
            warns.append("Ảnh %.1fMB, nên nén xuống <2MB cho web nhanh: %s" % (size, rel(p)))

if os.path.isfile(VIDS):
    with open(VIDS, encoding="utf-8-sig") as f:
        for n, line in enumerate(f, 1):
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            parts = [x.strip() for x in line.split("|")]
            vid = yt_id(parts[0])
            if not vid:
                warns.append("videos.txt dòng %d: không nhận ra link/ID YouTube" % n)
                continue
            vids.append({
                "id": vid,
                "title": parts[1] if len(parts) > 1 and parts[1] else "Video " + vid,
                "project": parts[2] if len(parts) > 2 and parts[2] else "Chung",
                "desc": parts[3] if len(parts) > 3 else "",
            })

data = {
    "cap_nhat": datetime.date.today().isoformat(),
    "documents": docs, "images": imgs, "videos": vids,
}
os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, indent=2)

print("Đã tạo data/library.json: %d tài liệu, %d ảnh, %d video" % (len(docs), len(imgs), len(vids)))
for w in warns:
    print("  ! " + w)
