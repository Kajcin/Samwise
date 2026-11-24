import { shrinkImage, UnreadableImageError } from './image-resize';

/** A PNG of the given size, drawn on a canvas. */
function png(width: number, height: number): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d')!.fillRect(0, 0, width, height);
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b!), 'image/png'));
}

describe('shrinkImage', () => {
  it('scales a big photo down to 1600 px on its longer side, as JPEG', async () => {
    const result = await shrinkImage(await png(3200, 1200));
    const bitmap = await createImageBitmap(result);

    expect(result.type).toBe('image/jpeg');
    expect([bitmap.width, bitmap.height]).toEqual([1600, 600]);
  });

  it('keeps the size of a small picture', async () => {
    const bitmap = await createImageBitmap(await shrinkImage(await png(400, 300)));
    expect([bitmap.width, bitmap.height]).toEqual([400, 300]);
  });

  it('refuses a file that isn’t a readable picture', async () => {
    await expectAsync(shrinkImage(new Blob(['not a picture'], { type: 'image/heic' }))).toBeRejectedWithError(
      UnreadableImageError,
    );
  });
});
