import { unzipSync, strFromU8 } from 'fflate';
import sax from 'sax';

/**
 * Minimal, dependency-light DOCX table extractor. A .docx is a zip; `word/document.xml` holds the
 * body. We stream it with a SAX parser and pull out every `w:tbl → w:tr → w:tc` as text, which is
 * the RIGHT tool for real Word tables — no OCR. Assumes non-nested tables (true for this document);
 * nested tables would need a stack. Merged cells are absent here (verified), so cell text is taken
 * verbatim per `w:tc`.
 */
export type DocxTables = string[][][]; // tables → rows → cells

function localName(name: string): string {
  const i = name.indexOf(':');
  return i === -1 ? name : name.slice(i + 1);
}

export function extractTablesFromDocumentXml(xml: string): DocxTables {
  const parser = sax.parser(true, { trim: false, normalize: false });
  const tables: DocxTables = [];
  let curTable: string[][] | null = null;
  let curRow: string[] | null = null;
  let cellDepth = 0; // >0 ⇒ inside a w:tc
  let inText = false; // inside a w:t
  let cellBuf = '';

  parser.onopentag = (node) => {
    const ln = localName(node.name);
    if (ln === 'tbl') curTable = [];
    else if (ln === 'tr' && curTable) curRow = [];
    else if (ln === 'tc' && curRow) {
      cellDepth++;
      if (cellDepth === 1) cellBuf = '';
    } else if (ln === 't' && cellDepth > 0) inText = true;
    else if ((ln === 'tab' || ln === 'br' || ln === 'cr') && cellDepth > 0) cellBuf += ' ';
  };
  parser.ontext = (t) => { if (inText) cellBuf += t; };
  parser.oncdata = (t) => { if (inText) cellBuf += t; };
  parser.onclosetag = (name) => {
    const ln = localName(name);
    if (ln === 't') inText = false;
    else if (ln === 'tc' && curRow) {
      cellDepth--;
      if (cellDepth === 0) curRow.push(cellBuf.replace(/\s+/g, ' ').trim());
    } else if (ln === 'tr' && curTable && curRow) { curTable.push(curRow); curRow = null; }
    else if (ln === 'tbl' && curTable) { tables.push(curTable); curTable = null; }
  };

  parser.write(xml).close();
  return tables;
}

/** DOCX bytes → all tables. Throws (caught by the sync's validation gate) if it is not a Word doc. */
export function parseDocxTables(bytes: Uint8Array): DocxTables {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch (e: unknown) {
    throw new Error(`Not a readable .docx (zip) file: ${e instanceof Error ? e.message : String(e)}`);
  }
  const doc = files['word/document.xml'];
  if (!doc) throw new Error('word/document.xml not found — not a Word document.');
  return extractTablesFromDocumentXml(strFromU8(doc));
}
