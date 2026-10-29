// Avoid pdf-parse's debug entrypoint and Node Buffer-specific behaviour in its
// legacy PDF.js engine. A plain Uint8Array works on current Node runtimes.
import pdfParse from 'pdf-parse/lib/pdf-parse.js';

export async function extractPdfText(bytes: Uint8Array): Promise<string> {
  return (await pdfParse(Uint8Array.from(bytes))).text;
}
