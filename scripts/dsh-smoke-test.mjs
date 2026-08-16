/**
 * End-to-end smoke test against a source checkout of DeepSeek Harness.
 *
 *   DSH_REPO=/path/to/deepseek-harness npm run test:integration
 */

import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import process from 'node:process'

const pluginRoot = resolve(new URL('..', import.meta.url).pathname)
const dshRepo = resolve(process.env.DSH_REPO || join(pluginRoot, '..', '..', 'deepseek-harness'))
const cli = join(dshRepo, 'apps', 'cli', 'lib', 'bin.js')
const profile = 'flowact-it'

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
      const contentType = response.headers.get('content-type') || ''
      if (response.ok === false) {
        lastError = new Error(`HTTP ${response.status}: ${text.slice(0, 120)}`)
      } else if (contentType.includes('application/json') === false) {
        lastError = new Error(`non-JSON response for ${url}: ${text.slice(0, 120)}`)
      } else {
        return JSON.parse(text)
      }
    } catch (error) {
      lastError = error
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 750))
  }
  throw new Error(`timed out waiting for ${url}: ${lastError}`)
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), 'dsh-flowact-avatar-it-'))
  const home = join(root, 'home')

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
  if (bundles.includes('@deepseek-ai/dsh-web-app') === false) {
    bundles.splice(1, 0, '@deepseek-ai/dsh-web-app')
  }
  writeFileSync(profileManifestPath, `${JSON.stringify(profileManifest, null, 2)}\n`)

  const dump = run(process.execPath, [cli, '--profile', profile, '--dump-config'], { env: { DSH_HOME: home } })
  requireOk(dump, 'dsh --dump-config')
  if (dump.stdout.includes('flowact-avatar') === false) {
    throw new Error(`dump-config does not contain flowact-avatar:\n${dump.stdout}`)
  }

  const webPort = await freePort()
  const child = spawn(process.execPath, [cli, '--profile', profile, '--port', String(webPort)], {
    env: { ...process.env, DSH_HOME: home },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.on('data', () => {})
  child.stderr.on('data', () => {})

  try {
    const base = `http://127.0.0.1:${webPort}`
    const health = await waitForJson(`${base}/flowact/health`)
    if (health.plugin !== 'dsh-flowact-avatar') {
      throw new Error(`unexpected health payload: ${JSON.stringify(health)}`)
    }
    if (health.seams?.asr?.capability !== 'asr' || health.seams?.tts?.capability !== 'tts') {
      throw new Error(`unexpected seam metadata: ${JSON.stringify(health.seams)}`)
    }

    const characters = await waitForJson(`${base}/flowact/characters`)
    if (characters.characters.some((character) => character.id === 'chie') === false) {
      throw new Error(`chie is missing from ${JSON.stringify(characters)}`)
    }

    const pipelineMeta = await waitForJson(`${base}/flowact/pipeline`)
    if (pipelineMeta.capabilities.includes('emotion-parse') === false) {
      throw new Error(`pipeline metadata is incomplete: ${JSON.stringify(pipelineMeta)}`)
    }

    const seams = await waitForJson(`${base}/flowact/seams`)
    if (seams.seams.asr.providers.some((provider) => provider.id === 'doubao') === false) {
      throw new Error(`doubao ASR provider is not registered: ${JSON.stringify(seams.seams.asr)}`)
    }
    if (seams.seams.tts.providers.some((provider) => provider.id === 'doubao') === false) {
      throw new Error(`doubao TTS provider is not registered: ${JSON.stringify(seams.seams.tts)}`)
    }
    if (seams.seams.avatarMedia.providers.some((provider) => provider.id === 'jimeng') === false) {
      throw new Error(`jimeng video provider is not registered: ${JSON.stringify(seams.seams.avatarMedia)}`)
    }
    for (const expected of ['realtime-volc', 'realtime-vidu']) {
      if (seams.seams.avatarMedia.providers.some((provider) => provider.id === expected) === false) {
        throw new Error(`${expected} realtime provider is not registered: ${JSON.stringify(seams.seams.avatarMedia)}`)
      }
    }

    const analyzeResponse = await fetch(`${base}/flowact/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: '[emotion: happy][action: wave] 太好了，我们出发吧。' }),
    })
    if (analyzeResponse.ok === false) throw new Error(`analyze endpoint HTTP ${analyzeResponse.status}`)
    const analysis = await analyzeResponse.json()
    if (analysis.summary.emotion[0] !== 'happy' || analysis.summary.actions[0] !== 'wave') {
      throw new Error(`unexpected pipeline analysis: ${JSON.stringify(analysis)}`)
    }

    const talkResponse = await fetch(`${base}/flowact/talk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 'missing-session', text: '你好' }),
    })
    if (talkResponse.status !== 404) {
      throw new Error(`talk endpoint should reject unknown agents, got HTTP ${talkResponse.status}`)
    }
    const videoResponse = await fetch(`${base}/flowact/video/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dialogue: '你好' }),
    })
    const videoBody = await videoResponse.json()
    if (videoResponse.status !== 202 || videoBody.accepted !== true || /^flowact-video-\d+$/.test(videoBody.jobId) === false) {
      throw new Error(`video submit should be accepted as a ctx.jobs job, got HTTP ${videoResponse.status}: ${JSON.stringify(videoBody)}`)
    }

    const tokenResponse = await fetch(`${base}/flowact/realtime/volc-token?characterId=chie`)
    if (tokenResponse.status !== 503) {
      throw new Error(`volc realtime token should report missing credentials, got HTTP ${tokenResponse.status}`)
    }
    const viduResponse = await fetch(`${base}/flowact/realtime/vidu/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ characterId: 'chie' }),
    })
    if (viduResponse.status !== 502 && viduResponse.status !== 503) {
      throw new Error(`vidu session without proxy should fail closed, got HTTP ${viduResponse.status}`)
    }
    const turnResponse = await fetch(`${base}/flowact/turn/missing-session`)
    if (turnResponse.status !== 404) {
      throw new Error(`turn endpoint should reject unknown sessions, got HTTP ${turnResponse.status}`)
    }

    const clientResponse = await fetch(`${base}/plugins/dsh-flowact-avatar/client.js`)
    if (clientResponse.ok === false) throw new Error(`client bundle HTTP ${clientResponse.status}`)
    const clientSource = await clientResponse.text()
    if (clientSource.includes('window.__ModuleLoader__.load') === false) {
      throw new Error('client bundle does not use the dsh module-loader handoff')
    }
    if (clientSource.includes('browser-tts') === false) {
      throw new Error('client bundle does not ship the zero-key TTS provider')
    }
    if (clientSource.includes('browser-speech') === false) {
      throw new Error('client bundle does not ship the zero-key ASR provider')
    }

    const indexResponse = await fetch(base)
    const html = await indexResponse.text()
    if (html.includes('dsh-flowact-avatar') === false) {
      throw new Error('boot manifest does not include dsh-flowact-avatar')
    }

    process.stdout.write(
      `[integration] OK: installed, configured, booted; characters=${characters.characters.length}, client bundle served\n`,
    )
  } finally {
    child.kill('SIGTERM')
    await new Promise((resolveWait) => {
      const timer = setTimeout(resolveWait, 5_000)
      child.once('exit', () => {
        clearTimeout(timer)
        resolveWait()
      })
    })
    if (child.exitCode === null) child.kill('SIGKILL')
    rmSync(root, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
