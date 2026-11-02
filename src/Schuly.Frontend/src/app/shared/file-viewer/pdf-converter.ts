import { InjectionToken } from '@angular/core';

/** Converts an Office file the app only has the bytes of into a PDF. Provided by whichever integration can do it; the viewer does not care which. */
export interface PdfConverter {
  available(): boolean | Promise<boolean>;
  convert(blob: Blob, name: string): Promise<Blob>;
}

export const PDF_CONVERTER = new InjectionToken<PdfConverter>('PDF_CONVERTER');
