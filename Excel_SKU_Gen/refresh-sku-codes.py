# -*- coding: utf-8 -*-
"""Rewrite the lookup tables in src/sku.js from "SKU Generator.xlsx".

    pip install openpyxl
    python Excel_SKU_Gen/refresh-sku-codes.py

Run it whenever a brand, cover or colour is added to the workbook. It
replaces only the rows between the <BRANDS>/<TYPES>/<COLOURS> markers in
src/sku.js and leaves everything else — the formula, the comments, the
legacy "Silicone MagSafe" row — exactly as it is. There is no template
to keep in step, because the file being edited is the only copy.

Then run `npm run check`: every worked row in the workbook is asserted
against buildSku(), so a code that moves is caught here rather than at
the factory.

Two rules the sheet follows and so does this:

  * a name repeated in the table keeps its FIRST short form, because
    XLOOKUP returns the first match ("Shining Yellow" is in there twice,
    as SHN-YLW and SHY-YLW, and the sheet has always meant SHN-YLW);
  * the sheet has no order quantity, so only the covers the app already
    booked a quantity for keep one. Everything else books 0 and the
    buyer has to say — a guessed default ends up on a purchase order.
"""

import io
import json
import os
import re
import sys

try:
    from openpyxl import load_workbook
except ImportError:
    sys.exit("openpyxl is not installed — run: pip install openpyxl")

HERE = os.path.dirname(os.path.abspath(__file__))
BOOK = os.path.join(HERE, "SKU Generator.xlsx")
TARGET = os.path.join(HERE, os.pardir, "src", "sku.js")

# The app's own column, not the sheet's. Add to it when a cover gets a
# settled order quantity; anything missing books 0.
QUANTITIES = {
    "TPU+PC": 50,
    "Silicone Cover": 30,
    "TPU+PC+MSF": 50,
}


def read_table(ws):
    """Column A is the variant, B the long name, C the short form."""
    groups = {}
    for row in range(2, ws.max_row + 1):
        variant, name, code = (ws.cell(row, col).value for col in (1, 2, 3))
        if not name:
            continue
        groups.setdefault((variant or "").strip(), []).append(
            (str(name).strip(), "" if code is None else str(code).strip())
        )
    return groups


def first_wins(pairs):
    seen, out = set(), []
    for name, code in pairs:
        key = name.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append((name, code))
    return out


def render(pairs, with_quantity=False):
    width = max(len(json.dumps(n, ensure_ascii=False)) for n, _ in pairs) + 1
    lines = []
    for name, code in pairs:
        jn = json.dumps(name, ensure_ascii=False) + ","
        jc = json.dumps(code, ensure_ascii=False)
        if with_quantity:
            lines.append("  [%-*s %-22s %d]," % (width, jn, jc + ",", QUANTITIES.get(name, 0)))
        else:
            lines.append("  [%-*s %s]," % (width, jn, jc))
    return "\n".join(lines) + "\n"


def splice(source, tag, body):
    pattern = re.compile(
        r"(  /\* <%s> \*/\n).*?(  /\* </%s> \*/\n)" % (tag, tag), re.S
    )
    replaced, count = pattern.subn(lambda m: m.group(1) + body + m.group(2), source)
    if count != 1:
        sys.exit("found %d <%s> blocks in src/sku.js, expected exactly 1" % (count, tag))
    return replaced


def main():
    groups = read_table(load_workbook(BOOK, data_only=True)["SKU Generation"])
    brands = first_wins(
        groups.get("Product Brand", [])
        + groups.get("Parent Brand", [])
        + groups.get("Child Brand", [])
    )
    types = first_wins(groups.get("Product Type", []))
    colours = first_wins(groups.get("Product Colour", []))

    source = io.open(TARGET, encoding="utf-8").read()
    source = splice(source, "BRANDS", render(brands))
    source = splice(source, "TYPES", render(types, with_quantity=True))
    source = splice(source, "COLOURS", render(colours))
    io.open(TARGET, "w", encoding="utf-8", newline="\n").write(source)

    print("src/sku.js: %d brands, %d covers, %d colours" % (len(brands), len(types), len(colours)))
    print("now run: npm run check")


if __name__ == "__main__":
    main()
