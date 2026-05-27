/**
 * Project Indexer — reads ALL files from WebContainer to build a complete project map.
 * Used by auto-fix system to give AI full context of what exists.
 */

import type { WebContainer } from '@webcontainer/api';

export interface ProjectIndex {
  rootFiles: string[];
  srcFiles: string[];
  componentFiles: string[];
  pageFiles: string[];
  hookFiles: string[];
  utilFiles: string[];
  styleFiles: string[];
  otherDirs: string[];
  packageJson: string;
  appJsx: string;
  mainJsx: string;
  viteConfig: string;
  indexHtml: string;
  allFileContents: Map<string, string>;
  deps: string[];
  devDeps: string[];
  scripts: Record<string, string>;
  totalFiles: number;
  totalSize: number;
}

const MAX_FILE_READ_SIZE = 50000; // 50KB max per file
const MAX_CONTENT_IN_REPORT = 8000; // Max chars per file in report

/**
 * Recursively list all files in a directory
 */
async function listAllFiles(wc: WebContainer, dir: string): Promise<string[]> {
  const files: string[] = [];
  try {
    const entries = await wc.fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = dir === '/home/project' ? entry.name : dir.replace('/home/project/', '') + '/' + entry.name;
      if (entry.isDirectory()) {
        // Skip node_modules, .git, dist
        if (['node_modules', '.git', 'dist', '.cache'].includes(entry.name)) continue;
        const subFiles = await listAllFiles(wc, dir + '/' + entry.name);
        files.push(...subFiles);
      } else {
        files.push(fullPath);
      }
    }
  } catch {}
  return files;
}

/**
 * Read a single file from WebContainer
 */
async function readFile(wc: WebContainer, path: string): Promise<string> {
  try {
    const content = await wc.fs.readFile(path, 'utf-8');
    return content.length > MAX_FILE_READ_SIZE ? content.substring(0, MAX_FILE_READ_SIZE) + '\n... (truncated)' : content;
  } catch {
    return '';
  }
}

/**
 * Index the entire project in WebContainer
 */
export async function indexProject(wc: WebContainer): Promise<ProjectIndex> {
  const index: ProjectIndex = {
    rootFiles: [],
    srcFiles: [],
    componentFiles: [],
    pageFiles: [],
    hookFiles: [],
    utilFiles: [],
    styleFiles: [],
    otherDirs: [],
    packageJson: '',
    appJsx: '',
    mainJsx: '',
    viteConfig: '',
    indexHtml: '',
    allFileContents: new Map(),
    deps: [],
    devDeps: [],
    scripts: {},
    totalFiles: 0,
    totalSize: 0,
  };

  // List all files recursively
  const allFiles = await listAllFiles(wc, '/home/project');
  index.totalFiles = allFiles.length;

  // Categorize files
  for (const file of allFiles) {
    if (file.startsWith('src/components/')) index.componentFiles.push(file);
    else if (file.startsWith('src/pages/') || file.startsWith('src/views/')) index.pageFiles.push(file);
    else if (file.startsWith('src/hooks/')) index.hookFiles.push(file);
    else if (file.startsWith('src/utils/') || file.startsWith('src/lib/') || file.startsWith('src/helpers/')) index.utilFiles.push(file);
    else if (file.endsWith('.css') || file.endsWith('.scss') || file.endsWith('.module.css')) index.styleFiles.push(file);
    else if (file.startsWith('src/')) index.srcFiles.push(file);
    else index.rootFiles.push(file);
  }

  // Read key files
  index.packageJson = await readFile(wc, '/home/project/package.json');
  index.appJsx = await readFile(wc, '/home/project/src/App.jsx') || await readFile(wc, '/home/project/src/App.tsx') || '';
  index.mainJsx = await readFile(wc, '/home/project/src/main.jsx') || await readFile(wc, '/home/project/src/main.tsx') || '';
  index.viteConfig = await readFile(wc, '/home/project/vite.config.js') || await readFile(wc, '/home/project/vite.config.ts') || '';
  index.indexHtml = await readFile(wc, '/home/project/index.html');

  // Parse package.json
  try {
    const pkg = JSON.parse(index.packageJson);
    index.deps = Object.keys(pkg.dependencies || {});
    index.devDeps = Object.keys(pkg.devDependencies || {});
    index.scripts = pkg.scripts || {};
  } catch {}

  // Read ALL source files (up to 50 files)
  const sourceFiles = allFiles.filter(f =>
    f.endsWith('.jsx') || f.endsWith('.tsx') || f.endsWith('.js') || f.endsWith('.ts') ||
    f.endsWith('.css') || f.endsWith('.scss') || f.endsWith('.html') ||
    f.endsWith('.json') || f.endsWith('.config.')
  ).slice(0, 50);

  let totalSize = 0;
  for (const file of sourceFiles) {
    const path = file.startsWith('/') ? file : '/home/project/' + file;
    const content = await readFile(wc, path);
    if (content) {
      index.allFileContents.set(file, content);
      totalSize += content.length;
    }
  }
  index.totalSize = totalSize;

  return index;
}

/**
 * Format project index for AI consumption
 */
export function formatProjectIndex(index: ProjectIndex): string {
  const lines: string[] = [
    '=== PROJECT FILE INDEX ===',
    'Total files: ' + index.totalFiles,
    '',
    'ROOT FILES:',
    ...index.rootFiles.map(f => '  ' + f),
    '',
    'SRC FILES:',
    ...index.srcFiles.map(f => '  ' + f),
    '',
  ];

  if (index.componentFiles.length > 0) {
    lines.push('COMPONENTS:', ...index.componentFiles.map(f => '  ' + f), '');
  }
  if (index.pageFiles.length > 0) {
    lines.push('PAGES:', ...index.pageFiles.map(f => '  ' + f), '');
  }
  if (index.hookFiles.length > 0) {
    lines.push('HOOKS:', ...index.hookFiles.map(f => '  ' + f), '');
  }
  if (index.utilFiles.length > 0) {
    lines.push('UTILS:', ...index.utilFiles.map(f => '  ' + f), '');
  }
  if (index.styleFiles.length > 0) {
    lines.push('STYLES:', ...index.styleFiles.map(f => '  ' + f), '');
  }

  lines.push(
    'DEPENDENCIES: ' + index.deps.join(', '),
    'DEV DEPENDENCIES: ' + index.devDeps.join(', '),
    'SCRIPTS: ' + Object.entries(index.scripts).map(([k, v]) => k + ': ' + v).join(', '),
    '',
  );

  // Include key file contents
  if (index.packageJson) {
    lines.push('=== package.json ===', index.packageJson.substring(0, MAX_CONTENT_IN_REPORT), '');
  }
  if (index.appJsx) {
    lines.push('=== src/App.jsx ===', index.appJsx.substring(0, MAX_CONTENT_IN_REPORT), '');
  }
  if (index.mainJsx) {
    lines.push('=== src/main.jsx ===', index.mainJsx.substring(0, MAX_CONTENT_IN_REPORT), '');
  }

  // Include component contents (up to 6KB total)
  let componentContent = '';
  for (const [path, content] of index.allFileContents) {
    if (path === 'package.json' || path === 'src/App.jsx' || path === 'src/main.jsx') continue;
    if (componentContent.length > 6000) break;
    componentContent += '\n=== ' + path + ' ===\n' + content.substring(0, 2000) + '\n';
  }
  if (componentContent) {
    lines.push('=== OTHER SOURCE FILES ===', componentContent);
  }

  return lines.join('\n');
}
