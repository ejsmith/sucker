// Temporary guards for the unpatched image-size 1.2.1 ICNS/JXL/HEIF loops.
// Fail on an unexpected upstream version so this patch is reviewed when updated.
const fs = require('node:fs');
const path = require('node:path');
const root = path.dirname(require.resolve('image-size/package.json'));
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
if (version !== '1.2.1') throw new Error(`Review the image-size loop guards for upstream ${version}.`);

function patch(file, original, replacement) {
  const target = path.join(root, file);
  const source = fs.readFileSync(target, 'utf8');
  if (source.includes(replacement)) return;
  if (!source.includes(original)) throw new Error(`Unable to apply image-size guard: ${file}`);
  fs.writeFileSync(target, source.replace(original, replacement));
}

patch('dist/types/icns.js',
  '    const imageLengthOffset = imageOffset + ENTRY_LENGTH_OFFSET;',
  `    const imageLengthOffset = imageOffset + ENTRY_LENGTH_OFFSET;
    const entryLength = (0, utils_1.readUInt32BE)(input, imageLengthOffset);
    if (!Number.isFinite(entryLength) || entryLength < 8 || entryLength > input.length - imageOffset) {
        throw new TypeError('Invalid ICNS entry length');
    }`);
patch('dist/types/utils.js',
  '    if (input.length - offset < boxSize)',
  '    if (!Number.isFinite(boxSize) || boxSize < 8 || input.length - offset < boxSize)');
