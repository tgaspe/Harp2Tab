// Shared by the (native) export screen and the web toolbar's inline export dropdown —
// both need to turn generated file content into a browser download on web.
export function contentToBlob(content: string, encoding: 'utf8' | 'base64', mimeType: string): Blob {
  return encoding === 'base64'
    ? new Blob([Uint8Array.from(atob(content), (c) => c.charCodeAt(0))], { type: mimeType })
    : new Blob([content], { type: mimeType });
}

export function triggerWebDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
