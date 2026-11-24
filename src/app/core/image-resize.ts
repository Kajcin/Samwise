/** The browser can't read the file as a picture (e.g. HEIC from an iPhone in Chrome). */
export class UnreadableImageError extends Error {
  constructor() {
    super('The file is not a picture the browser can read.');
    this.name = 'UnreadableImageError';
  }
}

/**
 * Shrinks a photo to at most `maxSide` pixels on its longer side, as JPEG: a phone photo of
 * several MB becomes a few hundred kB, which keeps uploads fast and the free storage tier
 * roomy. Smaller pictures keep their size (but are re-encoded, which also drops their
 * metadata, e.g. GPS location).
 */
export async function shrinkImage(file: Blob, maxSide = 1600, quality = 0.85): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new UnreadableImageError();
  }
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext('2d')!;
  context.fillStyle = '#fff'; // transparent PNGs get a white background in JPEG
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new UnreadableImageError())), 'image/jpeg', quality),
  );
}
