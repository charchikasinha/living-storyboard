// Object URLs for blobs, created once per blob and reused across renders.
const urlCache = new WeakMap<Blob, string>();

export function blobUrl(blob: Blob | null | undefined) {
  if (!blob) return "";
  let url = urlCache.get(blob);
  if (!url) {
    url = URL.createObjectURL(blob);
    urlCache.set(blob, url);
  }
  return url;
}
