/**
 * A file the viewer can show.
 *
 * - `load` fetches the original bytes with the signed-in session, exactly like a download does. Download always saves these bytes.
 * - `pdf` (optional) fetches a server-side PDF rendering of the file. It is used for Office formats (docx, xlsx, pptx, odt, rtf ...)
 *   and its result is shown in the PDF viewer. When it is missing the viewer falls back to the app's `PDF_CONVERTER`, then to a
 *   client-side renderer (spreadsheets become a table), then to "Preview not available".
 *   A Teams chat file card sets `pdf` to `GET /api/plugins/microsoft/accounts/{accountId}/chats/{chatId}/messages/{messageId}/files/{attachmentId}/pdf`
 *   (every id passed through encodeURIComponent, responseType 'blob') plus a `key` such as `chat:{accountId}:{chatId}:{messageId}:{attachmentId}`.
 * - `key` (optional) is a stable identity for the file: it caches converted PDFs for the session and matches the file in `files`.
 */
export interface ViewerFile {
  name: string;
  load: () => Promise<Blob>;
  pdf?: () => Promise<Blob>;
  key?: string;
}
