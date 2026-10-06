// Files the browser tests upload (pictures, random bytes, odd file names). Made fresh in tests/.fixtures/, which is also the working
// directory of every browser suite, so the suites can say "wall/blue.png" and write their own downloads there.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { PNG } = require("pngjs");

const dir = path.join(__dirname, "..", ".fixtures");

function png(file, w, h, pixel) {
  const img = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const [r, g, b] = pixel(x, y);
      const i = (w * y + x) << 2;
      img.data[i] = r;
      img.data[i + 1] = g;
      img.data[i + 2] = b;
      img.data[i + 3] = 255;
    }
  fs.writeFileSync(file, PNG.sync.write(img, { deflateLevel: 6 }));
}

function make() {
  for (const d of ["", "dl", "imp", "wall"]) fs.mkdirSync(path.join(dir, d), { recursive: true });
  const put = (rel, data) => !fs.existsSync(path.join(dir, rel)) && fs.writeFileSync(path.join(dir, rel), data);
  const solid = (r, g, b) => () => [r, g, b];
  const pic = (file) => !fs.existsSync(file) && png(file, 120, 80, (x, y) => [(x * 2) & 255, (y * 3) & 255, 160]);

  put("big.bin", crypto.randomBytes(3_000_000));
  put("b1m.bin", crypto.randomBytes(1_000_000));
  pic(path.join(dir, "dl", "pic.png"));
  put("dl/..notes <b>evil:name?.txt", "hello from a file with a strange name\n");
  pic(path.join(dir, "imp", "pic.png"));
  put("imp/notes.txt", "meeting notes\n");
  // wallpapers: a blue one (hue 225), a red one, a grey one, a huge one that has to be shrunk, and two that are not pictures
  const w = (name, r, g, b) => !fs.existsSync(path.join(dir, "wall", name)) && png(path.join(dir, "wall", name), 320, 200, solid(r, g, b));
  w("blue.png", 30, 80, 220);
  w("red.png", 220, 40, 40);
  w("grey.png", 128, 128, 128);
  if (!fs.existsSync(path.join(dir, "wall", "huge.png"))) png(path.join(dir, "wall", "huge.png"), 4200, 3000, (x, y) => [(x >> 4) & 255, (y >> 4) & 255, 120]);
  put("wall/fake.png", "this is not a picture\n");
  put("wall/doc.txt", "plain text\n");
  return dir;
}

module.exports = { make, dir };
