import { lstatSync, realpathSync, renameSync, copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

export interface MediaRoots {
  downloads: string;
  movies: string;
  tv: string;
}

export interface MediaMovePlan {
  source: string;
  target: string;
  backup: string;
  reason: string;
}

export class MediaPathPolicy {
  readonly roots: MediaRoots;

  constructor(roots: MediaRoots) {
    this.roots = {
      downloads: resolve(roots.downloads),
      movies: resolve(roots.movies),
      tv: resolve(roots.tv),
    };
  }

  validateSource(path: string): string {
    const candidate = this.validateWithin(path, [this.roots.downloads]);
    if (!existsSync(candidate)) throw new Error('media source does not exist');
    if (lstatSync(candidate).isSymbolicLink()) throw new Error('symlink source is not allowed');
    return candidate;
  }

  validateTarget(path: string): string {
    return this.validateWithin(path, [this.roots.movies, this.roots.tv]);
  }

  plan(source: string, target: string, reason: string): MediaMovePlan {
    const sourcePath = this.validateSource(source);
    const targetPath = this.validateTarget(target);
    if (sourcePath === targetPath) throw new Error('media source and target must differ');
    return { source: sourcePath, target: targetPath, backup: `${sourcePath}.kurisu-backup`, reason: reason.slice(0, 500) };
  }

  execute(plan: MediaMovePlan, approved: boolean): void {
    if (!approved) throw new Error('media move requires server-side approval');
    const source = this.validateSource(plan.source);
    const target = this.validateTarget(plan.target);
    if (source !== plan.source || target !== plan.target) throw new Error('media move plan changed');
    mkdirSync(dirname(target), { recursive: true });
    if (existsSync(plan.backup)) throw new Error('media backup already exists');
    copyFileSync(source, plan.backup);
    renameSync(source, target);
  }

  private validateWithin(path: string, roots: string[]): string {
    if (!isAbsolute(path)) throw new Error('media path must be absolute');
    const candidate = resolve(path);
    const root = roots.find((item) => {
      const rel = relative(item, candidate);
      return rel === '' || (rel && !rel.startsWith('..') && !isAbsolute(rel));
    });
    if (!root) throw new Error('media path is outside the allowlist');
    const canonicalRoot = existsSync(root) ? realpathSync(root) : root;
    const existingParent = existsSync(candidate) ? candidate : dirname(candidate);
    const real = realpathSync(existingParent);
    const relReal = relative(canonicalRoot, real);
    if (relReal.startsWith('..') || isAbsolute(relReal)) throw new Error('media symlink escapes the allowlist');
    return candidate;
  }
}
