import sharp from 'sharp';

const outputs = [
  ['public/icon-192.png', 192, false],
  ['public/icon-512.png', 512, false],
  ['public/maskable-512.png', 512, true],
  ['public/apple-touch-icon.png', 180, false],
  ['public/favicon-32.png', 32, false],
];

function iconSvg(size, maskable) {
  const inset = maskable ? size * 0.2 : size * 0.12;
  const cardSize = size - inset * 2;
  const radius = size * 0.16;
  const lineX = inset + cardSize * 0.22;
  const lineWidth = cardSize * 0.56;
  const lineHeight = Math.max(3, size * 0.035);
  return `
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${size}" height="${size}" rx="${maskable ? 0 : size * 0.23}" fill="#1d3930"/>
      <rect x="${inset}" y="${inset}" width="${cardSize}" height="${cardSize}" rx="${radius}" fill="#fff8eb"/>
      <circle cx="${inset + cardSize * 0.72}" cy="${inset + cardSize * 0.28}" r="${cardSize * 0.105}" fill="#d86f4d"/>
      <rect x="${lineX}" y="${inset + cardSize * 0.48}" width="${lineWidth}" height="${lineHeight}" rx="${lineHeight / 2}" fill="#1d3930"/>
      <rect x="${lineX}" y="${inset + cardSize * 0.62}" width="${lineWidth * 0.8}" height="${lineHeight}" rx="${lineHeight / 2}" fill="#81948a"/>
      <rect x="${lineX}" y="${inset + cardSize * 0.76}" width="${lineWidth * 0.58}" height="${lineHeight}" rx="${lineHeight / 2}" fill="#c0aa90"/>
    </svg>`;
}

await Promise.all(
  outputs.map(([path, size, maskable]) =>
    sharp(Buffer.from(iconSvg(size, maskable))).png().toFile(path),
  ),
);
