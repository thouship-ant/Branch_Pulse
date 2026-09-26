/**
 * Compress a camera photo to <= 300 KB before it is stored/uploaded (HLD s7).
 * Scales the long edge down and lowers JPEG quality until it fits.
 */
export async function compressImage(file: File | Blob, maxBytes = 300 * 1024): Promise<Blob> {
  if (!file.type.startsWith('image/')) return file; // PDFs etc. go up as-is
  const bitmap = await createImageBitmap(file);
  let scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  let quality = 0.82;
  let out: Blob | null = null;

  for (let attempt = 0; attempt < 8; attempt++) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    out = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', quality));
    if (out && out.size <= maxBytes) break;
    if (quality > 0.5) quality -= 0.12;
    else scale *= 0.8;
  }
  bitmap.close?.();
  return out ?? file;
}
