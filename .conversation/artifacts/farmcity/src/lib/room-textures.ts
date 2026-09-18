export interface RoomTextureColors {
  base: string;
  light: string;
  dark: string;
  mark: string;
}

export function roomTextureColors(textureId: string): RoomTextureColors {
  const id = textureId.toLowerCase();

  if (id.includes('grass') || id.includes('green')) {
    return { base: '#55b83f', light: '#8cdb5e', dark: '#2f8e37', mark: 'rgba(231,255,173,.28)' };
  }
  if (id.includes('tile') || id.includes('stone') || id.includes('blue')) {
    return { base: '#5f9caf', light: '#9ed1d0', dark: '#35687f', mark: 'rgba(227,247,239,.30)' };
  }
  if (id.includes('clay') || id.includes('coral') || id.includes('terracotta')) {
    return { base: '#d06c52', light: '#ef9a69', dark: '#9c3e3d', mark: 'rgba(255,226,176,.30)' };
  }
  return { base: '#c7924d', light: '#edc16e', dark: '#8b572c', mark: 'rgba(255,235,169,.28)' };
}