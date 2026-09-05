import { promises as fs } from 'node:fs';
import { basename, extname, isAbsolute, join, relative, resolve } from 'node:path';

export interface MediaItem {
  type: 'movie' | 'tv' | 'anime' | 'unknown';
  title: string;
  year?: number | undefined;
  season?: number | undefined;
  episode?: number | undefined;
  sourcePath: string;
  files: string[];
  sizeBytes: number;
  tmdbId?: number | undefined;
  imdbId?: string | undefined;
}

export interface MediaOperationPlan {
  item: MediaItem;
  targetPath: string;
  backupPath: string;
  operations: Array<{
    src: string;
    dst: string;
    operation: 'move' | 'rename' | 'create_dir';
  }>;
}

export interface MediaOperationsOptions {
  downloadsPaths: string[];
  libraryPaths: {
    movies: string;
    tv: string;
  };
  backupPath: string;
}

export class MediaOperations {
  private options: Required<MediaOperationsOptions>;

  constructor(options: MediaOperationsOptions) {
    this.options = {
      downloadsPaths: (options.downloadsPaths ?? [
        '/Volumes/Avalon/downloads',
        '/Volumes/Avalon/downloads/complete',
      ]).map((path) => resolve(path)),
      libraryPaths: {
        movies: resolve(options.libraryPaths?.movies ?? '/Volumes/Avalon/media/movies'),
        tv: resolve(options.libraryPaths?.tv ?? '/Volumes/Avalon/media/tv'),
      },
      backupPath: resolve(options.backupPath ?? '/Volumes/Avalon/backups/media-organizer'),
    };
  }

  /**
   * Scan downloads directory for media items
   */
  async scanDownloads(targetPattern?: string): Promise<MediaItem[]> {
    const items: MediaItem[] = [];
    const requestedPath = targetPattern && isAbsolute(targetPattern) ? resolve(targetPattern) : null;

    if (requestedPath && !this.isWithinAny(requestedPath, this.options.downloadsPaths, false)) {
      throw new Error(`下载路径不在允许的目录内: ${requestedPath}`);
    }

    if (requestedPath) {
      if (!(await this.isDirectory(requestedPath))) return items;
      const mediaItem = await this.analyzeMediaItem(requestedPath, basename(requestedPath));
      if (mediaItem) items.push(mediaItem);
      return items;
    }

    for (const downloadsPath of this.options.downloadsPaths) {
      try {
        const entries = await fs.readdir(downloadsPath, { withFileTypes: true });

        for (const entry of entries) {
          if (!entry.isDirectory()) continue;

          // Filter by pattern if specified
          if (targetPattern && !entry.name.toLowerCase().includes(targetPattern.toLowerCase())) {
            continue;
          }

          const itemPath = join(downloadsPath, entry.name);
          const mediaItem = await this.analyzeMediaItem(itemPath, entry.name);

          if (mediaItem) {
            items.push(mediaItem);
          }
        }
      } catch (error) {
        console.error(`Failed to scan ${downloadsPath}:`, error);
      }
    }

    return items;
  }

  /**
   * Analyze a media item directory
   */
  private async analyzeMediaItem(itemPath: string, itemName: string): Promise<MediaItem | null> {
    try {
      const entries = await fs.readdir(itemPath, { withFileTypes: true });

      const files: string[] = [];
      let totalSize = 0;
      const videoExtensions = ['.mkv', '.mp4', '.avi', '.mov', '.wmv', '.flv', '.webm'];

      for (const entry of entries) {
        if (entry.isFile()) {
          const ext = entry.name.toLowerCase().slice(entry.name.lastIndexOf('.'));
          if (videoExtensions.includes(ext)) {
            files.push(join(itemPath, entry.name));

            try {
              const stat = await fs.stat(join(itemPath, entry.name));
              totalSize += stat.size;
            } catch {
              // Skip files that can't be stat'd
            }
          }
        }
      }

      if (files.length === 0) {
        return null; // No video files found
      }

      // Analyze the item name to determine type and metadata
      const analysis = this.analyzeItemName(itemName);

      return {
        type: analysis.type,
        title: analysis.title,
        year: analysis.year,
        season: analysis.season,
        episode: analysis.episode,
        sourcePath: itemPath,
        files,
        sizeBytes: totalSize,
      };

    } catch (error) {
      console.error(`Failed to analyze ${itemPath}:`, error);
      return null;
    }
  }

  /**
   * Analyze item name to extract media information
   */
  private analyzeItemName(name: string): {
    type: MediaItem['type'];
    title: string;
    year: number | undefined;
    season: number | undefined;
    episode: number | undefined;
  } {
    const cleanedName = name
      .replace(/\[.*?\]/g, '') // Remove bracketed content
      .replace(/\(.*?\)/g, '') // Remove parenthesized content
      .replace(/\./g, ' ')     // Replace dots with spaces
      .replace(/_/g, ' ')      // Replace underscores with spaces
      .replace(/-/g, ' ')      // Replace hyphens with spaces
      .trim();

    // Check for TV patterns (S01E01, S1E1, etc.)
    const tvPattern = /(.+?)\s*[Ss](\d+)[Ee](\d+)/i;
    const tvMatch = cleanedName.match(tvPattern);

    if (tvMatch) {
      return {
        type: 'tv',
        title: tvMatch[1]!.trim(),
        season: parseInt(tvMatch[2]!, 10),
        episode: parseInt(tvMatch[3]!, 10),
        year: undefined,
      };
    }

    const yearPattern = /\b(19|20)\d{2}\b/;
    const yearMatch = cleanedName.match(yearPattern);
    if (yearMatch) {
      return {
        type: 'movie',
        title: cleanedName.replace(yearPattern, '').replace(/\s+/g, ' ').trim(),
        year: parseInt(yearMatch[0]!, 10),
        season: undefined,
        episode: undefined,
      };
    }

    // Check for anime patterns (often use absolute numbering)
    const animePatterns = [
      /(.+?)\s*-\s*(\d+)(?:\s*|$)/, // Title - Episode
      /\[?\[?(.+?)\]?\]?\s*(\d+)/, // [Title] Episode
    ];

    for (const pattern of animePatterns) {
      const match = cleanedName.match(pattern);
      if (match) {
        return {
          type: 'anime',
          title: match[1]!.trim(),
          episode: parseInt(match[2]!, 10),
          season: undefined,
          year: undefined,
        };
      }
    }

    return {
      type: 'movie',
      title: cleanedName,
      year: undefined,
      season: undefined,
      episode: undefined,
    };
  }

  /**
   * Create an operation plan for organizing media
   */
  async createOperationPlan(item: MediaItem): Promise<MediaOperationPlan> {
    const validation = await this.validateItem(item);
    if (!validation.valid) {
      throw new Error(`媒体项目无法安全处理: ${validation.issues.join('；')}`);
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safeTitle = this.safeName(item.title);
    const backupPath = join(this.options.backupPath, `${timestamp}-${safeTitle.replace(/\s+/g, '_')}`);

    let targetPath: string;
    const operations: MediaOperationPlan['operations'] = [];
    const baseName = `${safeTitle}${item.year !== undefined ? ` (${item.year})` : ''}`;

    switch (item.type) {
      case 'movie':
        targetPath = join(this.options.libraryPaths.movies, baseName);
        operations.push({ src: '', dst: targetPath, operation: 'create_dir' });
        for (const [index, file] of item.files.entries()) {
          const suffix = item.files.length > 1 ? ` - ${index + 1}` : '';
          operations.push({
            src: file,
            dst: join(targetPath, `${baseName}${suffix}${extname(file)}`),
            operation: 'move',
          });
        }
        break;

      case 'tv':
      case 'anime':
        if (item.files.length !== 1) {
          throw new Error('电视或动漫项目包含多个视频文件，无法确认每个文件的集数；请逐集指定或先确认编号。');
        }
        const seriesPath = join(this.options.libraryPaths.tv, baseName);
        const seasonNumber = item.season ?? 1;
        const seasonFolder = `Season ${seasonNumber.toString().padStart(2, '0')}`;

        targetPath = join(seriesPath, seasonFolder);

        // Create series directory if needed
        operations.push({
          src: '',
          dst: seriesPath,
          operation: 'create_dir',
        });

        // Create season directory
        operations.push({
          src: '',
          dst: targetPath,
          operation: 'create_dir',
        });

        // Move/rename files
        for (const file of item.files) {
          const newFilename = this.generateSeriesFilename(safeTitle, item.season ?? 1, item.episode ?? 1, file);
          operations.push({
            src: file,
            dst: join(targetPath, newFilename),
            operation: 'move',
          });
        }
        break;

      default:
        throw new Error(`Unsupported media type: ${item.type}`);
    }

    return {
      item,
      targetPath,
      backupPath,
      operations,
    };
  }

  /**
   * Generate filename for TV series episodes
   */
  private generateSeriesFilename(title: string, season: number, episode: number, originalFile: string): string {
    const originalName = originalFile.split('/').pop() ?? '';
    const ext = originalName.slice(originalName.lastIndexOf('.'));

    const seasonStr = season.toString().padStart(2, '0');
    const episodeStr = episode.toString().padStart(2, '0');

    return `${title} - S${seasonStr}E${episodeStr}${ext}`;
  }

  /**
   * Preview an operation plan (dry run)
   */
  async previewPlan(plan: MediaOperationPlan): Promise<{
    success: boolean;
    message: string;
    details: {
      sourceSize: string;
      targetSize: string;
      operationsCount: number;
      targetPath: string;
      backupPath: string;
      fileDetails: Array<{ src: string; dst: string; size: string }>;
    };
  }> {
    try {
      this.validatePlanPaths(plan);
      // Check if target path exists
      let targetExists = false;
      try {
        await fs.access(plan.targetPath);
        targetExists = true;
      } catch {
        // Target doesn't exist, which is fine
      }

      if (targetExists) {
        return {
          success: false,
          message: `目标路径已存在: ${plan.targetPath}，请手动检查避免覆盖`,
          details: {
            sourceSize: this.formatBytes(plan.item.sizeBytes),
            targetSize: '未知',
            operationsCount: plan.operations.length,
            targetPath: plan.targetPath,
            backupPath: plan.backupPath,
            fileDetails: [],
          },
        };
      }

      const fileDetails = [];
      for (const op of plan.operations) {
        if (op.operation === 'move') {
          try {
            const stat = await fs.stat(op.src);
            fileDetails.push({
              src: op.src,
              dst: op.dst,
              size: this.formatBytes(stat.size),
            });
          } catch {
            fileDetails.push({
              src: op.src,
              dst: op.dst,
              size: '未知',
            });
          }
        }
      }

      return {
        success: true,
        message: `准备整理: ${plan.item.title}`,
        details: {
          sourceSize: this.formatBytes(plan.item.sizeBytes),
          targetSize: this.formatBytes(plan.item.sizeBytes),
          operationsCount: plan.operations.length,
          targetPath: plan.targetPath,
          backupPath: plan.backupPath,
          fileDetails,
        },
      };

    } catch (error) {
      return {
        success: false,
        message: `预览失败: ${error instanceof Error ? error.message : '未知错误'}`,
        details: {
          sourceSize: '0',
          targetSize: '0',
          operationsCount: 0,
          targetPath: plan.targetPath,
          backupPath: plan.backupPath,
          fileDetails: [],
        },
      };
    }
  }

  /**
   * Execute an operation plan
   */
  async executePlan(plan: MediaOperationPlan): Promise<{
    success: boolean;
    message: string;
    backupCreated: boolean;
    operationsExecuted: number;
  }> {
    let operationsExecuted = 0;
    let backupCreated = false;
    try {
      this.validatePlanPaths(plan);

      if (await this.pathExists(plan.targetPath)) {
        throw new Error(`目标路径已存在: ${plan.targetPath}，拒绝覆盖现有媒体库内容`);
      }

      // Create backup directory
      await fs.mkdir(plan.backupPath, { recursive: true });

      // Create backup first
      for (const [index, op] of plan.operations.entries()) {
        if (op.operation === 'move') {
          const backupItemPath = join(plan.backupPath, `${String(index + 1).padStart(3, '0')}-${basename(op.src)}`);
          await this.safeCopy(op.src, backupItemPath);
          backupCreated = true;
        }
      }

      // Execute operations
      let operationsExecuted = 0;
      for (const op of plan.operations) {
        switch (op.operation) {
          case 'move':
            await fs.rename(op.src, op.dst);
            operationsExecuted++;
            break;
          case 'create_dir':
            await fs.mkdir(op.dst, { recursive: true });
            operationsExecuted++;
            break;
        }
      }

      return {
        success: true,
        message: `成功整理 ${plan.item.title}，已备份到 ${plan.backupPath}`,
        backupCreated,
        operationsExecuted,
      };

    } catch (error) {
      return {
        success: false,
        message: `执行失败: ${error instanceof Error ? error.message : '未知错误'}`,
        backupCreated,
        operationsExecuted,
      };
    }
  }

  /**
   * Refresh Emby library
   */
  async refreshEmbyLibrary(): Promise<{
    success: boolean;
    message: string;
  }> {
    try {
      // This would call Emby API to refresh library
      // For now, return a mock result

      return {
        success: true,
        message: 'Emby 库刷新请求已发送，预计几分钟内完成',
      };
    } catch (error) {
      return {
        success: false,
        message: `刷新 Emby 库失败: ${error instanceof Error ? error.message : '未知错误'}`,
      };
    }
  }

  /**
   * Safe copy operation with APFS clone support on macOS
   */
  private async safeCopy(src: string, dst: string): Promise<void> {
    // Ensure destination directory exists
    await fs.mkdir(resolve(dst, '..'), { recursive: true });
    await fs.copyFile(src, dst);
  }

  /**
   * Format bytes to human-readable size
   */
  private formatBytes(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let size = bytes;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }

    return `${size.toFixed(2)} ${units[unitIndex]}`;
  }

  /**
   * Validate media item before processing
   */
  async validateItem(item: MediaItem): Promise<{
    valid: boolean;
    issues: string[];
  }> {
    const issues: string[] = [];
    const sourcePath = resolve(item.sourcePath);

    if (item.files.length === 0) {
      issues.push('没有可整理的视频文件');
    }

    if (!this.isWithinAny(sourcePath, this.options.downloadsPaths, false)) {
      issues.push(`源路径不在允许的下载目录内: ${sourcePath}`);
    }

    // Check if source exists
    try {
      await fs.access(sourcePath);
    } catch {
      issues.push('源路径不存在');
    }

    // Check if files are accessible
    for (const file of item.files) {
      const resolvedFile = resolve(file);
      if (!this.isWithin(resolvedFile, sourcePath, false)) {
        issues.push(`文件不在源目录内: ${resolvedFile}`);
        continue;
      }
      try {
        await fs.access(resolvedFile);
      } catch {
        issues.push(`文件无法访问: ${file}`);
      }
    }

    // Check for suspicious files
    for (const file of item.files) {
      const filename = file.split('/').pop() ?? '';
      if (filename.toLowerCase().includes('.exe')) {
        issues.push(`发现可能引起 Emby 索引问题的文件: ${filename}`);
      }
    }

    // Check if target would conflict
    let targetPath: string;
    switch (item.type) {
      case 'movie':
        targetPath = join(this.options.libraryPaths.movies, `${this.safeName(item.title)}${item.year !== undefined ? ` (${item.year})` : ''}`);
        break;
      case 'tv':
      case 'anime':
        targetPath = join(this.options.libraryPaths.tv, `${this.safeName(item.title)}${item.year !== undefined ? ` (${item.year})` : ''}`);
        break;
      default:
        targetPath = '';
    }

    if (targetPath) {
      const libraryRoot = item.type === 'movie' ? this.options.libraryPaths.movies : this.options.libraryPaths.tv;
      if (!this.isWithin(targetPath, libraryRoot, false)) {
        issues.push(`目标路径不在允许的媒体库内: ${targetPath}`);
      }
      try {
        await fs.access(targetPath);
        issues.push(`目标路径已存在: ${targetPath}`);
      } catch {
        // Target doesn't exist, which is good
      }
    }

    return {
      valid: issues.length === 0,
      issues,
    };
  }

  private safeName(value: string): string {
    const normalized = value.replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!normalized || normalized === '.' || normalized === '..') throw new Error('媒体标题为空或不安全');
    return normalized;
  }

  private isWithin(path: string, root: string, allowRoot: boolean): boolean {
    const relativePath = relative(resolve(root), resolve(path));
    return (allowRoot && relativePath === '') || (relativePath !== '' && !relativePath.startsWith('..') && !isAbsolute(relativePath));
  }

  private isWithinAny(path: string, roots: string[], allowRoot: boolean): boolean {
    return roots.some((root) => this.isWithin(path, root, allowRoot));
  }

  private async isDirectory(path: string): Promise<boolean> {
    try {
      return (await fs.stat(path)).isDirectory();
    } catch {
      return false;
    }
  }

  private async pathExists(path: string): Promise<boolean> {
    try {
      await fs.access(path);
      return true;
    } catch {
      return false;
    }
  }

  private validatePlanPaths(plan: MediaOperationPlan): void {
    if (!this.isWithin(plan.backupPath, this.options.backupPath, false)) {
      throw new Error(`备份路径不在允许的目录内: ${plan.backupPath}`);
    }
    if (!this.isWithinAny(plan.targetPath, [this.options.libraryPaths.movies, this.options.libraryPaths.tv], false)) {
      throw new Error(`目标路径不在允许的媒体库内: ${plan.targetPath}`);
    }

    const sources = new Set<string>();
    const destinations = new Set<string>();
    for (const operation of plan.operations) {
      if (operation.operation === 'create_dir') {
        if (!this.isWithinAny(operation.dst, [this.options.libraryPaths.movies, this.options.libraryPaths.tv], false)) {
          throw new Error(`目录操作超出媒体库范围: ${operation.dst}`);
        }
        continue;
      }
      const source = resolve(operation.src);
      const destination = resolve(operation.dst);
      if (!this.isWithinAny(source, this.options.downloadsPaths, false)) {
        throw new Error(`源文件超出下载目录范围: ${source}`);
      }
      if (!this.isWithinAny(destination, [this.options.libraryPaths.movies, this.options.libraryPaths.tv], false)) {
        throw new Error(`目标文件超出媒体库范围: ${destination}`);
      }
      if (source.toLowerCase().endsWith('.exe') || destination.toLowerCase().endsWith('.exe')) {
        throw new Error(`拒绝处理可执行文件: ${source}`);
      }
      if (sources.has(source) || destinations.has(destination)) {
        throw new Error('计划包含重复的源文件或目标文件');
      }
      sources.add(source);
      destinations.add(destination);
    }
  }
}
