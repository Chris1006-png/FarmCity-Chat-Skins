/**
 * FarmCity — layered shirt renderer.
 *
 * The supplied blue-shirt sheets contain only the garment on a white matte.
 * We extract the connected garment pixels and place them on the same
 * character anchor as the body, hair, and pants layers.
 */

export const SHIRT_STYLES = ['blue-shirt'] as const;
export type ShirtStyle = (typeof SHIRT_STYLES)[number];

export const SHIRT_STYLE_LABELS: Record<string, string> = {
  'blue-shirt': 'Camisa azul',
};

type ShirtAnimation = 'idle' | 'walk';

type SheetConfig = {
  url: string;
  columns: number;
  cellHeight: number;
  frameMap: readonly number[];
};

const SHEET_WIDTH = 460;
const SHEET_SCALE = 0.20;
const SHEET_FOOT_Y = 430;
const BACKGROUND_THRESHOLD = 220;
const MIN_COMPONENT_AREA = 12;

const SHEETS: Record<ShirtAnimation, SheetConfig> = {
  idle: {
    url: `${import.meta.env.BASE_URL}sprites/Shirt_Blue_Idle.png`,
    columns: 2,
    cellHeight: 453,
    frameMap: [0, 1, 0, 1, 0, 1, 0, 1],
  },
  walk: {
    url: `${import.meta.env.BASE_URL}sprites/Shirt_Blue_Walk.png`,
    columns: 4,
    cellHeight: 460,
    frameMap: [0, 1, 2, 3, 2, 1],
  },
};

const sheetCache = new Map<ShirtAnimation, HTMLImageElement>();
const maskCache = new Map<string, HTMLCanvasElement>();

function getSheet(animation: ShirtAnimation): HTMLImageElement {
  let image = sheetCache.get(animation);
  if (!image) {
    image = new Image();
    image.src = SHEETS[animation].url;
    sheetCache.set(animation, image);
  }
  return image;
}

function resolveFrame(animation: ShirtAnimation, frame: number): number {
  const config = SHEETS[animation];
  const safeFrame = Math.max(0, Math.round(frame));
  return (config.frameMap[safeFrame % config.frameMap.length] ?? 0) % config.columns;
}

function getShirtMask(
  animation: ShirtAnimation,
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

  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  const foreground = new Uint8Array(canvas.width * canvas.height);
  for (let index = 0; index < pixels.data.length; index += 4) {
    const red = pixels.data[index];
    const green = pixels.data[index + 1];
    const blue = pixels.data[index + 2];
    const luminance = red * 0.299 + green * 0.587 + blue * 0.114;
    const pixelIndex = index / 4;
    if (luminance < BACKGROUND_THRESHOLD) {
      foreground[pixelIndex] = 1;
    } else {
      pixels.data[index] = 0;
      pixels.data[index + 1] = 0;
      pixels.data[index + 2] = 0;
    }
    pixels.data[index + 3] = 0;
  }

  const visited = new Uint8Array(foreground.length);
  const neighbors = [
    [-1, -1], [0, -1], [1, -1],
    [-1, 0],            [1, 0],
    [-1, 1],  [0, 1],  [1, 1],
  ] as const;

  for (let start = 0; start < foreground.length; start += 1) {
    if (!foreground[start] || visited[start]) continue;

    const component: number[] = [];
    const queue = [start];
    visited[start] = 1;

    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const current = queue[cursor];
      component.push(current);
      const x = current % canvas.width;
      const y = Math.floor(current / canvas.width);

      for (const [offsetX, offsetY] of neighbors) {
        const nextX = x + offsetX;
        const nextY = y + offsetY;
        if (
          nextX < 0 ||
          nextX >= canvas.width ||
          nextY < 0 ||
          nextY >= canvas.height
        ) continue;
        const next = nextY * canvas.width + nextX;
        if (foreground[next] && !visited[next]) {
          visited[next] = 1;
          queue.push(next);
        }
      }
    }

    if (component.length < MIN_COMPONENT_AREA) {
      for (const pixelIndex of component) {
        pixels.data[pixelIndex * 4] = 0;
        pixels.data[pixelIndex * 4 + 1] = 0;
        pixels.data[pixelIndex * 4 + 2] = 0;
      }
      continue;
    }
    for (const pixelIndex of component) {
      pixels.data[pixelIndex * 4 + 3] = 255;
    }
  }

  context.putImageData(pixels, 0, 0);
  maskCache.set(key, canvas);
  return canvas;
}

export function drawShirtLayer(
  context: CanvasRenderingContext2D,
  feetX: number,
  feetY: number,
  row: number,
  flip: boolean,
  shirtStyle: string | null | undefined,
  animation: string = 'idle',
  frame = 0,
): void {
  if (shirtStyle !== 'blue-shirt') return;

  const resolvedAnimation: ShirtAnimation = animation === 'walk' ? 'walk' : 'idle';
  const mask = getShirtMask(resolvedAnimation, row, frame);
  if (!mask) return;

  const config = SHEETS[resolvedAnimation];
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
    0,
    0,
    SHEET_WIDTH,
    config.cellHeight,
    fullX,
    fullY,
    fullWidth,
    config.cellHeight * SHEET_SCALE,
  );
  context.restore();
}

function getAlphaBounds(canvas: HTMLCanvasElement): [number, number, number, number] | null {
  const context = canvas.getContext('2d');
  if (!context) return null;
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  let minX = canvas.width;
  let minY = canvas.height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < canvas.height; y += 1) {
    for (let x = 0; x < canvas.width; x += 1) {
      if (pixels.data[(y * canvas.width + x) * 4 + 3] === 0) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  return maxX < minX || maxY < minY
    ? null
    : [minX, minY, maxX - minX + 1, maxY - minY + 1];
}

export function drawShirtThumbnail(
  context: CanvasRenderingContext2D,
  size: number,
  shirtStyle: string,
): boolean {
  if (shirtStyle !== 'blue-shirt') return true;

  const mask = getShirtMask('idle', 0, 0);
  if (!mask) return false;
  const bounds = getAlphaBounds(mask);
  if (!bounds) return true;

  const [sourceX, sourceY, sourceWidth, sourceHeight] = bounds;
  const padding = Math.round(size * 0.08);
  const scale = Math.min(
    (size - padding * 2) / sourceWidth,
    (size - padding * 2) / sourceHeight,
  );
  const targetWidth = sourceWidth * scale;
  const targetHeight = sourceHeight * scale;

  context.clearRect(0, 0, size, size);
  context.imageSmoothingEnabled = false;
  context.drawImage(
    mask,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    (size - targetWidth) / 2,
    (size - targetHeight) / 2,
    targetWidth,
    targetHeight,
  );
  return true;
}