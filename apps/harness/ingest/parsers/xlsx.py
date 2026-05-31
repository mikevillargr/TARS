"""XLSX/XLS parser using openpyxl (xlsx) and xlrd (xls)."""
from __future__ import annotations
import io


def extract(content_bytes: bytes, filename: str = "") -> str:
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else "xlsx"

    if ext == "xls":
        return _extract_xls(content_bytes)
    return _extract_xlsx(content_bytes)


def _extract_xlsx(content_bytes: bytes) -> str:
    try:
        import openpyxl
    except ImportError:
        return "[XLSX parser unavailable — install openpyxl]"

    wb = openpyxl.load_workbook(io.BytesIO(content_bytes), read_only=True, data_only=True)
    sheets = []
    for sheet in wb.worksheets:
        rows = []
        for row in sheet.iter_rows(values_only=True):
            cells = [str(c) if c is not None else "" for c in row]
            if any(c.strip() for c in cells):
                rows.append(" | ".join(cells))
        if rows:
            sheets.append(f"## {sheet.title}\n" + "\n".join(rows))
    wb.close()
    return "\n\n".join(sheets)


def _extract_xls(content_bytes: bytes) -> str:
    try:
        import xlrd
    except ImportError:
        return "[XLS parser unavailable — install xlrd]"

    wb = xlrd.open_workbook(file_contents=content_bytes)
    sheets = []
    for sheet in wb.sheets():
        rows = []
        for rx in range(sheet.nrows):
            cells = [str(sheet.cell_value(rx, cx)) for cx in range(sheet.ncols)]
            if any(c.strip() for c in cells):
                rows.append(" | ".join(cells))
        if rows:
            sheets.append(f"## {sheet.name}\n" + "\n".join(rows))
    return "\n\n".join(sheets)
