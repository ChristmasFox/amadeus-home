import { open, lstat, realpath, rm } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createSyntheticPromptBenchmarkDataset } from './fixtures/nl-query-synthetic-corpus.js';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

function isInside(root: string, target: string): boolean {
  const path = relative(root, target);
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path));
}

export async function exportSyntheticPromptBenchmarkDataset(destination: string): Promise<void> {
  if (!isAbsolute(destination)) throw new Error('synthetic_benchmark_output_must_be_absolute');
  const requestedPath = resolve(destination);
  const outputName = basename(requestedPath);
  if (!outputName || outputName === '.' || outputName === '..') {
    throw new Error('synthetic_benchmark_output_path_invalid');
  }

  const parent = await realpath(dirname(requestedPath));
  const directory = await lstat(parent);
  if (isInside(repositoryRoot, parent) || !directory.isDirectory()
    || directory.uid !== process.getuid?.() || (directory.mode & 0o077) !== 0) {
    throw new Error('synthetic_benchmark_output_directory_must_be_owner_only_external');
  }

  const outputPath = join(parent, outputName);
  const handle = await open(outputPath, 'wx', 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(createSyntheticPromptBenchmarkDataset(), null, 2)}\n`, 'utf8');
    await handle.chmod(0o600);
  } catch (error) {
    await handle.close();
    await rm(outputPath, { force: true });
    throw error;
  }
  await handle.close();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const destination = process.argv[2];
  if (!destination) {
    process.stderr.write('PUBG_SAAS_SYNTHETIC_BENCHMARK_EXPORT=failed code=output_path_required\n');
    process.exitCode = 1;
  } else {
    void exportSyntheticPromptBenchmarkDataset(destination).then(() => {
      process.stdout.write('PUBG_SAAS_SYNTHETIC_BENCHMARK_EXPORT=complete cases=100 mode=0600 external-file\n');
    }).catch((error: unknown) => {
      const code = error instanceof Error ? error.message : 'export_failed';
      process.stderr.write(`PUBG_SAAS_SYNTHETIC_BENCHMARK_EXPORT=failed code=${code}\n`);
      process.exitCode = 1;
    });
  }
}
