declare module 'pdf-parse/lib/pdf-parse.js' {
  import pdfParse = require('pdf-parse');
  export default function parse(data: Uint8Array, options?: pdfParse.Options): Promise<pdfParse.Result>;
}
