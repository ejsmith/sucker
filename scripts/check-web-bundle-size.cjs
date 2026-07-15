const fs = require('node:fs');
const path = require('node:path');

const distDirectory = path.resolve('dist');
const totalBudget = 6.5 * 1024 * 1024;
const javascriptBudget = 2.5 * 1024 * 1024;

const files = listFiles(distDirectory);
const sourceMapFiles = files.filter((file) => file.endsWith('.map'));
const runtimeFiles = files.filter((file) => !file.endsWith('.map'));
const totalBytes = runtimeFiles.reduce((total, file) => total + fs.statSync(file).size, 0);
const javascriptBytes = runtimeFiles
  .filter((file) => file.endsWith('.js'))
  .reduce((total, file) => total + fs.statSync(file).size, 0);
const sourceMapBytes = sourceMapFiles.reduce((total, file) => total + fs.statSync(file).size, 0);
const entryHtml = fs.readFileSync(path.join(distDirectory, 'index.html'), 'utf8');

if (sourceMapFiles.length === 0) {
  throw new Error('Web export did not include external source maps.');
}

assertIncludes('viewport safe-area support', entryHtml, 'viewport-fit=cover');
assertIncludes('iOS standalone mode', entryHtml, 'apple-mobile-web-app-capable');
assertIncludes('iOS translucent status bar', entryHtml, 'apple-mobile-web-app-status-bar-style');
assertIncludes('PWA manifest', entryHtml, 'rel="manifest"');
assertFileExists('PWA manifest', path.join(distDirectory, 'manifest.json'));
assertFileExists('Apple touch icon', path.join(distDirectory, 'apple-touch-icon.png'));

assertWithinBudget('Web export', totalBytes, totalBudget);
assertWithinBudget('JavaScript', javascriptBytes, javascriptBudget);
console.log(
  `Web export: ${formatBytes(totalBytes)}; JavaScript: ${formatBytes(javascriptBytes)}; Source maps: ${formatBytes(sourceMapBytes)}`,
);

function listFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? listFiles(entryPath) : [entryPath];
  });
}

function assertWithinBudget(label, actual, budget) {
  if (actual > budget) {
    throw new Error(`${label} is ${formatBytes(actual)}, above the ${formatBytes(budget)} budget.`);
  }
}

function assertIncludes(label, value, expected) {
  if (!value.includes(expected)) {
    throw new Error(`Web export is missing ${label}.`);
  }
}

function assertFileExists(label, file) {
  if (!fs.existsSync(file)) {
    throw new Error(`Web export is missing ${label}.`);
  }
}

function formatBytes(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}
