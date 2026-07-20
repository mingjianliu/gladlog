/**
 * 视觉回归的外部网络隔离。
 *
 * 为什么需要:基线是像素级单源标准,而页面里有运行时从公网拉的资源
 * (竞技场 minimap 底图 —— arenaMaps.ts 的 wowarenalogs CDN)。拉到了就画、
 * 没拉到就不画,于是**同一份代码**在两次 CI 上能出两张不同的图。
 * 2026-07-20 的 run 29771469113 就是这么红的:report-replay 差 2286 px,
 * 下一次 push 没改任何 UI 代码又自己绿了。
 *
 * 修法不是给截图加等待(网络慢/断依旧是抖动),而是**让基线彻底不碰网络**:
 * 已知的外部资源用固定桩件 fulfill,其余一律 abort 并记账,由用例断言账本为空。
 * 新加一个 CDN 依赖会直接把用例打红并指名道姓,而不是留一颗随机红灯。
 */
import zlib from "node:zlib";

import type { Page } from "@playwright/test";

/** arenaMaps.ts 的 arenaMapUrl 指向的主机。 */
const MINIMAP_HOST = "images.wowarenalogs.com";

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = -1;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/**
 * 桩底图:64×64 半透明 PNG —— 外框 + 居中方块。
 *
 * 就地生成而不是入仓二进制:桩件的样子必须是**可审的**。真底图是「透明背景 +
 * 不透明碰撞体」的形状图(实测 1911.png 仅 1860 B),桩件沿用同一形态,于是
 * <image> 的定位/拉伸/veil 压暗这几层在基线里仍然被覆盖到;换成纯色块就测不出
 * 底图错位了。图案刻意规整,底图这层一旦画歪,基线 diff 一眼能看出来。
 */
export function minimapStubPng(): Buffer {
  const SIZE = 64;
  const BORDER = 6;
  const px = Buffer.alloc(SIZE * SIZE * 4); // 默认全 0 = 全透明
  const paint = (x: number, y: number, v: number, a: number) => {
    const i = (y * SIZE + x) * 4;
    px[i] = v;
    px[i + 1] = v;
    px[i + 2] = v + 6; // 与真底图一样带一点冷调
    px[i + 3] = a;
  };
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const onBorder =
        x < BORDER || y < BORDER || x >= SIZE - BORDER || y >= SIZE - BORDER;
      const inCenter =
        x >= SIZE / 2 - 10 &&
        x < SIZE / 2 + 10 &&
        y >= SIZE / 2 - 10 &&
        y < SIZE / 2 + 10;
      if (onBorder) paint(x, y, 142, 255);
      else if (inCenter) paint(x, y, 120, 210);
    }
  }
  // 逐行加 filter 字节 0(None)
  const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
  for (let y = 0; y < SIZE; y++) {
    raw[y * (SIZE * 4 + 1)] = 0;
    px.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0);
  ihdr.writeUInt32BE(SIZE, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

/**
 * 把 page 上所有非本机请求挡下来。返回**泄漏账本**:被挡掉的外部 URL。
 * 用例必须断言它为空 —— 账本非空 = 新增了一个会让基线随网络漂移的依赖。
 */
export async function isolateExternalRequests(page: Page): Promise<string[]> {
  const leaked: string[] = [];
  const stub = minimapStubPng();
  // 必须 await:route 注册本身是异步的,不等它落地就 goto 会漏掉首批请求
  // —— 那等于把「偶尔拦不住」重新引回来。
  await page.route(
    (url) => url.hostname !== "localhost" && url.hostname !== "127.0.0.1",
    (route) => {
      const url = new URL(route.request().url());
      if (url.hostname === MINIMAP_HOST) {
        return route.fulfill({ contentType: "image/png", body: stub });
      }
      leaked.push(route.request().url());
      return route.abort();
    },
  );
  return leaked;
}
