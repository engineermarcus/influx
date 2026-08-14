/**
 * Maps a pointer event on a displayed <img> (object-fit: contain) back to
 * the original image's pixel coordinate space.
 */
export function imgCoords(
  clientX: number,
  clientY: number,
  imgEl: HTMLImageElement
): { x: number; y: number } {
  const rect = imgEl.getBoundingClientRect();
  const nw = imgEl.naturalWidth;
  const nh = imgEl.naturalHeight;
  const containerAR = rect.width / rect.height;
  const imageAR = nw / nh;

  let drawW: number, drawH: number, offX = 0, offY = 0;
  if (containerAR > imageAR) {
    drawH = rect.height;
    drawW = drawH * imageAR;
    offX = (rect.width - drawW) / 2;
  } else {
    drawW = rect.width;
    drawH = drawW / imageAR;
    offY = (rect.height - drawH) / 2;
  }

  const relX = clientX - rect.left - offX;
  const relY = clientY - rect.top - offY;
  return {
    x: Math.round(relX * (nw / drawW)),
    y: Math.round(relY * (nh / drawH)),
  };
}

export function downloadDataUrl(dataUrl: string, filename: string) {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
