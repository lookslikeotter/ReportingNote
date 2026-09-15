// 봉누도2 — 사이트 지도 페이지의 바탕 지도 조각(타일) 받기. 쓰는 법 (볼트 루트에서, sharp가 있는 Quartz 폴더의 node_modules를 NODE_PATH로):
//   NODE_PATH=<Quartz 폴더>/node_modules node .github/scripts/map-tiles.js
// GTA V 지도(Atlas 스타일, gta-v-map-leaflet 계열 조각)를 GitHub 공개 저장소에서 받아 WebP로 바꿔
// .quartz/quartz/static/map/tiles/{z}/{x}/{y}.webp 에 둔다 (확대 0~5단계, 1,365장). 이미 있는 조각은 건너뛴다.
// 한 번만 받으면 되고 결과는 저장소에 올린다. 좌표 변환(게임 좌표 → 지도)은 components/scripts/bnMapLib.ts에 있다.
const fs = require("fs")
const path = require("path")
const sharp = require("sharp")

const SRC = "https://raw.githubusercontent.com/Trusted-Studios/mapStyles/main/styleAtlas"
const OUT = ".quartz/quartz/static/map/tiles"
const MAX_Z = 5
const PARALLEL = 8

async function fetchTile(z, x, y) {
  const dest = path.join(OUT, String(z), String(x), `${y}.webp`)
  if (fs.existsSync(dest)) return 0
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(`${SRC}/${z}/${x}/${y}.jpg`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const buf = Buffer.from(await res.arrayBuffer())
      const webp = await sharp(buf).webp({ quality: 80 }).toBuffer()
      fs.mkdirSync(path.dirname(dest), { recursive: true })
      fs.writeFileSync(dest, webp)
      return webp.length
    } catch (e) {
      if (attempt >= 4) throw new Error(`${z}/${x}/${y}: ${e.message}`)
      await new Promise((r) => setTimeout(r, 1500 * attempt))
    }
  }
}

async function main() {
  const jobs = []
  for (let z = 0; z <= MAX_Z; z++) {
    const n = 2 ** z
    for (let x = 0; x < n; x++) for (let y = 0; y < n; y++) jobs.push([z, x, y])
  }
  let done = 0
  let bytes = 0
  const failed = []
  await Promise.all(
    Array.from({ length: PARALLEL }, async () => {
      while (jobs.length > 0) {
        const [z, x, y] = jobs.shift()
        try {
          bytes += await fetchTile(z, x, y)
        } catch (e) {
          failed.push(e.message)
        }
        done++
        if (done % 100 === 0) console.log(`${done}장…`)
      }
    }),
  )
  console.log(`끝: ${done}장, 새로 받은 ${(bytes / 1024 / 1024).toFixed(1)}MB, 실패 ${failed.length}`)
  for (const f of failed) console.log("  실패:", f)
  if (failed.length > 0) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
