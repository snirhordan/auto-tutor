#!/usr/bin/env python3
"""Download + extract the real Ministry of Education corpus for AutoTutor.

1. Past bagrut exams: meyda.education.gov.il/sheeloney_bagrut/{year}/{season}/HEB/{code}.pdf
   codes 35581/35582 (5-unit she'elonim), seasons 1 (winter) / 8 (summer).
2. Syllabus/curriculum PDFs: any PDF placed in data/ministry/syllabus/ is extracted too
   (drop files from pop.education.gov.il there); a few known URLs are attempted.

Outputs:
  data/ministry/pdfs/       downloaded PDFs
  data/ministry/extracted/  one .txt per PDF (page-marked)
  data/ministry/manifest.json  {file, kind, year, season, code, pages, chars, scanned_pages}

Scanned pages (no extractable text) are counted and skipped — no OCR.
Usage: python3 scripts/extract_pdfs.py
"""
import json
import os
import sys
import urllib.request

import fitz  # PyMuPDF

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
PDF_DIR = os.path.join(ROOT, "data/ministry/pdfs")
OUT_DIR = os.path.join(ROOT, "data/ministry/extracted")
SYL_DIR = os.path.join(ROOT, "data/ministry/syllabus")
MANIFEST = os.path.join(ROOT, "data/ministry/manifest.json")

EXAM_URL = "https://meyda.education.gov.il/sheeloney_bagrut/{year}/{season}/HEB/{code}.pdf"
YEARS = [2021, 2022, 2023, 2024, 2025]
SEASONS = [1, 8]  # winter, summer
CODES = [35581, 35582]

# Real 5-unit curriculum documents (links scraped from
# pop.education.gov.il/tchumey_daat/matmatika/chativa-elyona/teaching-mathematics/new-curriculum/).
SYLLABUS_URLS = [
    # 5u curriculum by grade (10th/11th/12th)
    "https://meyda.education.gov.il/files/Mazkirut_Pedagogit/matematika/yod5.pdf",
    "https://meyda.education.gov.il/files/Mazkirut_Pedagogit/matematika/yodalef5.pdf",
    "https://meyda.education.gov.il/files/Mazkirut_Pedagogit/matematika/yodbet5.pdf",
    # New-curriculum master document
    "https://meyda.education.gov.il/files/Pop/0files/matmatika/Chativa-Elyona/new-curriculum/newcurriculum.pdf",
    # 5u teaching recommendations + exam structure/points + 5u pacing
    "https://meyda.education.gov.il/files/Pop/0files/matmatika/Chativa-Elyona/tashpav/Teaching-Recommendations-5units-tashpav.pdf",
    "https://meyda.education.gov.il/files/Pop/0files/matmatika/Chativa-Elyona/tashpav/subjects-tashpav.pdf",
    "https://meyda.education.gov.il/files/Pop/0files/matmatika/Chativa-Elyona/tashpav/strucure-points-time-tashpav.pdf",
    "https://meyda.education.gov.il/files/Pop/0files/matmatika/Chativa-Elyona/tashpah/prisa5tashpah.pdf",
    # 5u formula sheet + vectors teaching subject
    "https://meyda.education.gov.il/files/Pop/0files/matmatika/Chativa-Elyona/new-curriculum/5-MATH-Formula_NEW.pdf",
    "https://meyda.education.gov.il/files/Pop/0files/matmatika/Chativa-Elyona/new-curriculum/vector-subject.pdf",
]

UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) auto-tutor course project"}


def download(url: str, dest: str) -> bool:
    if os.path.exists(dest) and os.path.getsize(dest) > 0:
        return True
    try:
        req = urllib.request.Request(url, headers=UA)
        with urllib.request.urlopen(req, timeout=30) as r, open(dest, "wb") as f:
            f.write(r.read())
        return True
    except Exception as e:  # noqa: BLE001
        print(f"  MISS {url} ({type(e).__name__})")
        if os.path.exists(dest):
            os.remove(dest)
        return False


def rtl_page_text(page) -> str:
    """RTL-aware text reconstruction.

    PyMuPDF returns Hebrew in VISUAL order (word-scrambled lines). Rebuild lines
    from word boxes: group words by (block, line), order lines top-to-bottom,
    and order words right-to-left within each line. Math formulas typeset as
    positioned glyphs remain fragmentary — scripts/parse-exams.ts (ExamParser,
    LLM strict-JSON) reconstructs those; this stage fixes the prose.
    """
    words = page.get_text("words")  # (x0, y0, x1, y1, word, block, line, wordno)
    lines: dict = {}
    for w in words:
        lines.setdefault((w[5], w[6]), []).append(w)
    ordered = sorted(lines.values(), key=lambda ws: (ws[0][5], min(w[1] for w in ws)))
    out = []
    for ws in ordered:
        ws = sorted(ws, key=lambda w: -w[0])  # right-to-left
        out.append(" ".join(w[4] for w in ws))
    return "\n".join(out).strip()


def extract(pdf_path: str, out_path: str) -> dict:
    doc = fitz.open(pdf_path)
    parts, scanned = [], 0
    for i, page in enumerate(doc):
        text = rtl_page_text(page)
        if len(text) < 30:  # likely a scanned page
            scanned += 1
            continue
        parts.append(f"--- page {i + 1} ---\n{text}")
    full = "\n\n".join(parts)
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(full)
    meta = {"pages": len(doc), "scanned_pages": scanned, "chars": len(full)}
    doc.close()
    return meta


def main() -> None:
    os.makedirs(PDF_DIR, exist_ok=True)
    os.makedirs(OUT_DIR, exist_ok=True)
    os.makedirs(SYL_DIR, exist_ok=True)
    manifest = []

    print("== past exams ==")
    for year in YEARS:
        for season in SEASONS:
            for code in CODES:
                name = f"exam_{code}_{year}_s{season}"
                dest = os.path.join(PDF_DIR, name + ".pdf")
                url = EXAM_URL.format(year=year, season=season, code=code)
                if not download(url, dest):
                    continue
                meta = extract(dest, os.path.join(OUT_DIR, name + ".txt"))
                manifest.append({
                    "file": name, "kind": "exam", "year": year,
                    "season": season, "code": code, **meta,
                })
                print(f"  OK  {name}: {meta['chars']} chars, {meta['scanned_pages']} scanned pages skipped")

    print("== syllabus ==")
    for url in SYLLABUS_URLS:
        name = "syl_" + os.path.basename(url).replace(".pdf", "")
        dest = os.path.join(SYL_DIR, name + ".pdf")
        if download(url, dest):
            meta = extract(dest, os.path.join(OUT_DIR, name + ".txt"))
            manifest.append({"file": name, "kind": "syllabus", **meta})
            print(f"  OK  {name}: {meta['chars']} chars")
    # Any manually-dropped syllabus PDFs
    for f in sorted(os.listdir(SYL_DIR)):
        if not f.endswith(".pdf"):
            continue
        name = f[:-4]
        if any(m["file"] == name for m in manifest):
            continue
        meta = extract(os.path.join(SYL_DIR, f), os.path.join(OUT_DIR, name + ".txt"))
        manifest.append({"file": name, "kind": "syllabus", **meta})
        print(f"  OK  {name} (manual): {meta['chars']} chars")

    with open(MANIFEST, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
    exams = [m for m in manifest if m["kind"] == "exam"]
    print(f"\nmanifest: {len(exams)} exams, {len(manifest) - len(exams)} syllabus docs -> {MANIFEST}")
    if not exams:
        sys.exit("ERROR: no exam PDFs downloaded — check network")


if __name__ == "__main__":
    main()
