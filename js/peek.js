/*
 * peek.js — BROWSER API: Canvas API
 * https://developer.mozilla.org/docs/Web/API/Canvas_API
 *
 * The first Peek hint: draws the album cover as a handful of big pixels.
 * The image is drawn tiny, then stretched with smoothing turned off.
 */

/** How many pixels across the hint cover is. */
const PEEK_BLOCKS = 9;

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener("load", () => resolve(image));
    image.addEventListener("error", () => reject(new Error("Couldn't load the album cover.")));
    image.src = url;
  });
}

/** Draw a pixelated version of the image at `url` onto `canvas`. */
export async function drawPixelated(canvas, url, blocks = PEEK_BLOCKS) {
  const image = await loadImage(url);

  const tiny = document.createElement("canvas");
  tiny.width = blocks;
  tiny.height = blocks;
  tiny.getContext("2d").drawImage(image, 0, 0, blocks, blocks);

  const size = 480;
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  context.imageSmoothingEnabled = false;
  context.drawImage(tiny, 0, 0, size, size);
}
