// Minimal Chrome DevTools Protocol driver (no external deps): drives the
// system Chrome over a raw WebSocket built on net + crypto, logs into the
// running dev server, and screenshots pages at several widths so we can see
// the actual rendering. Throwaway dev tool.
import net from 'node:net'
import crypto from 'node:crypto'
import http from 'node:http'
import fs from 'node:fs'

const DEBUG_PORT = 9222
const BASE = 'http://localhost:3000'
const EMAIL = 'onboarding@school.com'
const PASSWORD = 'Fees101Test#2026'
const OUT = '/tmp/fees-shots'
fs.mkdirSync(OUT, { recursive: true })

function httpGet(path) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: DEBUG_PORT, path }, res => {
      let d = ''
      res.on('data', c => (d += c))
      res.on('end', () => resolve(d))
    }).on('error', reject)
  })
}

// --- tiny WebSocket client over net.Socket ---
class WS {
  constructor(url) {
    const u = new URL(url)
    this.host = u.hostname
    this.port = u.port
    this.path = u.pathname + u.search
    this.buf = Buffer.alloc(0)
    this.frag = []
    this.onmessage = () => {}
  }
  connect() {
    return new Promise((resolve, reject) => {
      this.sock = net.connect(this.port, this.host, () => {
        const key = crypto.randomBytes(16).toString('base64')
        this.sock.write(
          `GET ${this.path} HTTP/1.1\r\nHost: ${this.host}:${this.port}\r\n` +
          `Upgrade: websocket\r\nConnection: Upgrade\r\n` +
          `Sec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`
        )
      })
      let handshakeDone = false
      this.sock.on('data', chunk => {
        if (!handshakeDone) {
          const idx = chunk.indexOf('\r\n\r\n')
          if (idx === -1) return
          handshakeDone = true
          const rest = chunk.slice(idx + 4)
          if (rest.length) this._feed(rest)
          resolve()
          return
        }
        this._feed(chunk)
      })
      this.sock.on('error', reject)
    })
  }
  _feed(chunk) {
    this.buf = Buffer.concat([this.buf, chunk])
    while (this.buf.length >= 2) {
      const b0 = this.buf[0], b1 = this.buf[1]
      const fin = (b0 & 0x80) !== 0
      const opcode = b0 & 0x0f
      let len = b1 & 0x7f
      let off = 2
      if (len === 126) {
        if (this.buf.length < 4) return
        len = this.buf.readUInt16BE(2); off = 4
      } else if (len === 127) {
        if (this.buf.length < 10) return
        len = Number(this.buf.readBigUInt64BE(2)); off = 10
      }
      if (this.buf.length < off + len) return
      const payload = this.buf.slice(off, off + len)
      this.buf = this.buf.slice(off + len)
      if (opcode === 0x8) { this.sock.end(); return }
      if (opcode === 0x9) continue // ping, ignore
      if (opcode === 0x0 || opcode === 0x1 || opcode === 0x2) {
        this.frag.push(payload)
        if (fin) {
          const full = Buffer.concat(this.frag).toString('utf8')
          this.frag = []
          this.onmessage(full)
        }
      }
    }
  }
  send(str) {
    const payload = Buffer.from(str, 'utf8')
    const len = payload.length
    let header
    if (len < 126) { header = Buffer.alloc(2); header[1] = 0x80 | len }
    else if (len < 65536) { header = Buffer.alloc(4); header[1] = 0x80 | 126; header.writeUInt16BE(len, 2) }
    else { header = Buffer.alloc(10); header[1] = 0x80 | 127; header.writeBigUInt64BE(BigInt(len), 2) }
    header[0] = 0x81
    const mask = crypto.randomBytes(4)
    const masked = Buffer.alloc(len)
    for (let i = 0; i < len; i++) masked[i] = payload[i] ^ mask[i & 3]
    this.sock.write(Buffer.concat([header, mask, masked]))
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

async function main() {
  // Find or create a page target.
  const ver = JSON.parse(await httpGet('/json/version'))
  const ws = new WS(ver.webSocketDebuggerUrl)
  await ws.connect()

  let msgId = 0
  const pending = new Map()
  ws.onmessage = raw => {
    const m = JSON.parse(raw)
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
  }
  const send = (method, params = {}, sessionId) => new Promise(resolve => {
    const id = ++msgId
    pending.set(id, resolve)
    const msg = { id, method, params }
    if (sessionId) msg.sessionId = sessionId
    ws.send(JSON.stringify(msg))
  })

  const { result: created } = await send('Target.createTarget', { url: 'about:blank' })
  const targetId = created.targetId
  const attach = await send('Target.attachToTarget', { targetId, flatten: true })
  const sid = attach.result.sessionId
  await send('Page.enable', {}, sid)
  await send('Runtime.enable', {}, sid)

  const goto = async url => {
    await send('Page.navigate', { url }, sid)
    await sleep(2500)
  }
  const evaluate = async expr => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true }, sid)
    return r.result?.result?.value
  }
  const setViewport = async (w, h) =>
    send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false }, sid)
  const shot = async name => {
    const r = await send('Page.captureScreenshot', { format: 'png' }, sid)
    fs.writeFileSync(`${OUT}/${name}.png`, Buffer.from(r.result.data, 'base64'))
    console.log('saved', name)
  }

  // Log in.
  await setViewport(1280, 900)
  await goto(`${BASE}/login`)
  await evaluate(`(()=>{const e=document.querySelector('#email'),p=document.querySelector('#password');e.value=${JSON.stringify(EMAIL)};p.value=${JSON.stringify(PASSWORD)};document.querySelector('form').requestSubmit();return 1})()`)
  await sleep(4000)
  const afterLogin = await evaluate('location.pathname')
  console.log('after login path:', afterLogin)

  const targets = process.argv.slice(2)
  const widths = [1440, 1000, 400]
  for (const path of targets.length ? targets : ['/students', '/dashboard']) {
    const slug = path.replace(/[^a-z0-9]/gi, '_') || 'root'
    for (const w of widths) {
      await setViewport(w, 1200)
      await goto(`${BASE}${path}`)
      await shot(`${slug}__${w}`)
    }
    // Mobile drawer open (click hamburger) at 400.
    await setViewport(400, 1200)
    await goto(`${BASE}${path}`)
    await evaluate(`(()=>{const b=document.querySelector('[aria-label="Open menu"]');if(b)b.click();return !!b})()`)
    await sleep(600)
    await shot(`${slug}__400_drawer`)
  }

  await send('Target.closeTarget', { targetId })
  ws.sock.end()
  console.log('done')
}
main().catch(e => { console.error(e); process.exit(1) })
