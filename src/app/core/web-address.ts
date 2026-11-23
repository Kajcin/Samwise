/** An http(s) address without spaces, as the database accepts for links (migration 0010). */
export function isWebAddress(text: string): boolean {
  try {
    const url = new URL(text);
    return (url.protocol === 'http:' || url.protocol === 'https:') && !/\s/.test(text);
  } catch {
    return false;
  }
}
