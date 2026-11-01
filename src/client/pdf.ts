import chalk from 'chalk';
import { downloadToFile } from './download.js';

/** The answer's `pdf` object (`GET /v1/earnings-calls/transcript`, `GET /v1/news/{id}`); null while none exists. */
interface Pdf {
  url: string;
}

/** `--pdf-out <file>`: saves the PDF from its public URL (no API key). No PDF is an error, so a script sees it. */
export async function savePdf(
  pdf: Pdf | null | undefined,
  opts: { pdfOut?: string; force?: boolean },
  spinnerText: string,
): Promise<{ path: string; bytes: number } | undefined> {
  if (!opts.pdfOut) return undefined;
  if (!pdf) throw new Error('No PDF yet for this version');
  return downloadToFile(pdf.url, opts.pdfOut, { force: opts.force, spinnerText });
}

/** `--pdf`: the URL alone, so it can be piped; a note without a PDF. */
export function printPdfUrl(pdf: Pdf | null | undefined): void {
  console.log(pdf ? pdf.url : chalk.yellow('No PDF yet'));
}
