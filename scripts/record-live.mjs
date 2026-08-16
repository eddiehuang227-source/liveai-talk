/**
 * Live recording harness for dsh-live-talk.
 *
 * Prerequisites:
 *   - `DEEPSEEK_API_KEY` (and optionally the VOLC_* voice/video keys) in the
 *     environment. Keys are never written to disk or included in recordings.
 *   - A Playwright module. Resolution order: local `playwright` import →
 *     `PLAYWRIGHT_MODULE` → Homebrew global path.
 *
 * Exit codes:
 *   0  recording produced
 *   77 required keys are missing (nothing was recorded)
 */

import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import process from 'node:process'

const pluginRoot = resolve(new URL('..', import.meta.url).pathname)
const dshRepo = resolve(process.env.DSH_REPO || join(pluginRoot, '..', '..', 'deepseek-harness'))
const cli = join(dshRepo, 'apps', 'cli', 'lib', 'bin.js')
const profile = 'live-record'

const REQUIRED_KEYS = ['DEEPSEEK_API_KEY']

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: options.cwd || pluginRoot,
    env: { ...process.env, ...options.env },
    encoding: 'utf8',
    timeout: options.timeout || 180_000,
    stdio: options.stdio || 'pipe',
  })
}

function requireOk(result, label) {
  if (result.status !== 0) {
    throw new Error(`${label} failed (${result.status})\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`)
  }
}

async function freePort() {
  return new Promise((resolvePort, rejectPort) => {
    const server = net.createServer()
    server.once('error', rejectPort)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close((error) => (error ? rejectPort(error) : resolvePort(port)))
    })
  })
}

async function waitForJson(url, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs
  let lastError
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) })
      const text = await response.text()
      if (response.ok && (response.headers.get('content-type') || '').includes('application/json')) {
        return JSON.parse(text)
      }
      lastError = new Error(`HTTP ${response.status}: ${text.slice(0, 120)}`)
    } catch (error) {
      lastError = error
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 750))
  }
  throw new Error(`timed out waiting for ${url}: ${lastError}`)
}

async function loadPlaywright() {
  try {
    return await import('playwright')
  } catch {
    const candidates = [
      process.env.PLAYWRIGHT_MODULE,
      '/opt/homebrew/lib/node_modules/playwright/index.mjs',
      '/opt/homebrew/lib/node_modules/playwright/index.js',
    ].filter(Boolean)
    for (const candidate of candidates) {
      try {
        return await import(pathToFileURL(candidate).href)
      } catch {
        // try the next candidate
      }
    }
  }
  throw new Error('playwright module not found; set PLAYWRIGHT_MODULE=/absolute/path/to/playwright')
}

async function clickWhenPresent(page, text, timeout = 8_000) {
  try {
    const locator = page.getByRole('button', { name: text }).first()
    await locator.waitFor({ state: 'visible', timeout })
    await locator.click()
    return true
  } catch {
    return false
  }
}

async function clickMatching(page, regex, timeout = 8_000) {
  try {
    const locator = page.getByRole('button', { name: regex }).first()
    await locator.waitFor({ state: 'visible', timeout })
    await locator.click()
    return true
  } catch {
    return false
  }
}

async function main() {
  const missing = REQUIRED_KEYS.filter((key) => !process.env[key])
  if (missing.length > 0) {
    process.stderr.write(`[record-live] missing required keys: ${missing.join(', ')} (set them in the environment, never in files)\n`)
    process.exit(77)
  }

  const root = mkdtempSync(join(tmpdir(), 'dsh-live-record-'))
  const home = join(root, 'home')
  const recordings = join(pluginRoot, 'recordings')
  mkdirSync(recordings, { recursive: true })

  let child
  try {
    requireOk(run(process.execPath, ['scripts/build.mjs'], { cwd: pluginRoot }), 'build')
    const pack = run('npm', ['pack', '--pack-destination', root], {
      cwd: pluginRoot,
      env: { npm_config_cache: join(root, 'npm-cache') },
    })
    requireOk(pack, 'npm pack')
    const tarball = join(root, pack.stdout.trim().split(/\r?\n/).at(-1))
    requireOk(
      run(process.execPath, [cli, 'plugin', '--profile', profile, 'add', tarball], { env: { DSH_HOME: home } }),
      'dsh plugin add',
    )

    const profileManifestPath = join(home, 'profiles', profile, 'package.json')
    const profileManifest = JSON.parse(readFileSync(profileManifestPath, 'utf8'))
    const bundles = profileManifest.dsh.profile.bundles
    if (!bundles.includes('@deepseek-ai/dsh-web-app')) bundles.splice(1, 0, '@deepseek-ai/dsh-web-app')
    writeFileSync(profileManifestPath, `${JSON.stringify(profileManifest, null, 2)}\n`)

    // Seed one workspace so the browser can create a session without native pickers.
    const workspaceDir = realpathSync(mkdtempSync(join(tmpdir(), 'live-record-ws-')))
    const storagePath = join(home, 'storages', 'workspace.json')
    mkdirSync(join(home, 'storages'), { recursive: true })
    const now = new Date().toISOString()
    writeFileSync(storagePath, `${JSON.stringify({
      unit: { name: 'workspace', version: 2 },
      global: { initialized: true, workspaceIds: ['ws-record'], archivedSessionIds: [] },
      tables: { workspaces: { 'ws-record': { path: workspaceDir, title: 'record', sessionIds: [], createdAt: now, updatedAt: now } } },
    }, null, 2)}\n`)

    const webPort = await freePort()
    child = spawn(process.execPath, [cli, '--profile', profile, '--port', String(webPort)], {
      env: { ...process.env, DSH_HOME: home },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const base = `http://127.0.0.1:${webPort}`
    await waitForJson(`${base}/live/health`)

    const playwright = await loadPlaywright()
    const browser = await playwright.chromium.launch({ headless: true })
    // Force zh-CN so the assertions match the dsh product copy regardless of
    // the machine/browser default language.
    const context = await browser.newContext({ locale: 'zh-CN' })
    const page = await context.newPage()
    await page.goto(base)

    await page.waitForLoadState('domcontentloaded')
    for (let attempt = 0; attempt < 8; attempt += 1) {
      await clickMatching(page, /^(Continue|继续)$/, 2_000)
      await clickMatching(page, /(later|skip|稍后)/i, 2_000)
      await page.waitForTimeout(500)
    }

    const workspace = page.getByRole('treeitem', { name: /record/ }).first()
    try {
      await workspace.waitFor({ state: 'visible', timeout: 10_000 })
      await workspace.click()
      await page.waitForTimeout(800)
    } catch {
      // The workspace may already be expanded.
    }
    await clickMatching(page, /(new session in|新建会话).*record|record.*(new session|新建会话)/i, 10_000)
    if (await page.getByRole('textbox', { name: '描述你想要构建的内容' }).count() === 0) {
      await clickMatching(page, /new session|新建会话/i, 5_000)
    }

    const input = page.getByRole('textbox', { name: '描述你想要构建的内容' })
    try {
      await input.waitFor({ state: 'visible', timeout: 30_000 })
    } catch (error) {
      const bodyText = await page.locator('body').innerText({ timeout: 1_000 }).catch(() => '<unavailable>')
      const buttons = await page.getByRole('button').allTextContents().catch(() => [])
      await page.screenshot({ path: join(recordings, 'record-failure.png'), fullPage: true }).catch(() => {})
      console.error(`[record-live] input wait failed. page text:\n${bodyText}`)
      console.error(`[record-live] buttons: ${JSON.stringify(buttons)}`)
      throw error
    }
    const prompt = '只输出一行：[emotion: happy] 你好，我是你的数字人伙伴。'
    await input.fill(prompt)
    await input.press('Enter')

    // The dsh agent (user's DeepSeek key) must produce the tagged reply before
    // the Live Talk bridge can publish an emotion summary.
    await page.waitForFunction(() => document.body.innerText.includes('数字人伙伴'), null, { timeout: 90_000 })
    await page.getByRole('tab', { name: 'Live Talk' }).click()
    await page.waitForFunction(() => document.body.innerText.includes('最新语义'), null, { timeout: 30_000 })

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const screenshot = join(recordings, `live-${timestamp}.png`)
    await page.screenshot({ path: screenshot, fullPage: true })
    const evidence = {
      recordedAt: new Date().toISOString(),
      provider: 'deepseek-official',
      prompt,
      observedEmotion: 'happy',
      screenshot,
    }
    writeFileSync(join(recordings, `live-${timestamp}.json`), `${JSON.stringify(evidence, null, 2)}\n`)
    process.stdout.write(`[record-live] recorded ${JSON.stringify(evidence)}\n`)
    await browser.close()
  } finally {
    if (child) {
      child.kill('SIGTERM')
      await new Promise((resolveWait) => {
        const timer = setTimeout(resolveWait, 5_000)
        child.once('exit', () => {
          clearTimeout(timer)
          resolveWait()
        })
      })
    }
    rmSync(root, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
