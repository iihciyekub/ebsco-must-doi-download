import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

export const REPOSITORY = 'iihciyekub/ebsco-must-doi-download';
const packageJson = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8')
);
export const CURRENT_VERSION = packageJson.version;

export function normalizeVersion(tag) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(tag.trim());
  if (!match) throw new Error(`GitHub Release 版本号格式无效：${tag}`);
  return {
    tag: `v${match[1]}.${match[2]}.${match[3]}${match[4] ? `-${match[4]}` : ''}`,
    parts: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4]
  };
}

export function compareVersions(left, right) {
  const a = normalizeVersion(left);
  const b = normalizeVersion(right);
  for (let i = 0; i < 3; i += 1) {
    if (a.parts[i] !== b.parts[i]) return a.parts[i] > b.parts[i] ? 1 : -1;
  }
  if (a.prerelease === b.prerelease) return 0;
  if (!a.prerelease) return 1;
  if (!b.prerelease) return -1;
  return a.prerelease.localeCompare(b.prerelease);
}

async function latestReleaseFromApi() {
  const response = await fetch(`https://api.github.com/repos/${REPOSITORY}/releases/latest`, {
    headers: {
      accept: 'application/vnd.github+json',
      'user-agent': `ebsco-doi/${CURRENT_VERSION}`
    },
    signal: AbortSignal.timeout(15_000)
  });
  if (!response.ok) throw new Error(`GitHub API HTTP ${response.status}`);
  const release = await response.json();
  return release.tag_name;
}

function latestReleaseFromGh() {
  return execFileSync(
    'gh',
    ['release', 'view', '--repo', REPOSITORY, '--json', 'tagName', '--jq', '.tagName'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
  ).trim();
}

export async function getLatestReleaseTag() {
  try {
    return normalizeVersion(await latestReleaseFromApi()).tag;
  } catch (apiError) {
    try {
      return normalizeVersion(latestReleaseFromGh()).tag;
    } catch {
      throw new Error(
        `无法查询 GitHub 最新 Release，请检查网络连接。(${apiError.message})`
      );
    }
  }
}

export async function runUpdate({ checkOnly = false } = {}) {
  process.stdout.write(`正在检查 ${REPOSITORY} 的最新版本...`);
  const latestTag = await getLatestReleaseTag();
  const currentTag = normalizeVersion(CURRENT_VERSION).tag;
  const comparison = compareVersions(latestTag, currentTag);

  if (comparison <= 0) {
    console.log(`当前已是最新版本 ${currentTag}。`);
    return;
  }
  console.log(`发现 ${latestTag}（当前 ${currentTag}）。`);
  if (checkOnly) return;

  const temporaryDir = mkdtempSync(path.join(tmpdir(), 'ebsco-doi-update-'));
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  try {
    console.log('正在下载公开 GitHub Release 安装包...');
    const version = latestTag.slice(1);
    const filename = `${packageJson.name}-${version}.tgz`;
    const archive = path.join(temporaryDir, filename);
    const downloadUrl = `https://github.com/${REPOSITORY}/releases/download/${latestTag}/${filename}`;
    const response = await fetch(downloadUrl, {
      headers: { 'user-agent': `ebsco-doi/${CURRENT_VERSION}` },
      signal: AbortSignal.timeout(120_000)
    });
    if (!response.ok) throw new Error(`Release 下载失败：HTTP ${response.status}`);
    writeFileSync(archive, Buffer.from(await response.arrayBuffer()));

    console.log('正在替换全局安装版本...');
    spawnSync(npm, ['uninstall', '--global', packageJson.name], { stdio: 'inherit' });
    const result = spawnSync(npm, ['install', '--global', archive], { stdio: 'inherit' });
    if (result.error) throw new Error(`无法启动 npm：${result.error.message}`);
    if (result.status !== 0) throw new Error(`npm 更新失败，退出码 ${result.status}`);
  } finally {
    rmSync(temporaryDir, { recursive: true, force: true });
  }

  console.log(`更新完成：${currentTag} -> ${latestTag}`);
  console.log('如果 Playwright 提示缺少浏览器，请运行：npx playwright install chromium');
}
