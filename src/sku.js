/* ── SKU CODES ───────────────────────────────────────────────────
   The rules from Excel_SKU_Gen/SKU Generator.xlsx, which is where
   these codes were kept until now. The sheet's formula is

     IF(Product Brand = "Sprig",
        TEXTJOIN("-", TRUE, parent, child, MODEL, type, colour),
        TEXTJOIN("-", TRUE, brand, parent, child, MODEL, type, colour))

   over one lookup table of "long name → short form". The IF is
   belt-and-braces: Sprig's own short form is blank, and TEXTJOIN
   with TRUE drops blanks, so the house brand contributes nothing
   either way. buildSku() below is that formula.

   Two things the sheet does that are worth naming, because they
   are not obvious from the formula:

   · MODEL is NOT looked up. It is typed already shortened — DUO,
     18-PRO, Z-FOLD-8-ULTRA, FND-X10-PMAX. Nobody can derive
     "FND-X10-PMAX" from "Find X10 Pro Max", so the generator
     suggests a code and lets the buyer correct it.
   · A name repeated in the table keeps its FIRST code, because
     XLOOKUP returns the first match. "Shining Yellow" appears
     twice, as SHN-YLW and SHY-YLW; the sheet has always used
     SHN-YLW, and dropping the duplicate here keeps it that way.

   THIS FILE IS GENERATED from the workbook. Re-run the generator
   rather than hand-editing a code, or the app and the sheet drift.
   ─────────────────────────────────────────────────────────────── */

/* Column L of the sheet is =LEN(K), headed "Max Length 40 Char SKU
   only". It is a warning, not a limit — the sheet itself ships
   44-character codes — so the app flags and never truncates. */
export const SKU_MAX = 40;

/* Brand → short form. Product, parent and child brands share one
   table in the sheet and one lookup here, because a model carries
   a single brand: "Redmi" resolves on its own, without having to
   know it sits under Xiaomi. Sprig is the house brand and adds
   nothing to the code. */
export const BRAND_CODES = [
  /* <BRANDS> */
  ["Sprig",          ""],
  ["Motorola Brand", "MT-MOTO"],
  ["Slayit",         "SYT"],
  ["iPhone",         "IPHN"],
  ["Samsung",        "SM"],
  ["Oppo",           "OPPO"],
  ["Xiaomi",         "MI"],
  ["Nokia",          "NKA"],
  ["LG",             "LG"],
  ["POCO",           "POCO"],
  ["Nothing",        "NTHN"],
  ["Google",         "GGL-PXL"],
  ["Oneplus",        "OPLUS"],
  ["Huawei",         "HWI"],
  ["Motorola",       "MOTO"],
  ["Realme",         "RM"],
  ["Vivo",           "VIVO"],
  ["IQOO",           "IQ"],
  ["Infinix",        "INF"],
  ["Redmi",          "RMI"],
  ["Honor",          "HNR"],
  /* </BRANDS> */
];

/* Cover type → short form, with the quantity normally ordered.
   The quantity is the app's, not the sheet's — the sheet has no
   such column — so only the types that already carried one have
   one. 0 means "nobody has said", and the generator asks. */
export const COVER_TYPES = [
  /* <TYPES> */
  ["Full Cover",                  "SS-B",                0],
  ["Clear",                       "TS",                  0],
  ["Clear Arrow Applicator",      "TS-AAP",              0],
  ["Full Cover Arrow Applicator", "SS-B-AAP",            0],
  ["TPU Cover",                   "TPU-CVR",             0],
  ["Silicone Cover",              "SLC-CVR",             30],
  ["Magsafe Silicone Cover",      "SLC-CVR-MSF",         0],
  ["TPU+PC+MSF",                  "TPU-PC-CVR-MSF-MT",   50],
  ["Matt Cover",                  "MT-CVR",              0],
  ["Hot Bending Edge Glue Black", "HB-EG-B",             0],
  ["Hot Bending Full Glue Black", "HB-FG-B",             0],
  ["AntiSpy Black",               "AS-B",                0],
  ["AntiSpy White",               "AS-W",                0],
  ["Camera Hole Full Cover",      "CH-SS-B",             0],
  ["Camera Hole Clear",           "CH-TS",               0],
  ["Armor Case Plain",            "ARMOR-PLN-CVR",       0],
  ["Armor Case with Stand",       "ARMOR-STD-CVR",       0],
  ["Armor Case with Clip",        "ARMOR-CLP-CVR",       0],
  ["Pure Leather",                "PU-LTHR",             0],
  ["Glossy Leather",              "GLS-LTHR",            0],
  ["Matte Leather",               "MT-LTHR",             0],
  ["Bayer TPU + PC",              "BYR-TPU-PC-CVR",      0],
  ["TPU+PC",                      "TPU-PC-CVR-MT",       50],
  ["TPEE",                        "TPEE-ING-CVR",        0],
  ["Translucent Cover",           "TLST-CVR",            0],
  ["Translucent Cover MSF",       "TLST-MSF-CVR",        0],
  ["Clear Magsafe",               "TPU-CVR-MSF",         0],
  ["PC+ANTI-YLW Magsafe",         "PC-AY-MSF-CVR",       0],
  ["TPU Scarch Guard Clear",      "TPU-TS",              0],
  ["TPU Scarch Guard Matte",      "TPU-MT-TS",           0],
  ["Anti Yellow Magsafe",         "PC-AY-MSF",           0],
  ["TPU Fabric",                  "TPU-FBR-CVR",         0],
  /* </TYPES> */
  /* Not in the sheet. The app ordered under this name before the
     sheet arrived, and dropping it would make existing SKU rows
     invisible to the STP matrix, which groups by material and
     shows only names it knows (AUD-013). Same cover as "Magsafe
     Silicone Cover", same code. */
  ["Silicone MagSafe",            "SLC-CVR-MSF",          30],
];

/* Colour → short form. */
export const COLOUR_CODES = [
  /* <COLOURS> */
  ["Black",                    "BLK"],
  ["Gray",                     "GRY"],
  ["Charcoal Gray",            "CO-GRY"],
  ["Red",                      "RED"],
  ["Blue",                     "BLU"],
  ["Pink",                     "PNK"],
  ["Denim Blue",               "DM-BLU"],
  ["Cobalt Blue",              "CB-BLU"],
  ["Green Yellow",             "GRN-YLW"],
  ["Shining Yellow",           "SHN-YLW"],
  ["Light Yellow",             "LT-YLW"],
  ["Navy Blue",                "NY-BLU"],
  ["Lavender Purple",          "LV-PRPL"],
  ["Lavender Gray",            "LV-GRY"],
  ["Midnight Blue",            "MD-BLU"],
  ["Green",                    "GRN"],
  ["Dark Green",               "DK-GRN"],
  ["Mint Green",               "MT-GRN"],
  ["Miracle",                  "MRCL"],
  ["Bayer",                    "BYR"],
  ["Dark Purple",              "DK-PRPL"],
  ["Deep Olive - Olive Green", "OLI-GRN"],
  ["Rose Red",                 "RO-RED"],
  ["Apricot Orange",           "APR-ORG"],
  ["Lilac",                    "LILAC"],
  ["Orange",                   "ORG"],
  ["Emerald Green",            "EMR-GRN"],
  ["Cranberry",                "CNB"],
  ["Gold",                     "GLD"],
  ["Sanddle Brown",            "SAN-BRW"],
  ["Light Red",                "LT-RED"],
  ["Fruit Blue",               "FRU-BLU"],
  ["Pebble Gray",              "PEB-GRY"],
  ["Blue Gray",                "BLU-GRY"],
  ["Light Gray",               "LT-GRY"],
  ["Orange Red",               "ORG-RED"],
  ["Spearmint",                "SPE-MIN"],
  ["Pomegranate Red",          "POM-RED"],
  ["White",                    "WHT"],
  ["Sky Blue",                 "SY-BLU"],
  ["Light Blue",               "LT-BLU"],
  ["Rose Pink",                "RO-PNK"],
  ["Purple",                   "PRPL"],
  ["Violet",                   "VLT"],
  ["Transparent",              "TRNS"],
  ["Antique White",            "AQ-WHT"],
  ["Light Purple",             "LT-PRPL"],
  ["Light Green",              "LT-GRN"],
  ["Clear+Dark Green",         "CLR-DK-GRN"],
  ["Clear+Milk Grey",          "CLR-MK-GRY"],
  ["Clear+Navy Blue",          "CLR-NY-BLU"],
  ["Clear+Black",              "CLR-BLK"],
  ["Grey Back + Black Edges",  "GRY-BLK"],
  ["Pine Green",               "PN-GRN"],
  ["Elegant Purple",           "EG-PRPL"],
  ["Black Transparent",        "BLK-TRNS"],
  ["Dark Brown",               "DK-BRN"],
  ["Ocean Blue",               "OCN-BLU"],
  ["Light Brown",              "LT-BRN"],
  ["Lemon Yellow",             "LMN-YLW"],
  ["Turquoise Blue",           "TQ-BLU"],
  ["Dark Grey",                "DK-GRY"],
  ["Pastel Green",             "PST-GRN"],
  ["Charcoal Grey",            "COAL-GRAY"],
  ["Pastel Light Blue",        "PST-LT-BLU"],
  ["Dark Violet",              "DK-VLT"],
  ["Forest Green",             "FOR-GRN"],
  ["Golden Brown",             "GLD-BRN"],
  ["Light Orange",             "LT-ORG"],
  ["Light Grey",               "LT-GRY"],
  ["Blackish Green",           "BKS-GRN"],
  ["Cherry Red",               "CHY-RED"],
  ["Wine Red",                 "WN-RED"],
  ["Dark Blue",                "DK-BLU"],
  ["Brown",                    "BRW"],
  ["White Transparent",        "WHT-TRNS"],
  ["Dark Blue Transparent",    "DRK-BLU-TRNS"],
  ["Dark purple Transparent",  "DK-PRPL-TRNS"],
  ["Navy Blue Transparent",    "NY-BLU-TRNS"],
  ["Peak Blue",                "PEK-BLU"],
  /* </COLOURS> */
];

const lookup = (table) => {
  const map = new Map();
  table.forEach((row) => map.set(row[0].trim().toLowerCase(), row[1]));
  return (name) => map.get(String(name ?? "").trim().toLowerCase()) ?? null;
};

export const brandCode  = lookup(BRAND_CODES);
export const typeCode   = lookup(COVER_TYPES);
export const colourCode = lookup(COLOUR_CODES);

export const COVER_TYPE_NAMES = COVER_TYPES.map((r) => r[0]);
export const COLOUR_NAMES     = COLOUR_CODES.map((r) => r[0]);
export const defaultQtyForType = (name) =>
  COVER_TYPES.find((r) => r[0].toLowerCase() === String(name ?? "").trim().toLowerCase())?.[2] ?? 0;

/* The sheet's model column: typed, already short. This is only ever
   a suggestion — "Find X10 Pro Max" becomes FIND-X10-PRO-MAX here
   and FND-X10-PMAX in the sheet, and only a person knows which the
   supplier is expecting. Anything that is not a letter or a digit
   becomes the one separator the format uses. */
export function modelCodeFor(name) {
  return String(name ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/* The sheet's formula. Every part that resolves to nothing is
   dropped, exactly as TEXTJOIN(..., TRUE, ...) drops it.

   Returns the code and what went into it, because a brand or a
   colour the table has never heard of resolves to nothing and
   silently shortens the code — the caller has to be able to say
   so rather than hand over a SKU that is quietly wrong. */
export function buildSku({ brand, modelCode, type, colour }) {
  const parts = [
    { what: "brand",  value: brand,  code: brand  == null || brand  === "" ? "" : brandCode(brand)  },
    { what: "model",  value: modelCode, code: modelCode ? modelCodeFor(modelCode) : null },
    { what: "type",   value: type,   code: type   == null || type   === "" ? "" : typeCode(type)   },
    { what: "colour", value: colour, code: colour == null || colour === "" ? "" : colourCode(colour) },
  ];
  const unknown = parts.filter((p) => p.code === null).map((p) => p.what);
  const sku = parts.map((p) => p.code).filter(Boolean).join("-");
  return { sku, unknown, tooLong: sku.length > SKU_MAX, length: sku.length };
}
