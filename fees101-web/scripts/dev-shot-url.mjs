// Screenshot arbitrary URLs (including file://) without logging in — used to
// render the App Shell design file as the visual target. Reuses the raw-CDP
// WebSocket client. Throwaway dev tool.
import net from 'node:net'
import crypto from 'node:crypto'
import http from 'node:http'
import fs from 'node:fs'

const DEBUG_PORT = 9222
const OUT = '/tmp/fees-shots'
fs.mkdirSync(OUT, { recursive: true })

function httpGet(path) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: DEBUG_PORT, path }, res => {
      let d = ''; res.on('data', c => (d += c)); res.on('end', () => resolve(d))
    }).on('error', reject)
  })
}
class WS {
  constructor(url) { const u = new URL(url); this.host = u.hostname; this.port = u.port; this.path = u.pathname + u.search; this.buf = Buffer.alloc(0); this.frag = []; this.onmessage = () => {} }
  connect() { return new Promise((resolve, reject) => {
    this.sock = net.connect(this.port, this.host, () => { const key = crypto.randomBytes(16).toString('base64'); this.sock.write(`GET ${this.path} HTTP/1.1\r\nHost: ${this.host}:${this.port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`) })
    let hs = false
    this.sock.on('data', chunk => { if (!hs) { const i = chunk.indexOf('\r\n\r\n'); if (i === -1) return; hs = true; const rest = chunk.slice(i + 4); if (rest.length) this._feed(rest); resolve(); return } this._feed(chunk) })
    this.sock.on('error', reject)
  }) }
  _feed(chunk) { this.buf = Buffer.concat([this.buf, chunk]); while (this.buf.length >= 2) { const b0 = this.buf[0], b1 = this.buf[1]; const fin = (b0 & 0x80) !== 0; const op = b0 & 0x0f; let len = b1 & 0x7f; let off = 2; if (len === 126) { if (this.buf.length < 4) return; len = this.buf.readUInt16BE(2); off = 4 } else if (len === 127) { if (this.buf.length < 10) return; len = Number(this.buf.readBigUInt64BE(2)); off = 10 } if (this.buf.length < off + len) return; const p = this.buf.slice(off, off + len); this.buf = this.buf.slice(off + len); if (op === 0x8) { this.sock.end(); return } if (op === 0x9) continue; if (op === 0x0 || op === 0x1 || op === 0x2) { this.frag.push(p); if (fin) { const full = Buffer.concat(this.frag).toString('utf8'); this.frag = []; this.onmessage(full) } } } }
  send(str) { const p = Buffer.from(str, 'utf8'); const len = p.length; let h; if (len < 126) { h = Buffer.alloc(2); h[1] = 0x80 | len } else if (len < 65536) { h = Buffer.alloc(4); h[1] = 0x80 | 126; h.writeUInt16BE(len, 2) } else { h = Buffer.alloc(10); h[1] = 0x80 | 127; h.writeBigUInt64BE(BigInt(len), 2) } h[0] = 0x81; const m = crypto.randomBytes(4); const mk = Buffer.alloc(len); for (let i = 0; i < len; i++) mk[i] = p[i] ^ m[i & 3]; this.sock.write(Buffer.concat([h, m, mk])) }
}
const sleep = ms => new Promise(r => setTimeout(r, ms))

async function main() {
  const url = process.argv[2]
  const name = process.argv[3] || 'shot'
  const width = Number(process.argv[4] || 1440)
  const fullPage = process.argv[5] === 'full'
  const ver = JSON.parse(await httpGet('/json/version'))
  const ws = new WS(ver.webSocketDebuggerUrl)
  await ws.connect()
  let id = 0; const pending = new Map()
  ws.onmessage = raw => { const m = JSON.parse(raw); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } }
  const send = (method, params = {}, sid) => new Promise(res => { const i = ++id; pending.set(i, res); const msg = { id: i, method, params }; if (sid) msg.sessionId = sid; ws.send(JSON.stringify(msg)) })
  const { result: created } = await send('Target.createTarget', { url: 'about:blank' })
  const targetId = created.targetId
  const sid = (await send('Target.attachToTarget', { targetId, flatten: true })).result.sessionId
  await send('Page.enable', {}, sid)
  await send('Emulation.setDeviceMetricsOverride', { width, height: 1200, deviceScaleFactor: 1, mobile: false }, sid)
  await send('Page.navigate', { url }, sid)
  await sleep(3500)
  let clip
  if (fullPage) {
    const m = await send('Page.getLayoutMetrics', {}, sid)
    const cs = m.result.cssContentSize || m.result.contentSize
    clip = { x: 0, y: 0, width: cs.width, height: cs.height, scale: 1 }
  }
  const r = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip, captureBeyondViewport: true } : {}) }, sid)
  fs.writeFileSync(`${OUT}/${name}.png`, Buffer.from(r.result.data, 'base64'))
  console.log('saved', name, fullPage ? '(full page)' : `(${width}x1200)`)
  await send('Target.closeTarget', { targetId })
  ws.sock.end()
}
main().catch(e => { console.error(e); process.exit(1) })
