import type { PoExtractRequest, PoExtractResult } from "@shared/schema";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

// Heuristic Purchase Order field extractor.
//
// Two paths are supported:
//   • text/* and application/json / csv — decoded directly.
//   • application/pdf — parsed via pdfjs-dist (CID-aware) so client POs that use
//     Identity-H / Type0 fonts (e.g. Forteco / van der Knaap PDFs) yield real
//     text instead of a garbled latin-1 stream. We also keep a low-cost
//     parenthesis fallback for unusual PDFs where pdfjs cannot open the file.
//
// The result is advisory — the create-RFQ form lets the user edit / confirm
// fields before the RFQ is created. We never call out to a paid LLM API.

const TEXTUAL_MIME_PREFIXES = ["text/", "application/json", "application/xml"];

const COUNTRY_HINTS: Record<string, string> = {
  // Map common ISO-2/3 codes seen on PO addresses to a friendly country name.
  US: "United States",
  USA: "United States",
  UK: "United Kingdom",
  GB: "United Kingdom",
  DE: "Germany",
  NL: "Netherlands",
  FR: "France",
  IT: "Italy",
  ES: "Spain",
  CA: "Canada",
  AU: "Australia",
  IE: "Ireland",
  IN: "India",
  LK: "Sri Lanka",
  ID: "Indonesia",
  JP: "Japan",
  CN: "China",
};

// Recognise these country names verbatim anywhere in the document. Order
// matters for the longest-match preference (see detectCountry).
const KNOWN_COUNTRIES = [
  "The Netherlands",
  "United States",
  "United Kingdom",
  "United Arab Emirates",
  "Saudi Arabia",
  "South Africa",
  "New Zealand",
  "Sri Lanka",
  "Germany",
  "Netherlands",
  "France",
  "Italy",
  "Spain",
  "Canada",
  "Australia",
  "Ireland",
  "India",
  "Indonesia",
  "Japan",
  "China",
  "Belgium",
  "Switzerland",
  "Sweden",
  "Norway",
  "Denmark",
  "Finland",
  "Poland",
  "Portugal",
  "Greece",
  "Turkey",
  "Singapore",
  "Malaysia",
  "Vietnam",
  "Thailand",
  "Brazil",
  "Mexico",
  "Argentina",
  "Chile",
];

// Known TEG (this is us) supplier / receiving entities. When a PO names one of
// these in an "Order to:" / "Sold to:" / "Vendor:" block we treat it as the
// receiver, NOT the partner/client. If the user uploads our own copy of a PO
// these names should never end up in the partnerClient field.
const TEG_RECEIVER_NAMES = [
  "Euro Substrates",
  "Tropicoir",
  "Premier Tech",
  "Growrite",
];

// Headings/labels that indicate we are reading the issuer (partner/client) of
// the PO and should capture the next non-empty line as the company name.
// Note: "Purchaser" intentionally excluded — most POs use that label for the
// individual buyer's name (a person), not the company. "Customer" is also
// excluded because on POs it typically labels the END customer of the
// purchaser, not the issuing company.
const ISSUER_LABELS = [
  "Bill from",
  "Issued by",
  "Issuing entity",
  "PO Issuer",
  "Buyer Company",
  "Buyer",
  "From",
  "Partner",
  "Client",
];

const RECEIVER_LABELS = [
  "Order to",
  "Order To",
  "Sold to",
  "Vendor",
  "Supplier",
  "Bill to vendor",
];

const CUSTOMER_LABELS = [
  "PO Customer",
  "End Customer",
  "Customer Name",
  "Customer",
  "Ship to",
  "Ship-to",
  "Deliver to",
  "Deliver-to",
  "Consignee",
  "Sold to",
];

const PALLET_LABELS = ["Palletlabel", "Pallet label", "Pallet Label"];

function decodeBase64ToBuffer(b64: string): Buffer {
  const idx = b64.indexOf(",");
  const payload = b64.startsWith("data:") && idx >= 0 ? b64.slice(idx + 1) : b64;
  return Buffer.from(payload, "base64");
}

// Order text items into reading order: rows by Y, columns by X within a row.
// pdfjs returns items with a `transform` (a 6-element matrix where [4]=x,[5]=y).
type PdfItem = { str: string; transform: number[] };

function itemsToLines(items: PdfItem[]): string[] {
  const sorted = items
    .filter((it) => it.str !== undefined)
    .sort((a, b) => {
      const ay = a.transform[5];
      const by = b.transform[5];
      if (Math.abs(ay - by) > 2) return by - ay;
      return a.transform[4] - b.transform[4];
    });
  const lines: string[] = [];
  let row: string[] = [];
  let lastY: number | null = null;
  for (const it of sorted) {
    const y = it.transform[5];
    if (lastY === null || Math.abs(y - lastY) > 2) {
      if (row.length) lines.push(row.join(" ").replace(/\s+/g, " ").trim());
      row = [];
      lastY = y;
    }
    if (it.str) row.push(it.str);
  }
  if (row.length) lines.push(row.join(" ").replace(/\s+/g, " ").trim());
  return lines.filter((l) => l.length > 0);
}

async function pdfBufferToText(buf: Buffer): Promise<string> {
  try {
    const data = new Uint8Array(buf);
    const doc = await getDocument({
      data,
      useSystemFonts: false,
      disableFontFace: true,
      isEvalSupported: false,
    }).promise;
    const allLines: string[] = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      const items = content.items.filter((i: any) => "str" in i) as PdfItem[];
      const lines = itemsToLines(items);
      allLines.push(...lines);
    }
    try {
      await doc.cleanup();
    } catch {}
    return allLines.join("\n");
  } catch {
    // Fallback: best-effort parenthesis scan. Works on simple PDFs that don't
    // use CID fonts. Returns plenty of noise for image-only PDFs which the
    // caller filters via the meaningful-character check.
    const raw = buf.toString("latin1");
    const out: string[] = [];
    const re = /\(((?:\\.|[^\\()])*)\)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(raw))) {
      const piece = m[1];
      if (!piece) continue;
      const decoded = piece
        .replace(/\\\(/g, "(")
        .replace(/\\\)/g, ")")
        .replace(/\\\\/g, "\\")
        .replace(/\\n/g, "\n")
        .replace(/\\r/g, "\r")
        .replace(/\\t/g, "\t");
      if (decoded.trim().length > 0) out.push(decoded);
    }
    return out.join(" ");
  }
}

async function decodeText(req: PoExtractRequest): Promise<{ text: string; textExtractionFailed: boolean }> {
  const buf = decodeBase64ToBuffer(req.contentBase64);
  if (buf.length === 0) {
    return { text: "", textExtractionFailed: true };
  }
  const mime = (req.mimeType ?? "").toLowerCase();
  const filename = (req.filename ?? "").toLowerCase();
  const looksTextual =
    TEXTUAL_MIME_PREFIXES.some((p) => mime.startsWith(p)) ||
    mime.includes("csv") ||
    filename.endsWith(".txt") ||
    filename.endsWith(".csv") ||
    filename.endsWith(".md") ||
    filename.endsWith(".json");
  if (looksTextual) {
    const text = buf.toString("utf8");
    return { text, textExtractionFailed: text.trim().length === 0 };
  }
  if (mime === "application/pdf" || filename.endsWith(".pdf")) {
    const text = await pdfBufferToText(buf);
    const stripped = text.replace(/\s+/g, " ").trim();
    const meaningful = stripped.replace(/[^A-Za-z]/g, "").length;
    if (meaningful < 20) {
      return { text: "", textExtractionFailed: true };
    }
    return { text, textExtractionFailed: false };
  }
  return { text: "", textExtractionFailed: true };
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function cleanCompanyName(value: string): string {
  let v = value.replace(/^\s*[\-:]+\s*/, "").replace(/\s{2,}/g, " ").trim();
  // Strip trailing whitespace/comma/semicolon. Preserve a final period when it
  // belongs to a corporate-suffix abbreviation like "B.V." or "Ltd.".
  v = v.replace(/[\s,;]+$/g, "");
  if (/\.$/.test(v) && !/\b(B\.V\.|N\.V\.|S\.A\.|Ltd\.|Inc\.|Corp\.|Co\.|Pty\.|Pte\.)$/i.test(v)) {
    v = v.replace(/\.+$/g, "");
  }
  return v.slice(0, 200);
}

// Returns the inline value found after a label on the same line, plus any
// candidate values found on the next 1-3 non-empty lines (useful when the
// label is a section heading like "Order to:" with the address below).
// Accepts both "Label: value" and CSV-style "Label,value" forms so a simple
// CSV upload like Field,Value rows still extracts cleanly.
function findLabelBlock(
  lines: string[],
  labels: string[],
): { inline: string | null; following: string[]; matchedLabel: string | null; index: number } | null {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const label of labels) {
      const re = new RegExp(`(?:^|\\b)${escapeRe(label)}\\s*[:,\\-]\\s*(.*)$`, "i");
      const m = re.exec(line);
      if (m) {
        const inlineRaw = m[1].trim();
        const following: string[] = [];
        for (let j = i + 1; j < Math.min(lines.length, i + 6) && following.length < 3; j++) {
          const next = lines[j].trim();
          if (!next) continue;
          // Stop at obvious next-section heading.
          if (/^(Article|Description|Total|Order to|Delivery to|Ship to|Bill to|Sold to|Vendor|Supplier|Reference|Purchaser|Date of|Terms|Payment)\b[:\-\s]/i.test(next)) {
            // If we've gathered at least one line, stop. Otherwise keep going past
            // a label-only line with no inline value.
            if (following.length > 0) break;
            continue;
          }
          following.push(next);
        }
        return { inline: inlineRaw || null, following, matchedLabel: label, index: i };
      }
    }
  }
  return null;
}

function detectCountry(lines: string[], partnerBlockText: string | null): string | null {
  // 1) If we have a partner block, prefer a country detected in that block.
  if (partnerBlockText) {
    const fromPartner = matchKnownCountry(partnerBlockText);
    if (fromPartner) return fromPartner;
  }
  // 2) Explicit Country / Country of destination / Ship-to country labels.
  //    NOTE: do NOT match "Country of Origin" — that's the manufacturing origin,
  //    which is meaningless for partner country.
  for (const line of lines) {
    const m = /\bCountry(?:\s+of\s+(?!origin)\w+)?\s*[:\-]\s*([^\n]+)/i.exec(line);
    if (m && m[1]) {
      const candidate = m[1].trim().replace(/[\s,;.]+$/g, "");
      const upper = candidate.toUpperCase();
      if (/^[A-Z]{2,3}$/.test(upper) && COUNTRY_HINTS[upper]) return COUNTRY_HINTS[upper];
      const known = matchKnownCountry(candidate);
      if (known) return known;
      if (candidate.length > 1 && candidate.length < 60) return candidate;
    }
  }
  // 3) Search for any known country name anywhere in the doc — but skip the
  //    one immediately following "Country of Origin:".
  const fullText = lines.join("\n");
  const sanitised = fullText.replace(/Country\s+of\s+Origin\s*[:\-]\s*[^\n]+/gi, " ");
  return matchKnownCountry(sanitised);
}

function matchKnownCountry(text: string): string | null {
  for (const name of KNOWN_COUNTRIES) {
    const re = new RegExp(`\\b${name.replace(/ /g, "\\s+")}\\b`, "i");
    if (re.test(text)) {
      // Normalise "The Netherlands" -> "Netherlands" for downstream matching
      // unless the document literally uses the article form on its own line.
      return name === "The Netherlands" ? "Netherlands" : name;
    }
  }
  return null;
}

function looksLikeReceiverName(value: string): boolean {
  const lc = value.toLowerCase();
  return TEG_RECEIVER_NAMES.some((n) => lc.includes(n.toLowerCase()));
}

function looksLikeAddressLine(value: string): boolean {
  // Numeric-prefixed street/postal codes, "Postbus 136", "10100 Pitakotte" etc.
  if (/^\d{2,5}\s/.test(value)) return true;
  if (/\b(Postbus|P\.?O\.? Box|Street|Straat|Road|Lane|Boulevard|Avenue)\b/i.test(value)) return true;
  if (/^\d{4}\s?[A-Z]{2}\s/.test(value)) return true; // Dutch postal code
  return false;
}

// Recognise companies that use a corporate suffix. Used as a tiebreaker when
// no labelled issuer is found — we look for the first such name in the doc
// and treat it as the partner/client.
const COMPANY_SUFFIXES = [
  "B.V.",
  "BV",
  "N.V.",
  "NV",
  "GmbH",
  "AG",
  "S.A.",
  "S.A",
  "S.A.S",
  "SARL",
  "Ltd",
  "Ltd.",
  "Limited",
  "LLC",
  "Inc",
  "Inc.",
  "Corp",
  "Corp.",
  "Co.",
  "Pty",
  "Pte",
  "Plc",
  "Oy",
  "AB",
  "ApS",
  "Sp. z o.o.",
  "S.r.l.",
  "Srl",
  "PVT Ltd",
];

function findCompanyByHeader(lines: string[]): { value: string; lineIndex: number; blockText: string } | null {
  // PURCHASE ORDER is usually the title; the issuer name is the line just
  // before/after it. We scan a window around the title for the first non-noise
  // line that contains a known company suffix and is NOT a TEG receiver.
  const titleIdx = lines.findIndex((l) => /^\s*PURCHASE\s+ORDER\b/i.test(l));
  if (titleIdx < 0) return null;
  const window: { line: string; idx: number }[] = [];
  for (let i = Math.max(0, titleIdx - 4); i <= Math.min(lines.length - 1, titleIdx + 6); i++) {
    if (i === titleIdx) continue;
    const line = lines[i].trim();
    if (!line) continue;
    if (looksLikeReceiverName(line)) continue;
    // Strip the trailing right-column label fragment first — PDFs often glue
    // the issuer name and the right-column field label onto the same row
    // (e.g. "Forteco B.V. Reference : 6829"). After stripping, skip rows that
    // are pure label rows.
    const stripped = stripTrailingLabel(line);
    if (!stripped) continue;
    if (/^(Reference|Purchaser|Date of|Terms|Payment|Order to|Delivery to|Article)\b/i.test(stripped)) continue;
    window.push({ line: stripped, idx: i });
  }
  for (const { line, idx } of window) {
    if (COMPANY_SUFFIXES.some((s) => new RegExp(`\\b${escapeRe(s)}(?=\\b|\\s|$)`, "i").test(line))) {
      // If the line itself begins with an issuer label like "Bill from:" or
      // "Issued by:", strip the label prefix so we keep just the company name.
      let cleanedLine = line;
      const labelPrefixRe = new RegExp(
        `^\\s*(?:${ISSUER_LABELS.map((l) => escapeRe(l)).join("|")})\\s*[:\\-]\\s*`,
        "i",
      );
      cleanedLine = cleanedLine.replace(labelPrefixRe, "");
      // Capture a small block (next 4 lines) for downstream country detection.
      // We use the ORIGINAL lines (before strip) so the country picker can see
      // address text in the right column too.
      const block: string[] = [cleanedLine];
      for (let j = idx + 1; j < Math.min(lines.length, idx + 6); j++) {
        const next = stripTrailingLabel(lines[j]).trim();
        if (!next) continue;
        if (/^(Order to|Delivery to|Article|Total)\b/i.test(next)) break;
        block.push(next);
      }
      return { value: cleanCompanyName(cleanedLine), lineIndex: idx, blockText: block.join("\n") };
    }
  }
  return null;
}

// Some POs are 2-column. After itemsToLines a row may look like:
//   "Forteco B.V. Reference   :   6829 *"
// We want only "Forteco B.V." Strip the trailing field label fragment.
function stripTrailingLabel(line: string): string {
  const labelStart = line.search(
    /\s+(Reference|Purchaser|Date of|Terms of|Payment Condition|PO Number|PO No|Order Number|Order No)\b/i,
  );
  if (labelStart > 0) return line.slice(0, labelStart).trim();
  return line.trim();
}

function detectPartner(lines: string[]): { value: string | null; matchedLabel: string | null; blockText: string | null; notes: string[] } {
  const notes: string[] = [];
  // 1) Branded header company (e.g. "Forteco B.V.") near PURCHASE ORDER. Most
  //    real client POs put the issuer name in the letterhead, not behind a
  //    "Bill from:" label, so we try this BEFORE label matching.
  const header = findCompanyByHeader(lines);
  if (header) {
    return {
      value: header.value,
      matchedLabel: "header:PURCHASE ORDER",
      blockText: header.blockText,
      notes: [...notes, "Inferred partner from PO header / branded company name."],
    };
  }
  // 2) Try explicit issuer labels (Bill from / Issued by / Buyer / etc.).
  const block = findLabelBlock(lines, ISSUER_LABELS);
  if (block) {
    const candidate = (block.inline && block.inline.length > 1 ? block.inline : block.following[0]) ?? null;
    if (candidate && !looksLikeReceiverName(candidate) && !looksLikeAddressLine(candidate)) {
      const blockText = [candidate, ...block.following].join("\n");
      return { value: cleanCompanyName(candidate), matchedLabel: block.matchedLabel, blockText, notes };
    }
    if (candidate && looksLikeReceiverName(candidate)) {
      notes.push(`Ignored receiver-like value '${candidate}' under '${block.matchedLabel}:' label.`);
    }
  }
  // 3) Fallback: first line that contains a known company suffix and is NOT a
  //    TEG receiver name.
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || looksLikeReceiverName(line)) continue;
    if (COMPANY_SUFFIXES.some((s) => new RegExp(`\\b${escapeRe(s)}(?=\\b|\\s|$)`, "i").test(line))) {
      return {
        value: cleanCompanyName(stripTrailingLabel(line)),
        matchedLabel: "fallback:company-suffix",
        blockText: lines.slice(i, Math.min(lines.length, i + 4)).join("\n"),
        notes: [...notes, "Partner inferred from first company-suffix line; verify before sending."],
      };
    }
  }
  return { value: null, matchedLabel: null, blockText: null, notes };
}

function detectCustomer(
  lines: string[],
  partnerName: string | null,
): { value: string | null; matchedLabel: string | null; notes: string[] } {
  const notes: string[] = [];
  // 1) Explicit customer labels first.
  const block = findLabelBlock(lines, CUSTOMER_LABELS);
  if (block) {
    const candidate = (block.inline && block.inline.length > 1 ? block.inline : block.following[0]) ?? null;
    if (candidate && (!partnerName || candidate !== partnerName)) {
      // Common false positive: "Delivery to: Transit" — Transit is just a
      // forwarder destination, not the end customer. Same for empty single-word
      // tokens. If the candidate is generic, fall through to Palletlabel.
      const lc = candidate.toLowerCase();
      if (lc !== "transit" && lc !== "tba" && lc !== "n/a" && candidate.length > 2) {
        return { value: cleanCompanyName(candidate), matchedLabel: block.matchedLabel, notes };
      }
      notes.push(`Ignored generic '${candidate}' under '${block.matchedLabel}:' label; checking Palletlabel.`);
    }
  }
  // 2) Palletlabel (used by Forteco-style POs to identify the end nursery).
  for (const line of lines) {
    for (const label of PALLET_LABELS) {
      const re = new RegExp(`${escapeRe(label)}\\s*[:\\-]\\s*([^\\n]+)`, "i");
      const m = re.exec(line);
      if (m && m[1] && m[1].trim().length > 1) {
        const value = cleanCompanyName(m[1]);
        return {
          value,
          matchedLabel: label,
          notes: [...notes, "PO Customer inferred from Palletlabel — confirm this is the end customer."],
        };
      }
    }
  }
  return { value: null, matchedLabel: null, notes };
}

export async function extractPoFields(req: PoExtractRequest): Promise<PoExtractResult> {
  const { text, textExtractionFailed } = await decodeText(req);

  if (textExtractionFailed || text.trim().length === 0) {
    return {
      partnerClient: null,
      poCountry: null,
      poCustomerName: null,
      confidence: "none",
      matchedLabels: [],
      notes: [
        "Could not extract text from this file. Image-only / scanned PDFs require an OCR integration which is not enabled in this preview.",
        "You can still create the RFQ \u2014 fill in Partner, Country, and PO Customer manually.",
      ],
      textExtractionFailed: true,
    };
  }

  const lines = text
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  // Header-based detection runs first because it's more reliable than the
  // label heuristics for branded POs (e.g. "Forteco B.V." near PURCHASE ORDER).
  // detectPartner handles fallback chain internally.
  const partner = detectPartner(lines);
  const customer = detectCustomer(lines, partner.value);
  const country = detectCountry(lines, partner.blockText);

  const matchedLabels: string[] = [];
  if (partner.matchedLabel) matchedLabels.push(`partner:${partner.matchedLabel}`);
  if (customer.matchedLabel) matchedLabels.push(`customer:${customer.matchedLabel}`);
  if (country) matchedLabels.push(`country:${country}`);

  let confidence: PoExtractResult["confidence"] = "none";
  const hits = [partner.value, country, customer.value].filter(Boolean).length;
  if (hits === 3) confidence = "high";
  else if (hits === 2) confidence = "medium";
  else if (hits === 1) confidence = "low";

  const notes: string[] = [...partner.notes, ...customer.notes];
  if (!partner.value) notes.push("Partner / Client could not be detected. Pick from the list or type it manually.");
  if (!country) notes.push("Country could not be detected. Confirm the partner's country before sending.");
  if (!customer.value) notes.push("PO Customer name could not be detected. Type it as it appears on the PO.");
  notes.push("Always review the extracted fields before creating the RFQ. Heuristic extraction is not perfect.");

  let resolvedPartner = partner.value ?? null;
  let resolvedCustomer = customer.value ?? null;
  if (resolvedPartner && resolvedCustomer && resolvedPartner === resolvedCustomer) {
    resolvedPartner = null;
  }

  return {
    partnerClient: resolvedPartner,
    poCountry: country,
    poCustomerName: resolvedCustomer,
    confidence,
    matchedLabels,
    notes,
    textExtractionFailed: false,
  };
}
