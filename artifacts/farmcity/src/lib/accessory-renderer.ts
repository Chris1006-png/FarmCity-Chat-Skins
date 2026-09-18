/**
 * FarmCity — Layered accessory renderer
 *
 * The uploaded accessory sheets contain the character on a white background.
 * We keep only the pixels that belong to the head-mounted accessory inside
 * its bounds, then draw that layer on top of the body and hair sprites.
 */

import idleAccessorySheetUrl from '@assets/9_sin_título_Restaurado_20260901161013_1788301128227.png';
import walkAccessorySheetUrl from '@assets/8_sin_título_20260901170908_1788301127979.png';

export const ACCESSORY_STYLES: readonly string[] = ['vr-goggles'];

export const ACCESSORY_STYLE_LABELS: Record<string, string> = {
  'vr-goggles': 'Gafas VR',
  none: 'Sin accesorio',
};

export const ACCESSORY_COLORS: readonly string[] = [
  '#A9F0F0',
  '#5BC0EB',
  '#7B61FF',
  '#F06AA7',
  '#7BD88F',
  '#F5B942',
  '#F2F2F2',
];

export const DEFAULT_ACCESSORY_COLOR = ACCESSORY_COLORS[0];

type AccessoryAnimation = 'idle' | 'walk';

type SheetConfig = {
  url: string;
  columns: number;
  cellHeight: number;
  frameMap: readonly number[];
};

const SHEET_WIDTH = 460;
const SHEET_SCALE = 0.20;
const SHEET_FOOT_Y = 430;
const ACCESSORY_MASK_RADIUS = 9;
const ACCESSORY_FRAME_RADIUS = 5;
const SHEET_BACKGROUND_THRESHOLD = 235;
const SOFT_BACKGROUND_THRESHOLD = 220;
const SOFT_BACKGROUND_MAX_SPREAD = 14;

const SHEETS: Record<AccessoryAnimation, SheetConfig> = {
  idle: {
    url: idleAccessorySheetUrl,
    columns: 2,
    cellHeight: 453,
    frameMap: [0, 1, 0, 1, 0, 1, 0, 1],
  },
  walk: {
    url: walkAccessorySheetUrl,
    columns: 4,
    cellHeight: 460,
    frameMap: [0, 1, 2, 3, 2, 1],
  },
};

/**
 * The source art shows the goggles in the first three direction rows. Rows
 * 3 and 4 are the rear views, where the asset intentionally has no visible
 * goggles.
 */
const ACCESSORY_BOUNDS: ReadonlyArray<readonly [number, number, number, number] | null> = [
  [130, 160, 210, 100], // front
  [120, 145, 220, 120], // diagonal
  [140, 175, 145, 90],  // profile
  null,
  null,
];

const sheetCache = new Map<AccessoryAnimation, HTMLImageElement>();
const maskCache = new Map<string, HTMLCanvasElement>();
const tintedMaskCache = new Map<string, HTMLCanvasElement>();

function getSheet(animation: AccessoryAnimation): HTMLImageElement {
  let image = sheetCache.get(animation);
  if (!image) {
    image = new Image();
    image.src = SHEETS[animation].url;
    sheetCache.set(animation, image);
  }
  return image;
}

function resolveFrame(animation: AccessoryAnimation, frame: number): number {
  const config = SHEETS[animation];
  const safeFrame = Math.max(0, Math.round(frame));
  return (config.frameMap[safeFrame % config.frameMap.length] ?? 0) % config.columns;
}

function getMask(
  animation: AccessoryAnimation,
  row: number,
  frame: number,
): HTMLCanvasElement | null {
  const config = SHEETS[animation];
  const image = getSheet(animation);
  if (!image.complete || image.naturalWidth === 0) return null;

  const safeRow = Math.max(0, Math.min(4, Math.round(row)));
  const safeFrame = resolveFrame(animation, frame);
  const key = `${animation}:${safeRow}:${safeFrame}`;
  const cached = maskCache.get(key);
  if (cached) return cached;

  const canvas = document.createElement('canvas');
  canvas.width = SHEET_WIDTH;
  canvas.height = config.cellHeight;
  const context = canvas.getContext('2d');
  if (!context) return null;

  context.imageSmoothingEnabled = false;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(
    image,
    safeFrame * SHEET_WIDTH,
    safeRow * config.cellHeight,
    SHEET_WIDTH,
    config.cellHeight,
    0,
    0,
    SHEET_WIDTH,
    config.cellHeight,
  );

  const bounds = ACCESSORY_BOUNDS[safeRow];
  if (!bounds) return canvas;

  const [boundX, boundY, boundWidth, boundHeight] = bounds;
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  const gogglePixels = new Uint8Array(canvas.width * canvas.height);
  const nearGogglePixels = new Uint8Array(canvas.width * canvas.height);
  const accessoryFramePixels = new Uint8Array(canvas.width * canvas.height);

  // The source sheet is a complete character, not an isolated accessory.
  // Cyan/teal pixels are unique to the goggles, so use them as seeds and
  // recover only their nearby frame/outline. This prevents the source head,
  // hair and body outlines from being painted over the player's own layers.
  for (let y = 0; y < canvas.height; y += 1) {
    for (let x = 0; x < canvas.width; x += 1) {
      const index = (y * canvas.width + x) * 4;
      const insideBounds =
        x >= boundX &&
        x < boundX + boundWidth &&
        y >= boundY &&
        y < boundY + boundHeight;

      if (!insideBounds) {
        const index = (y * canvas.width + x) * 4;
        pixels.data[index] = 0;
        pixels.data[index + 1] = 0;
        pixels.data[index + 2] = 0;
        pixels.data[index + 3] = 0;
        continue;
      }

      const red = pixels.data[index];
      const green = pixels.data[index + 1];
      const blue = pixels.data[index + 2];
      if (
        insideBounds &&
        green >= red + 12 &&
        blue >= red + 12 &&
        green >= 80
      ) {
        gogglePixels[y * canvas.width + x] = 1;
      }
    }
  }

  // Dilate from each colored seed instead of scanning a neighborhood around
  // every pixel. The resulting mask is equivalent but much cheaper for the
  // animation renderer.
  for (let y = boundY; y < boundY + boundHeight; y += 1) {
    for (let x = boundX; x < boundX + boundWidth; x += 1) {
      if (!gogglePixels[y * canvas.width + x]) continue;
      for (let offsetY = -ACCESSORY_MASK_RADIUS; offsetY <= ACCESSORY_MASK_RADIUS; offsetY += 1) {
        for (let offsetX = -ACCESSORY_MASK_RADIUS; offsetX <= ACCESSORY_MASK_RADIUS; offsetX += 1) {
          if (
            offsetX * offsetX + offsetY * offsetY >
            ACCESSORY_MASK_RADIUS * ACCESSORY_MASK_RADIUS
          ) continue;
          const neighborX = x + offsetX;
          const neighborY = y + offsetY;
          if (
            neighborX >= 0 &&
            neighborX < canvas.width &&
            neighborY >= 0 &&
            neighborY < canvas.height
          ) {
            nearGogglePixels[neighborY * canvas.width + neighborX] = 1;
            if (
              offsetX * offsetX + offsetY * offsetY <=
              ACCESSORY_FRAME_RADIUS * ACCESSORY_FRAME_RADIUS
            ) {
              accessoryFramePixels[neighborY * canvas.width + neighborX] = 1;
            }
          }
        }
      }
    }
  }

  for (let y = boundY; y < boundY + boundHeight; y += 1) {
    for (let x = boundX; x < boundX + boundWidth; x += 1) {
      const index = (y * canvas.width + x) * 4;
      // Include the dark/gray frame around the colored visor without
      // reaching the separate head outline or hairstyle.
      if (!nearGogglePixels[y * canvas.width + x]) {
        pixels.data[index + 3] = 0;
        continue;
      }

      const red = pixels.data[index];
      const green = pixels.data[index + 1];
      const blue = pixels.data[index + 2];
      const isCharacterOutline =
        red < 100 &&
        green < 55 &&
        blue < 100 &&
        !accessoryFramePixels[y * canvas.width + x];
      const channelSpread = Math.max(red, green, blue) - Math.min(red, green, blue);
      // These sheets are RGB PNGs with a #FFFEFF matte, not transparent art.
      // Never derive alpha from brightness: doing so leaves a low-alpha
      // rectangle wherever the matte is slightly darker after resampling.
      const isSheetBackground =
        red >= SHEET_BACKGROUND_THRESHOLD &&
        green >= SHEET_BACKGROUND_THRESHOLD &&
        blue >= SHEET_BACKGROUND_THRESHOLD;
      // Remove the pale anti-aliased fringe of the matte too, while retaining
      // chromatic visor highlights and the gray accessory frame.
      const isSoftBackground =
        red >= SOFT_BACKGROUND_THRESHOLD &&
        green >= SOFT_BACKGROUND_THRESHOLD &&
        blue >= SOFT_BACKGROUND_THRESHOLD &&
        channelSpread <= SOFT_BACKGROUND_MAX_SPREAD;
      const shouldClear = isSheetBackground || isSoftBackground || isCharacterOutline;
      if (shouldClear) {
        // Also clear RGB, not only alpha. Transparent white RGB can bleed into
        // the edge when this canvas is transformed or composited by the GPU.
        pixels.data[index] = 0;
        pixels.data[index + 1] = 0;
        pixels.data[index + 2] = 0;
        pixels.data[index + 3] = 0;
      } else {
        pixels.data[index + 3] = 255;
      }
    }
  }

  // Fill only the gaps enclosed by the real visor silhouette. Using a
  // scanline between the detected accessory edges follows every animation
  // frame and direction without inventing a larger hand-drawn rectangle.
  for (let y = boundY; y < boundY + boundHeight; y += 1) {
    let left = boundX + boundWidth;
    let right = boundX - 1;
    for (let x = boundX; x < boundX + boundWidth; x += 1) {
      if (!nearGogglePixels[y * canvas.width + x]) continue;
      left = Math.min(left, x);
      right = Math.max(right, x);
    }
    if (right < left) continue;

    for (let x = left; x <= right; x += 1) {
      const index = (y * canvas.width + x) * 4;
      if (pixels.data[index + 3] !== 0) continue;
      pixels.data[index] = 255;
      pixels.data[index + 1] = 255;
      pixels.data[index + 2] = 255;
      pixels.data[index + 3] = 255;
    }
  }

  context.putImageData(pixels, 0, 0);
  maskCache.set(key, canvas);
  return canvas;
}

function parseHexColor(color: string): [number, number, number] {
  const match = color.trim().match(/^#([0-9a-f]{6})$/i);
  if (!match) return [169, 240, 240];
  return [
    Number.parseInt(match[1].slice(0, 2), 16),
    Number.parseInt(match[1].slice(2, 4), 16),
    Number.parseInt(match[1].slice(4, 6), 16),
  ];
}

function getTintedMask(
  animation: AccessoryAnimation,
  row: number,
  frame: number,
  color: string,
): HTMLCanvasElement | null {
  const config = SHEETS[animation];
  const safeRow = Math.max(0, Math.min(4, Math.round(row)));
  const safeFrame = resolveFrame(animation, frame);
  const key = `${animation}:${safeRow}:${safeFrame}:${color}`;
  const cached = tintedMaskCache.get(key);
  if (cached) return cached;

  const mask = getMask(animation, safeRow, safeFrame);
  if (!mask) return null;

  const canvas = document.createElement('canvas');
  canvas.width = SHEET_WIDTH;
  canvas.height = config.cellHeight;
  const context = canvas.getContext('2d');
  if (!context) return null;

  context.imageSmoothingEnabled = false;
  context.drawImage(mask, 0, 0);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  const [targetRed, targetGreen, targetBlue] = parseHexColor(color);

  // Recolour the whole light visor shell, not only its cyan source pixels.
  // The solid base above closes the white gaps between the original pixel
  // details. Keep the dark frame and purple lenses untouched.
  for (let index = 0; index < pixels.data.length; index += 4) {
    if (pixels.data[index + 3] === 0) continue;
    const red = pixels.data[index];
    const green = pixels.data[index + 1];
    const blue = pixels.data[index + 2];
    const isDarkFrame = red < 100 && green < 55 && blue < 100;
    const isPurpleLens = green < red - 18 && blue > green + 18;
    const isVisorShell =
      !isDarkFrame &&
      !isPurpleLens &&
      green >= red - 12 &&
      blue >= red - 12;
    if (!isVisorShell) continue;

    const luminance = red * 0.299 + green * 0.587 + blue * 0.114;
    const shade = Math.max(0.68, Math.min(1.18, luminance / 220));
    pixels.data[index] = Math.min(255, Math.round(targetRed * shade));
    pixels.data[index + 1] = Math.min(255, Math.round(targetGreen * shade));
    pixels.data[index + 2] = Math.min(255, Math.round(targetBlue * shade));
  }

  context.putImageData(pixels, 0, 0);
  tintedMaskCache.set(key, canvas);
  return canvas;
}

function drawSheetCrop(
  context: CanvasRenderingContext2D,
  feetX: number,
  feetY: number,
  row: number,
  flip: boolean,
  animation: AccessoryAnimation,
  frame: number,
  color: string,
): boolean {
  const config = SHEETS[animation];
  const bounds = ACCESSORY_BOUNDS[Math.max(0, Math.min(4, Math.round(row)))];
  if (!bounds) return true;

  const mask = getTintedMask(animation, row, frame, color);
  if (!mask) return false;

  const [sourceX, sourceY, sourceWidth, sourceHeight] = bounds;
  const fullWidth = SHEET_WIDTH * SHEET_SCALE;
  const fullX = feetX - fullWidth / 2;
  const fullY = feetY - SHEET_FOOT_Y * SHEET_SCALE;

  context.save();
  context.imageSmoothingEnabled = false;
  if (flip) {
    context.translate(feetX, 0);
    context.scale(-1, 1);
    context.translate(-feetX, 0);
  }
  context.drawImage(
    mask,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    fullX + sourceX * SHEET_SCALE,
    fullY + sourceY * SHEET_SCALE,
    sourceWidth * SHEET_SCALE,
    sourceHeight * SHEET_SCALE,
  );
  context.restore();
  return true;
}

export function drawAccessoryLayer(
  context: CanvasRenderingContext2D,
  feetX: number,
  feetY: number,
  row: number,
  flip: boolean,
  accessory: string | null | undefined,
  animation = 'idle',
  frame = 0,
  accessoryColor = DEFAULT_ACCESSORY_COLOR,
): void {
  if (!accessory || accessory === 'none') return;
  const resolvedAnimation: AccessoryAnimation = animation === 'walk' ? 'walk' : 'idle';
  drawSheetCrop(context, feetX, feetY, row, flip, resolvedAnimation, frame, accessoryColor);
}

/**
 * Draws a catalog thumbnail and returns false while the image is still loading.
 * Callers can retry on the next animation frame.
 */
export function drawAccessoryThumbnail(
  context: CanvasRenderingContext2D,
  size: number,
  accessory: string,
  accessoryColor = DEFAULT_ACCESSORY_COLOR,
): boolean {
  if (accessory === 'none') return true;

  const mask = getTintedMask('idle', 0, 0, accessoryColor);
  if (!mask) return false;

  const bounds = ACCESSORY_BOUNDS[0];
  if (!bounds) return true;
  const [sourceX, sourceY, sourceWidth, sourceHeight] = bounds;
  const padding = Math.round(size * 0.08);
  const targetWidth = size - padding * 2;
  const targetHeight = targetWidth * (sourceHeight / sourceWidth);

  context.clearRect(0, 0, size, size);
  context.imageSmoothingEnabled = false;
  context.drawImage(
    mask,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    padding,
    (size - targetHeight) / 2,
    targetWidth,
    targetHeight,
  );
  return true;
}