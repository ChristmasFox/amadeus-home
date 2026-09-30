#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile, writeFile, readdir, mkdtemp, rename, chmod, stat, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

export const PIN = Object.freeze({
  version: '2026.9.4', module: 'monitor-DaIAK4fT.js',
  moduleSha256: 'ff42ea5b1a4c6146cd85bf1ad0cbb01652a3b328173570afc9fb3b7900ae4696',
  archiveSha512: '7165c4691a4802b72141f6a4410860c3c4406104010ad9b11e662274d2209cdc24f897304ca540c370b2aa3c046d747de58f8af2dd12588641f32a0c79c06c06',
});
function parser(hostRoot) { return createRequire(join(hostRoot, 'package.json'))('acorn'); }
export function installSource(original, template, hostRoot) {
  if (createHash('sha256').update(original).digest('hex') !== PIN.moduleSha256) throw new Error('pinned_whatsapp_module_digest_mismatch');
  const ast = parser(hostRoot).parse(original, { ecmaVersion: 'latest', sourceType: 'module' });
  const nodes = ast.body.filter((node) => node.type === 'FunctionDeclaration' && node.id?.name === 'createWhatsAppReplyPlan');
  if (nodes.length !== 1) throw new Error('pinned_whatsapp_boundary_count_mismatch');
  const node = nodes[0];
  // AST-owned whole-function replacement at ONE documented boundary.
  const output = original.slice(0, node.start) + template.trim() + original.slice(node.end);
  parser(hostRoot).parse(output, { ecmaVersion: 'latest', sourceType: 'module' });
  return output;
}
async function locate(root, found = []) {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      if (entry.name === 'whatsapp' && path.endsWith('/@openclaw/whatsapp')) found.push(path);
      else if (entry.name !== 'baileys') await locate(path, found);
    }
  }
  return found;
}
export async function upstream(archive) {
  const temp = await mkdtemp(join(tmpdir(), 'amadeus-delivery-upstream-'));
  try {
    const path = join(temp, 'upstream.tgz');
    if (archive) await writeFile(path, await readFile(archive));
    else {
      // npm respects the control host's declared HTTPS proxy. The archive is
      // verified before any persistent file is touched, including npm mirrors.
      const npmCli = join(dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js');
      // The pinned image runs Node through a private glibc loader. Invoking the
      // npm shebang via /usr/bin/env inherits that loader and breaks system
      // binaries; launch its JS CLI with the already-working Node executable.
      execFileSync(process.execPath, [npmCli, 'pack', '@openclaw/whatsapp@2026.9.4', '--ignore-scripts', '--silent', '--pack-destination', temp], { stdio: 'pipe', timeout: 120000, maxBuffer: 65536 });
      const bytes = await readFile(join(temp, 'openclaw-whatsapp-2026.9.4.tgz'));
      if (bytes.length > 32 * 1024 * 1024) throw new Error('pinned_whatsapp_archive_limit');
      await writeFile(path, bytes);
    }
    if (createHash('sha512').update(await readFile(path)).digest('hex') !== PIN.archiveSha512) throw new Error('pinned_whatsapp_archive_digest_mismatch');
    return execFileSync('tar', ['-xOf', path, `package/dist/${PIN.module}`], { encoding: 'utf8', maxBuffer: 1024 * 1024 });
  } finally { await rm(temp, { recursive: true, force: true }); }
}
export async function main(argv = process.argv.slice(2)) {
  const rootIndex = argv.indexOf('--whatsapp-root'); const root = argv[rootIndex + 1];
  if (rootIndex < 0 || !root) throw new Error('provide --whatsapp-root');
  const hostRoot = argv.includes('--host-root') ? argv[argv.indexOf('--host-root') + 1] : '/app';
  if (JSON.parse(await readFile(join(hostRoot, 'package.json'), 'utf8')).version !== PIN.version) throw new Error('pinned_openclaw_version_mismatch');
  const targets = await locate(root);
  if (targets.length !== 1) throw new Error('pinned_whatsapp_package_count_mismatch');
  const target = targets[0];
  if (JSON.parse(await readFile(join(target, 'package.json'), 'utf8')).version !== PIN.version) throw new Error('pinned_whatsapp_version_mismatch');
  if (!argv.includes('--apply')) { console.log('DELIVERY_BOUNDARY=plan; restore checksum-pinned pristine monitor and install typed reply plan'); return; }
  // Authorized apply restores the pristine single module first. Old edits are
  // not cleaned/translated or kept as compatibility. Lifecycle patches follow.
  const original = await upstream(argv.includes('--archive') ? argv[argv.indexOf('--archive') + 1] : undefined);
  const template = await readFile(new URL('./whatsapp-plan.js', import.meta.url), 'utf8');
  const output = installSource(original, template, hostRoot);
  const path = join(target, 'dist', PIN.module); const mode = (await stat(path)).mode & 0o777;
  const temporary = `${path}.delivery-tmp`; await writeFile(temporary, output); await chmod(temporary, mode); await rename(temporary, path);
  console.log('DELIVERY_BOUNDARY=installed; host=2026.9.4; channel=2026.9.4; contract=2');
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
