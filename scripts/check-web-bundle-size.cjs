const fs = require('node:fs');
const path = require('node:path');

const distDirectory = path.resolve('dist');
const totalBudget = 6.5 * 1024 * 1024;
const javascriptBudget = 2.5 * 1024 * 1024;

const files = listFiles(distDirectory);
const totalBytes = files.reduce((total, file) => total + fs.statSync(file).size, 0);
const javascriptBytes = files
  .filter((file) => file.endsWith('.js'))
  .reduce((total, file) => total + fs.statSync(file).size, 0);

assertWithinBudget('Web export', totalBytes, totalBudget);
assertWithinBudget('JavaScript', javascriptBytes, javascriptBudget);
console.log(`Web export: ${formatBytes(totalBytes)}; JavaScript: ${formatBytes(javascriptBytes)}`);

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

function formatBytes(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}
