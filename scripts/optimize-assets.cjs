const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');

const targets = [
  ['assets/sucker-punch-blocked.png', 'assets/sucker-punch-blocked.png', 900],
  ['assets/sucker-punch-landed.png', 'assets/sucker-punch-landed.png', 900],
  ['assets/sucker-lobby-header.png', 'assets/sucker-lobby-header.png', 1200],
  ['assets/sucker-game-header-clean.png', 'assets/sucker-game-header-clean.png', 800],
  ['assets/sucker-scorecard-wordmark.png', 'assets/sucker-scorecard-wordmark.png', 360],
  ['assets/sucker-token.png', 'assets/sucker-token.png', 256],
  ['assets/android-icon-monochrome.png', 'assets/notification-icon.png', 96, { whiteGlyph: true }],
  ['assets/icon.png', 'public/icon.png', 512],
  ['assets/favicon.png', 'public/favicon.png', 192],
];

async function optimize([source, destination, width, options = {}]) {
  const temporary = `${destination}.optimized`;
  let pipeline = sharp(source).resize({ fit: 'inside', withoutEnlargement: true, width });
  await pipeline.png({ adaptiveFiltering: true, compressionLevel: 9 }).toFile(temporary);

  if (options.whiteGlyph) {
    const { data, info } = await sharp(temporary).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    for (let offset = 0; offset < data.length; offset += info.channels) {
      const alpha = data[offset + 3];
      if (alpha > 0) {
        data[offset] = 255;
        data[offset + 1] = 255;
        data[offset + 2] = 255;
      }
    }
    await sharp(data, { raw: info }).png({ adaptiveFiltering: true, compressionLevel: 9 }).toFile(destination);
    await fs.unlink(temporary);
  } else {
    await fs.rename(temporary, destination);
  }

  const { size } = await fs.stat(destination);
  console.log(`${path.basename(destination)}: ${Math.round(size / 1024)} KB`);
}

void Promise.all(targets.map(optimize)).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
