#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdir, readFile, readdir, rm, stat } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, '..');
const sourceDir = join(repoRoot, 'chrome_ext');
const distDir = join(repoRoot, 'dist');
const packageDir = join(distDir, 'chrome_ext');
const skipZip = process.argv.includes('--no-zip');

function extensionOf(pathName) {
  const match = /\.([^.\\/]+)$/.exec(pathName);
  return match ? `.${match[1]}` : '';
}

function assertExtensionPath(pathName, source) {
  if (typeof pathName !== 'string' || pathName.trim() === '') {
    throw new Error(`${source} must be a non-empty string`);
  }
  if (pathName.startsWith('/') || pathName.includes('..') || pathName.includes('\\')) {
    throw new Error(`${source} contains an invalid extension-relative path: ${pathName}`);
  }
}

function addFile(requiredFiles, pathName, source) {
  assertExtensionPath(pathName, source);
  requiredFiles.add(pathName);
}

function addIconMap(requiredFiles, icons, source) {
  if (!icons || typeof icons !== 'object') return;
  for (const [size, pathName] of Object.entries(icons)) {
    addFile(requiredFiles, pathName, `${source}.${size}`);
  }
}

function collectManifestFiles(manifest) {
  const requiredFiles = new Set(['manifest.json']);

  if (manifest.manifest_version !== 3) {
    throw new Error(`Expected manifest_version 3, found ${manifest.manifest_version}`);
  }
  if (!manifest.name || typeof manifest.name !== 'string') {
    throw new Error('manifest.name is required');
  }
  if (!/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(String(manifest.version || ''))) {
    throw new Error(`manifest.version must be numeric dot notation, found ${manifest.version}`);
  }

  if (manifest.background?.service_worker) {
    addFile(requiredFiles, manifest.background.service_worker, 'background.service_worker');
  }

  for (const [index, script] of (manifest.content_scripts || []).entries()) {
    for (const jsPath of script.js || []) {
      addFile(requiredFiles, jsPath, `content_scripts[${index}].js`);
    }
    for (const cssPath of script.css || []) {
      addFile(requiredFiles, cssPath, `content_scripts[${index}].css`);
    }
  }

  if (manifest.action?.default_popup) {
    addFile(requiredFiles, manifest.action.default_popup, 'action.default_popup');
  }
  addIconMap(requiredFiles, manifest.action?.default_icon, 'action.default_icon');

  if (manifest.options_page) {
    addFile(requiredFiles, manifest.options_page, 'options_page');
  }
  addIconMap(requiredFiles, manifest.icons, 'icons');

  for (const [index, resource] of (manifest.web_accessible_resources || []).entries()) {
    for (const resourcePath of resource.resources || []) {
      addFile(requiredFiles, resourcePath, `web_accessible_resources[${index}]`);
    }
  }

  return requiredFiles;
}

function collectHtmlReferences(html, filePath) {
  const references = [];
  const patterns = [
    /\s(?:src|href)=["']([^"']+)["']/gi,
    /\s(?:src|href)=([^"'\s>]+)/gi,
  ];

  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern)) {
      const target = match[1];
      if (!target || /^(?:https?:|data:|#|mailto:|chrome:)/i.test(target)) continue;
      assertExtensionPath(target, `${filePath} reference`);
      references.push(target);
    }
  }

  return references;
}

function collectCssImports(css, filePath) {
  const references = [];
  for (const match of css.matchAll(/@import\s+(?:url\()?["']?([^"')\s;]+)["']?\)?/gi)) {
    const target = match[1];
    if (!target || /^(?:https?:|data:)/i.test(target)) continue;
    assertExtensionPath(target, `${filePath} import`);
    references.push(target);
  }
  return references;
}

function collectRuntimeUrlReferences(js, filePath) {
  const references = [];
  const pattern = /chrome\.runtime\.getURL\(\s*["']([^"']+)["']\s*\)/g;
  for (const match of js.matchAll(pattern)) {
    assertExtensionPath(match[1], `${filePath} runtime URL`);
    references.push(match[1]);
  }
  return references;
}

async function fileExists(extensionPath) {
  return existsSync(join(sourceDir, extensionPath));
}

async function validateReferencedFiles(requiredFiles) {
  const queue = [...requiredFiles];
  const visited = new Set();

  while (queue.length > 0) {
    const current = queue.shift();
    if (visited.has(current)) continue;
    visited.add(current);

    const absolutePath = join(sourceDir, current);
    if (!existsSync(absolutePath)) {
      throw new Error(`Missing extension file referenced by build graph: ${current}`);
    }

    const extension = extensionOf(current);
    const content = await readFile(absolutePath, 'utf8').catch(() => null);
    if (content === null) continue;

    let references = [];
    if (extension === '.html') {
      references = collectHtmlReferences(content, current).map((target) =>
        target.startsWith('/') ? target.slice(1) : join(dirname(current), target)
      );
    } else if (extension === '.css') {
      references = collectCssImports(content, current).map((target) =>
        target.startsWith('/') ? target.slice(1) : join(dirname(current), target)
      );
    } else if (extension === '.js') {
      references = collectRuntimeUrlReferences(content, current);
    }

    for (const reference of references) {
      const normalized = reference.replaceAll('\\', '/');
      assertExtensionPath(normalized, `${current} reference`);
      if (!visited.has(normalized)) queue.push(normalized);
    }
  }

  return visited;
}

async function listFiles(dir, base = dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absolutePath = join(dir, entry.name);
    const relativePath = relative(base, absolutePath).replaceAll('\\', '/');

    if (relativePath === 'docs/tmp' || relativePath.startsWith('docs/tmp/')) {
      continue;
    }

    if (entry.isDirectory()) {
      files.push(...await listFiles(absolutePath, base));
    } else if (entry.isFile() && entry.name !== '.DS_Store') {
      files.push(relativePath);
    }
  }

  return files;
}

async function runSyntaxChecks(files) {
  const jsFiles = files.filter((file) => extensionOf(file) === '.js');
  for (const jsFile of jsFiles) {
    execFileSync(process.execPath, ['--check', join(sourceDir, jsFile)], {
      cwd: repoRoot,
      stdio: 'pipe',
    });
  }
  return jsFiles.length;
}

async function copyExtension(files) {
  await rm(distDir, { recursive: true, force: true });
  await mkdir(packageDir, { recursive: true });

  for (const file of files) {
    const sourcePath = join(sourceDir, file);
    const targetPath = join(packageDir, file);
    await mkdir(dirname(targetPath), { recursive: true });
    await cp(sourcePath, targetPath);
  }
}

async function createZip(manifest) {
  const zipName = `llm-burst-helper-${manifest.version}.zip`;
  const zipPath = join(distDir, zipName);

  try {
    execFileSync('zip', ['-r', '-q', zipPath, '.'], {
      cwd: packageDir,
      stdio: 'pipe',
    });
  } catch (error) {
    const detail = error.stderr ? String(error.stderr).trim() : error.message;
    throw new Error(`Failed to create ${zipName}. Ensure the system zip utility is installed. ${detail}`);
  }

  const info = await stat(zipPath);
  return { zipName, zipPath, size: info.size };
}

async function main() {
  if (!existsSync(sourceDir)) {
    throw new Error(`Extension source directory not found: ${sourceDir}`);
  }

  const manifestPath = join(sourceDir, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const requiredFiles = collectManifestFiles(manifest);
  const referencedFiles = await validateReferencedFiles(requiredFiles);
  const sourceFiles = await listFiles(sourceDir);
  const syntaxChecked = await runSyntaxChecks(sourceFiles);

  for (const file of referencedFiles) {
    if (!await fileExists(file)) {
      throw new Error(`Referenced file is missing after validation: ${file}`);
    }
  }

  await copyExtension(sourceFiles);

  let zipResult = null;
  if (!skipZip) {
    zipResult = await createZip(manifest);
  }

  console.log(`Built ${manifest.name} ${manifest.version}`);
  console.log(`Validated ${referencedFiles.size} referenced runtime files`);
  console.log(`Syntax-checked ${syntaxChecked} JavaScript files`);
  console.log(`Copied extension to ${relative(repoRoot, packageDir)}`);
  if (zipResult) {
    console.log(`Packaged ${zipResult.zipName} (${zipResult.size} bytes)`);
  }
}

main().catch((error) => {
  console.error(`Build failed: ${error.message}`);
  process.exit(1);
});
