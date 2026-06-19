const childProcessWorkerSetting =
  "enableWorkerThreads: this._config.transformer.unstable_workerThreads,";
const workerThreadSetting = "enableWorkerThreads: true,";

const workerFarmPaths: string[] = [];

for await (const entry of Deno.readDir("node_modules/.deno")) {
  if (!entry.isDirectory || !entry.name.startsWith("metro@")) {
    continue;
  }

  const candidate =
    `node_modules/.deno/${entry.name}/node_modules/metro/src/DeltaBundler/WorkerFarm.js`;
  try {
    await Deno.stat(candidate);
    workerFarmPaths.push(candidate);
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) {
      throw error;
    }
  }
}

if (workerFarmPaths.length === 0) {
  throw new Error("Metro WorkerFarm.js was not found under node_modules/.deno.");
}

let patchedCount = 0;

for (const workerFarmPath of workerFarmPaths) {
  let workerFarm = await Deno.readTextFile(workerFarmPath);

  if (workerFarm.includes(workerThreadSetting)) {
    patchedCount += 1;
    continue;
  }

  if (workerFarm.includes(childProcessWorkerSetting)) {
    workerFarm = workerFarm.replace(
      childProcessWorkerSetting,
      workerThreadSetting,
    );
    await Deno.writeTextFile(workerFarmPath, workerFarm);
    patchedCount += 1;
  }
}

if (patchedCount === 0) {
  throw new Error("Metro WorkerFarm worker-thread setting was not found.");
}
