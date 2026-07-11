#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import readline from 'node:readline/promises';
import { execFileSync } from 'node:child_process';
import { stdin as input, stdout as output } from 'node:process';
import { chromium } from 'playwright';
import { CURRENT_VERSION, runUpdate } from './updater.mjs';
import {
  OPID,
  ORIGIN,
  buildPdfUrl,
  buildSearchUrl,
  extractDois,
  extractRecordId,
  normalizeDoi,
  pdfFilename,
  resolveFromCwd
} from './helpers.mjs';

// EBSCO 的 CSS class 和元素 id 会变化；data-auto、详情路径和标题结构较稳定。
const FIRST_RESULT = 'a[href*="/search/details/"]:has(h3[data-auto="result-item-title"])';
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const KEYCHAIN_USERNAME_SERVICE = 'ebsco-must-doi-download.username';
const KEYCHAIN_PASSWORD_SERVICE = 'ebsco-must-doi-download.password';

class StatusLine {
  constructor(doi) {
    this.doi = doi;
    this.message = '';
    this.frame = 0;
    this.startedAt = Date.now();
    this.timer = undefined;
  }

  start(message) {
    this.message = message;
    this.startedAt = Date.now();
    if (output.isTTY) {
      this.render();
      this.timer = setInterval(() => this.render(), 200);
      this.timer.unref();
    } else {
      output.write(`[${this.doi}] ${message}`);
    }
  }

  update(message) {
    this.message = message;
    if (output.isTTY) this.render();
  }

  render() {
    const elapsed = Math.floor((Date.now() - this.startedAt) / 1000);
    const spinner = SPINNER_FRAMES[this.frame++ % SPINNER_FRAMES.length];
    output.write(`\r\x1b[2K${spinner} [${this.doi}] ${this.message} (${elapsed}s)`);
  }

  finish(symbol, message) {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    if (output.isTTY) {
      output.write(`\r\x1b[2K${symbol} [${this.doi}] ${message}\n`);
    } else {
      output.write(` -> ${message}\n`);
    }
  }

  success(message) {
    this.finish('✓', message);
  }

  failure(message) {
    this.finish('✗', message);
  }
}

class BatchProgress {
  constructor(total) {
    this.total = total;
    this.running = new Map();
    this.completed = 0;
    this.succeeded = 0;
    this.failed = 0;
    this.frame = 0;
    this.startedAt = Date.now();
    this.timer = undefined;
  }

  start() {
    if (output.isTTY) {
      this.render();
      this.timer = setInterval(() => this.render(), 200);
      this.timer.unref();
    } else {
      console.log(`批量下载开始：共 ${this.total} 篇。`);
    }
  }

  statusFor(doi) {
    return {
      start: (message) => this.running.set(doi, message),
      update: (message) => this.running.set(doi, message),
      success: (message) => {
        this.running.delete(doi);
        this.completed += 1;
        this.succeeded += 1;
        if (!output.isTTY) console.log(`✓ [${doi}] ${message}`);
      },
      failure: (message) => {
        this.running.delete(doi);
        this.completed += 1;
        this.failed += 1;
        if (!output.isTTY) console.error(`✗ [${doi}] ${message}`);
      }
    };
  }

  render() {
    const elapsed = Math.floor((Date.now() - this.startedAt) / 1000);
    const spinner = SPINNER_FRAMES[this.frame++ % SPINNER_FRAMES.length];
    const current = this.running.entries().next().value;
    const detail = current ? ` | ${current[0]}：${current[1]}` : '';
    output.write(
      `\r\x1b[2K${spinner} 批量进度 ${this.completed}/${this.total}`
      + ` | 运行 ${this.running.size} | 成功 ${this.succeeded} | 失败 ${this.failed}`
      + ` | ${elapsed}s${detail}`
    );
  }

  finish() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    const summary = `批量完成：共 ${this.total}，成功 ${this.succeeded}，失败 ${this.failed}`;
    if (output.isTTY) output.write(`\r\x1b[2K${this.failed ? '⚠' : '✓'} ${summary}\n`);
    else console.log(summary);
  }
}

function usage() {
  console.log(`
用法：
  ebsco-doi [选项] [DOI ...]
  ebsco-doi update [--check]

选项：
  -o, --output <目录>    PDF 保存目录（默认：downloads）
  -f, --file <文件>      从 TXT/CSV 提取 DOI（可重复使用）
  -c, --concurrency <数> 批量并发数：4 或 8（默认：4）
  --profile <目录>       浏览器持久配置目录（默认：.ebsco-profile）
  --headed               每次都显示浏览器窗口
  --reset-login          清除浏览器会话（Keychain 凭据保留）
  -v, --version          显示版本号
  -h, --help             显示帮助

不传 DOI 时进入交互模式；输入 q、quit 或 exit 退出。
`);
}

function parseArgs(argv) {
  const options = {
    outputDir: resolveFromCwd('downloads'),
    profileDir: resolveFromCwd('.ebsco-profile'),
    headed: false,
    resetLogin: false,
    concurrency: 4,
    files: [],
    dois: []
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') {
      options.help = true;
    } else if (arg === '--headed') {
      options.headed = true;
    } else if (arg === '--reset-login') {
      options.resetLogin = true;
    } else if (arg === '-o' || arg === '--output') {
      if (!argv[i + 1]) throw new Error(`${arg} 缺少目录参数`);
      options.outputDir = resolveFromCwd(argv[++i]);
    } else if (arg === '-f' || arg === '--file') {
      if (!argv[i + 1]) throw new Error(`${arg} 缺少文件参数`);
      options.files.push(resolveFromCwd(argv[++i]));
    } else if (arg === '-c' || arg === '--concurrency') {
      if (!argv[i + 1]) throw new Error(`${arg} 缺少并发数`);
      options.concurrency = Number(argv[++i]);
      if (![4, 8].includes(options.concurrency)) throw new Error('并发数只能是 4 或 8');
    } else if (arg === '--profile') {
      if (!argv[i + 1]) throw new Error('--profile 缺少目录参数');
      options.profileDir = resolveFromCwd(argv[++i]);
    } else if (arg.startsWith('-')) {
      throw new Error(`未知选项：${arg}`);
    } else if (/\.(?:txt|csv)$/i.test(arg)) {
      options.files.push(resolveFromCwd(arg));
    } else {
      options.dois.push(arg);
    }
  }
  options.loginMarker = path.join(options.profileDir, '.login-confirmed');
  options.storageState = path.join(options.profileDir, '.auth-state.json');
  return options;
}

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

async function collectInputDois(options) {
  const combined = [];
  for (const rawDoi of options.dois) combined.push(normalizeDoi(rawDoi));
  for (const file of options.files) {
    const text = await fs.readFile(file, 'utf8');
    const found = extractDois(text);
    console.log(`从 ${file} 提取到 ${found.length} 个 DOI。`);
    combined.push(...found);
  }

  const seen = new Set();
  return combined.filter((doi) => {
    const key = doi.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function promptForLogin(options, terminal) {
  console.log('首次运行：正在打开浏览器，请完成澳门科技大学代理/EBSCO 登录。');
  const context = await chromium.launchPersistentContext(options.profileDir, {
    headless: false,
    acceptDownloads: true
  });
  const page = context.pages()[0] ?? await context.newPage();
  try {
    await page.goto(`${ORIGIN}/c/${OPID}/search/advanced`, {
      waitUntil: 'domcontentloaded',
      timeout: 120_000
    });
    while (true) {
      await terminal.question('登录成功并看到 EBSCO 页面后，回到这里按 Enter 继续...');
      if (isEbscoPage(page.url())) break;
      console.log(`尚未进入 EBSCO（当前：${new URL(page.url()).hostname}），请完成登录后再确认。`);
    }
    await fs.mkdir(options.profileDir, { recursive: true });
    await context.storageState({ path: options.storageState });
    await fs.writeFile(options.loginMarker, `${new Date().toISOString()}\n`, 'utf8');
  } catch (error) {
    await context.close();
    throw error;
  }
  console.log('登录状态已保存。');
  // MUST 可能使用会话 Cookie，因此登录后必须沿用当前浏览器，不能立即关闭重开。
  return { context, page };
}

function isEbscoPage(url) {
  try {
    return new URL(url).hostname === new URL(ORIGIN).hostname;
  } catch {
    return false;
  }
}

async function launchContext(options) {
  const context = await chromium.launchPersistentContext(options.profileDir, {
    headless: !options.headed,
    acceptDownloads: true
  });
  if (await exists(options.storageState)) {
    try {
      const state = JSON.parse(await fs.readFile(options.storageState, 'utf8'));
      if (Array.isArray(state.cookies) && state.cookies.length > 0) {
        await context.addCookies(state.cookies);
      }
    } catch (error) {
      await context.close();
      throw new Error(`无法恢复登录状态：${error.message}`, { cause: error });
    }
  }
  return context;
}

function readKeychainValue(service) {
  if (process.platform !== 'darwin') return undefined;
  try {
    return execFileSync('security', ['find-generic-password', '-s', service, '-w'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
  } catch {
    return undefined;
  }
}

function loadCredentials() {
  const username = process.env.EBSCO_USERNAME || readKeychainValue(KEYCHAIN_USERNAME_SERVICE);
  const password = process.env.EBSCO_PASSWORD || readKeychainValue(KEYCHAIN_PASSWORD_SERVICE);
  return username && password ? { username, password } : undefined;
}

async function saveAuthenticatedState(context, options) {
  await fs.mkdir(options.profileDir, { recursive: true });
  await context.storageState({ path: options.storageState });
  await fs.writeFile(options.loginMarker, `${new Date().toISOString()}\n`, 'utf8');
}

async function tryAutomaticLogin(page, context, options) {
  const credentials = loadCredentials();
  if (!credentials || new URL(page.url()).hostname !== 'login.must.edu.mo') return false;

  output.write('检测到 MUST 登录页，正在使用 macOS Keychain 自动登录...');
  try {
    await page.getByRole('textbox', { name: 'Account Name' }).fill(credentials.username);
    await page.getByRole('textbox', { name: 'Password' }).fill(credentials.password);
    const consent = page.getByRole('checkbox');
    if (!(await consent.isChecked())) await consent.check();
    await Promise.all([
      page.waitForURL((url) => isEbscoPage(url.href), { timeout: 120_000 }),
      page.getByRole('button', { name: 'Login', exact: true }).click()
    ]);
    await saveAuthenticatedState(context, options);
    output.write('成功。\n');
    return true;
  } catch (error) {
    output.write('失败，将切换到手动登录。\n');
    return false;
  }
}

async function openAuthenticatedContext(options, terminal) {
  let context = await launchContext(options);
  let page = context.pages()[0] ?? await context.newPage();
  output.write('正在验证登录状态...');

  try {
    await page.goto(`${ORIGIN}/c/${OPID}/search/advanced`, {
      waitUntil: 'domcontentloaded',
      timeout: 90_000
    });
  } catch (error) {
    if (isEbscoPage(page.url())) {
      output.write('已登录。\n');
      return { context, page };
    }
    await context.close();
    throw new Error(`无法验证登录状态：${error.message}`, { cause: error });
  }

  if (isEbscoPage(page.url())) {
    await saveAuthenticatedState(context, options);
    output.write('已登录。\n');
    return { context, page };
  }

  if (await tryAutomaticLogin(page, context, options)) {
    return { context, page };
  }

  output.write('会话已过期，需要重新登录。\n');
  await context.close();
  await fs.rm(options.loginMarker, { force: true });
  await fs.rm(options.storageState, { force: true });
  return promptForLogin(options, terminal);
}

async function findFirstResult(page, searchUrl, status) {
  let lastError;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    status.update(attempt === 1 ? '正在搜索网页，等待第一条结果' : '页面响应较慢，正在重试搜索');
    try {
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 90_000 });
      const first = page.locator(FIRST_RESULT).first();
      await first.waitFor({ state: 'visible', timeout: 45_000 });
      const href = await first.getAttribute('href');
      if (!href) throw new Error('首条搜索结果没有 href 属性。');
      return href;
    } catch (error) {
      lastError = error;
    }
  }

  const currentUrl = page.url();
  if (!isEbscoPage(currentUrl)) {
    throw new Error(`登录可能已失效（当前页面：${currentUrl}）。请使用 --reset-login 重新登录。`, { cause: lastError });
  }
  throw new Error('两次搜索均未找到首条全文结果；请确认 DOI 有全文结果，或用 --headed 查看页面。', { cause: lastError });
}

async function fetchPdf(context, pdfUrl, referer, status) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    status.update(attempt === 1 ? '正在下载 PDF' : `下载请求失败，正在进行第 ${attempt} 次尝试`);
    try {
      const response = await context.request.get(pdfUrl, {
        headers: {
          referer,
          accept: 'application/pdf,application/octet-stream;q=0.9,*/*;q=0.8'
        },
        timeout: 120_000
      });
      if (!response.ok()) {
        const error = new Error(`PDF 请求失败：HTTP ${response.status()} ${response.statusText()}`);
        if (response.status() === 401 || response.status() === 403) throw error;
        lastError = error;
      } else {
        const body = await response.body();
        const contentType = response.headers()['content-type'] ?? '';
        if (!body.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
          throw new Error(`服务器没有返回 PDF（Content-Type: ${contentType || '未知'}）；登录可能已失效。`);
        }
        return body;
      }
    } catch (error) {
      lastError = error;
      if (/HTTP (401|403)\b/.test(error.message) || /没有返回 PDF/.test(error.message)) throw error;
    }
    if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 750));
  }
  throw lastError ?? new Error('PDF 下载失败。');
}

async function downloadOne(context, page, rawDoi, outputDir, suppliedStatus) {
  const doi = normalizeDoi(rawDoi);
  const searchUrl = buildSearchUrl(doi);
  const status = suppliedStatus ?? new StatusLine(doi);
  status.start('正在搜索网页，等待第一条结果');
  try {
    const href = await findFirstResult(page, searchUrl, status);
    const recordId = extractRecordId(href);
    const pdfUrl = buildPdfUrl(recordId);
    status.update(`已找到首条结果（${recordId}），正在下载 PDF`);

    const body = await fetchPdf(context, pdfUrl, new URL(href, ORIGIN).href, status);
    status.update('下载完成，正在写入文件');

    await fs.mkdir(outputDir, { recursive: true });
    const destination = path.join(outputDir, pdfFilename(doi));
    const temporary = `${destination}.tmp`;
    await fs.writeFile(temporary, body);
    await fs.rename(temporary, destination);
    status.success(`已保存：${destination}`);
    return destination;
  } catch (error) {
    status.failure(`失败：${error.message}`);
    error.statusReported = true;
    throw error;
  }
}

async function downloadBatch(context, firstPage, dois, options) {
  const workerCount = Math.min(options.concurrency, dois.length);
  const pages = [firstPage];
  const extraPages = await Promise.all(
    Array.from({ length: workerCount - 1 }, () => context.newPage())
  );
  pages.push(...extraPages);

  const progress = new BatchProgress(dois.length);
  const errors = [];
  let cursor = 0;
  progress.start();

  const worker = async (page) => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= dois.length) return;
      const doi = dois[index];
      try {
        await downloadOne(context, page, doi, options.outputDir, progress.statusFor(doi));
      } catch (error) {
        errors.push({ doi, message: error.message });
      }
    }
  };

  try {
    await Promise.all(pages.map(worker));
  } finally {
    progress.finish();
    await Promise.all(extraPages.map((page) => page.close().catch(() => {})));
  }

  if (errors.length > 0) {
    console.error('失败明细：');
    for (const error of errors) console.error(`- ${error.doi}：${error.message}`);
  }
  return errors.length;
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv[0] === 'update') {
    const unknown = argv.slice(1).filter((arg) => arg !== '--check');
    if (unknown.length > 0) throw new Error(`update 的未知选项：${unknown.join(', ')}`);
    await runUpdate({ checkOnly: argv.includes('--check') });
    return;
  }
  if (argv.includes('-v') || argv.includes('--version')) {
    console.log(`ebsco-doi v${CURRENT_VERSION}`);
    return;
  }

  const options = parseArgs(argv);
  if (options.help) {
    usage();
    return;
  }

  const terminal = readline.createInterface({ input, output });
  let context;
  let failures = 0;
  try {
    const inputDois = await collectInputDois(options);
    if (options.files.length > 0 && inputDois.length === 0) {
      throw new Error('输入文件中没有提取到有效 DOI。');
    }
    if (options.resetLogin) {
      await fs.rm(options.profileDir, { recursive: true, force: true });
    }
    const authenticated = await openAuthenticatedContext(options, terminal);
    context = authenticated.context;
    const page = authenticated.page;

    const processDoi = async (value) => {
      try {
        await downloadOne(context, page, value, options.outputDir);
      } catch (error) {
        failures += 1;
        if (!error.statusReported) console.error(`[失败] ${error.message}`);
      }
    };

    if (inputDois.length > 1 || options.files.length > 0) {
      console.log(`去重后共 ${inputDois.length} 个 DOI，使用 ${Math.min(options.concurrency, inputDois.length)} 个并发 worker。`);
      failures += await downloadBatch(context, page, inputDois, options);
    } else if (inputDois.length === 1) {
      await processDoi(inputDois[0]);
    } else {
      console.log('后台浏览器已启动。请输入 DOI；输入 q 退出。');
      while (true) {
        const answer = (await terminal.question('DOI> ')).trim();
        if (!answer) continue;
        if (/^(q|quit|exit)$/i.test(answer)) break;
        await processDoi(answer);
      }
    }
  } finally {
    if (context) {
      try {
        await context.storageState({ path: options.storageState });
      } catch {
        // 保留原始错误；保存认证状态失败不应掩盖下载结果。
      }
      await context.close();
    }
    terminal.close();
  }

  if (failures > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`错误：${error.message}`);
  process.exitCode = 1;
});
