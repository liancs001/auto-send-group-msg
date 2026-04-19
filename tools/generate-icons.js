/**
 * 生成应用图标 PNG 文件
 * 设计：深紫/靛蓝渐变圆形底板 + 白色消息气泡 + 金色闪电（象征AI群发）+ 绿色活跃点
 * 不依赖第三方包，使用纯JS手写 PNG 编码
 * 
 * 运行：node tools/generate-icons.js
 */

const fs   = require('fs');
const path = require('path');
const zlib = require('zlib');

const assetsDir = path.join(__dirname, '../assets');
if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true });

// ─── 极简 PNG 编码器 ──────────────────────────────────────────────────────────
function encodePNG(width, height, pixels) {
  // pixels: Uint8Array, RGBA, row-major
  function crc32(buf) {
    let c = 0xFFFFFFFF;
    const table = (() => {
      const t = new Uint32Array(256);
      for (let i = 0; i < 256; i++) {
        let v = i;
        for (let j = 0; j < 8; j++) v = (v & 1) ? 0xEDB88320 ^ (v >>> 1) : v >>> 1;
        t[i] = v;
      }
      return t;
    })();
    for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  function chunk(type, data) {
    const typeBytes = Buffer.from(type, 'ascii');
    const lenBuf = Buffer.alloc(4); lenBuf.writeUInt32BE(data.length);
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])));
    return Buffer.concat([lenBuf, typeBytes, data, crcBuf]);
  }
  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; // bit depth=8, color type=2 (RGB)  — we'll use 6 (RGBA)
  ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  // Raw scanlines (filter byte 0 per row)
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width * 4)] = 0; // filter none
    for (let x = 0; x < width; x++) {
      const si = (y * width + x) * 4;
      const di = y * (1 + width * 4) + 1 + x * 4;
      raw[di]   = pixels[si];
      raw[di+1] = pixels[si+1];
      raw[di+2] = pixels[si+2];
      raw[di+3] = pixels[si+3];
    }
  }
  const compressed = zlib.deflateSync(raw, { level: 9 });

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), // PNG signature
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

// ─── 软件渲染器（绘制基本图元）────────────────────────────────────────────────
class Canvas {
  constructor(w, h) {
    this.w = w; this.h = h;
    this.buf = new Uint8Array(w * h * 4); // RGBA
  }
  _idx(x, y) { return (Math.round(y) * this.w + Math.round(x)) * 4; }
  setPixel(x, y, r, g, b, a = 255) {
    if (x < 0 || x >= this.w || y < 0 || y >= this.h) return;
    const i = this._idx(x, y);
    // alpha blend over existing
    const sa = a / 255, da = this.buf[i+3] / 255;
    const oa = sa + da * (1 - sa);
    if (oa < 1e-6) return;
    this.buf[i]   = (r * sa + this.buf[i]   * da * (1-sa)) / oa;
    this.buf[i+1] = (g * sa + this.buf[i+1] * da * (1-sa)) / oa;
    this.buf[i+2] = (b * sa + this.buf[i+2] * da * (1-sa)) / oa;
    this.buf[i+3] = oa * 255;
  }
  // 填充圆（含 AA）
  fillCircle(cx, cy, r, fr, fg, fb, fa = 255) {
    const x0 = Math.floor(cx - r - 1), x1 = Math.ceil(cx + r + 1);
    const y0 = Math.floor(cy - r - 1), y1 = Math.ceil(cy + r + 1);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const d = Math.sqrt((x - cx)**2 + (y - cy)**2);
        const aa = Math.max(0, Math.min(1, r - d + 0.5));
        if (aa > 0) this.setPixel(x, y, fr, fg, fb, fa * aa);
      }
    }
  }
  // 圆环（用两个圆差）
  strokeCircle(cx, cy, r, lw, sr, sg, sb, sa = 255) {
    this.fillCircle(cx, cy, r + lw/2, sr, sg, sb, sa);
    this.fillCircle(cx, cy, r - lw/2, 0, 0, 0, 0); // 不对，改用 AA
  }
  // 填充圆角矩形
  fillRoundRect(x, y, w, h, rad, fr, fg, fb, fa = 255) {
    for (let py = Math.floor(y); py <= Math.ceil(y+h); py++) {
      for (let px = Math.floor(x); px <= Math.ceil(x+w); px++) {
        // 距最近角的距离
        const cx = Math.max(x + rad, Math.min(x + w - rad, px));
        const cy2 = Math.max(y + rad, Math.min(y + h - rad, py));
        const d = Math.sqrt((px-cx)**2 + (py-cy2)**2);
        const aa = Math.max(0, Math.min(1, rad - d + 0.5));
        if (aa > 0) this.setPixel(px, py, fr, fg, fb, fa * aa);
      }
    }
  }
  // 填充多边形（扫描线）
  fillPolygon(pts, fr, fg, fb, fa = 255) {
    if (pts.length < 3) return;
    const ys = pts.map(p => p[1]);
    const ymin = Math.floor(Math.min(...ys)), ymax = Math.ceil(Math.max(...ys));
    for (let y = ymin; y <= ymax; y++) {
      const xs = [];
      for (let i = 0; i < pts.length; i++) {
        const [ax, ay] = pts[i], [bx, by] = pts[(i+1) % pts.length];
        if ((ay <= y && by > y) || (by <= y && ay > y)) {
          xs.push(ax + (y - ay) / (by - ay) * (bx - ax));
        }
      }
      xs.sort((a,b) => a-b);
      for (let j = 0; j < xs.length - 1; j += 2) {
        const lx = xs[j], rx = xs[j+1];
        for (let x = Math.floor(lx); x <= Math.ceil(rx); x++) {
          let aa = 1;
          if (x < lx + 0.5) aa = Math.min(1, x - lx + 0.5);
          else if (x > rx - 0.5) aa = Math.min(1, rx - x + 0.5);
          if (aa > 0) this.setPixel(x, y, fr, fg, fb, fa * aa);
        }
      }
    }
  }
  // 径向渐变填充圆
  fillCircleGradient(cx, cy, r, stops) {
    // stops: [{t, r, g, b, a}]
    const x0 = Math.floor(cx-r-1), x1=Math.ceil(cx+r+1);
    const y0 = Math.floor(cy-r-1), y1=Math.ceil(cy+r+1);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const d = Math.sqrt((x-cx)**2 + (y-cy)**2);
        const edge = Math.max(0, Math.min(1, r - d + 0.5));
        if (edge <= 0) continue;
        const t = Math.min(1, d / r);
        // 插值
        let s0 = stops[0], s1 = stops[stops.length-1];
        for (let k = 0; k < stops.length-1; k++) {
          if (t >= stops[k].t && t <= stops[k+1].t) { s0=stops[k]; s1=stops[k+1]; break; }
        }
        const lt = s1.t === s0.t ? 0 : (t - s0.t) / (s1.t - s0.t);
        const lr = s0.r + (s1.r - s0.r) * lt;
        const lg = s0.g + (s1.g - s0.g) * lt;
        const lb = s0.b + (s1.b - s0.b) * lt;
        const la = (s0.a !== undefined ? s0.a : 255) + ((s1.a||255) - (s0.a||255)) * lt;
        this.setPixel(x, y, lr, lg, lb, la * edge);
      }
    }
  }
  toPNG() {
    return encodePNG(this.w, this.h, this.buf);
  }
}

// ─── 绘制图标 ──────────────────────────────────────────────────────────────────
function drawIcon(size) {
  const c = new Canvas(size, size);
  const s = size;
  const cx = s / 2, cy = s / 2;
  const r = s * 0.46;

  // ① 背景圆：深紫渐变（中心亮紫→边缘深靛）
  c.fillCircleGradient(cx * 0.85, cy * 0.8, r, [
    { t: 0,   r: 109, g: 40,  b: 217 }, // #6d28d9
    { t: 0.6, r: 79,  g: 30,  b: 170 },
    { t: 1,   r: 30,  g: 27,  b: 75  }  // #1e1b4b
  ]);

  // ② 消息气泡（白色圆角矩形）
  const bx = s*0.17, by = s*0.22, bw = s*0.66, bh = s*0.40, br = s*0.09;
  // 投影
  c.fillRoundRect(bx+s*0.015, by+s*0.025, bw, bh, br, 0, 0, 0, 50);
  // 气泡本体（淡紫白）
  c.fillRoundRect(bx, by, bw, bh, br, 240, 225, 255, 240);

  // ③ 气泡尾巴（三角）
  c.fillPolygon([
    [s*0.25, s*0.62],
    [s*0.18, s*0.77],
    [s*0.40, s*0.62]
  ], 240, 225, 255, 230);

  // ④ 气泡内三条横线（代表文字/消息）
  const lineY = [by + bh*0.25, by + bh*0.52, by + bh*0.78];
  const lineX0 = bx + bw*0.12, lineX1 = bx + bw*0.88;
  const lineX1s = [lineX1, lineX1*0.88 + bx*0.12, lineX1]; // 第二条稍短
  const lh2 = s * 0.028;
  for (let i = 0; i < 3; i++) {
    c.fillRoundRect(lineX0, lineY[i] - lh2/2, lineX1s[i] - lineX0, lh2, lh2/2,
      160, 120, 210, 200);
  }

  // ⑤ 闪电符号（右下角盖在气泡上，代表 AI/自动化）
  const lbx = s*0.54, lby = s*0.25, lbw = s*0.22, lbh = s*0.44;
  c.fillPolygon([
    [lbx + lbw*0.62, lby],
    [lbx + lbw*0.08, lby + lbh*0.50],
    [lbx + lbw*0.48, lby + lbh*0.46],
    [lbx + lbw*0.22, lby + lbh],
    [lbx + lbw*0.92, lby + lbh*0.52],
    [lbx + lbw*0.54, lby + lbh*0.54]
  ], 251, 191, 36, 255); // 金黄色 #fbbf24

  // ⑥ 右上角绿色在线圆点
  const dotR = s * 0.075;
  c.fillCircle(s*0.74, s*0.26, dotR+s*0.012, 30, 27, 75, 220); // 深色边框
  c.fillCircle(s*0.74, s*0.26, dotR, 74, 222, 128, 255); // #4ade80

  return c.toPNG();
}

// ─── 生成两个尺寸 ──────────────────────────────────────────────────────────────
const png256 = drawIcon(256);
const png32  = drawIcon(32);
const png64  = drawIcon(64);  // 额外生成 64x64 备用

fs.writeFileSync(path.join(assetsDir, 'icon.png'),      png256);
fs.writeFileSync(path.join(assetsDir, 'tray-icon.png'), png32);
fs.writeFileSync(path.join(assetsDir, 'icon-64.png'),   png64);

console.log('✅ 图标生成成功：');
console.log(`   assets/icon.png       (256x256, ${png256.length} bytes)`);
console.log(`   assets/tray-icon.png  ( 32x32,  ${png32.length}  bytes)`);
console.log(`   assets/icon-64.png    ( 64x64,  ${png64.length}  bytes)`);
