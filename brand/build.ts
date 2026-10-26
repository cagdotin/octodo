/**
 * Renders every octodo icon from `glyph.svg`: the ink glyph on a paper tile. Run it after changing
 * the glyph or the palette below; the outputs are checked in.
 *
 *   node brand/build.ts
 *
 * Needs macOS for `iconutil`, which assembles the desktop app's .icns.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// Node loads opentype.js as CommonJS (it has no exports map), so only the default import works.
// oxlint-disable-next-line import/default
import opentype, { type Path } from "opentype.js";
import sharp from "sharp";

const root = join(import.meta.dirname, "..");
const web = join(root, "apps/web/public");
const desktop = join(root, "apps/desktop/build");
const docs = join(root, "docs/assets");

const ink = "#14202B";
const paperTop = "#F8F4EF";
const paperBottom = "#EDE6DE";

// The glyph's own viewBox and paths, nested as an <svg> so it can be placed anywhere.
const source = readFileSync(join(import.meta.dirname, "glyph.svg"), "utf8");
const viewBox = /viewBox="([^"]+)"/.exec(source)?.[1];
const paths = source.replace(/^[\s\S]*?<svg[^>]*>|<\/svg>\s*$/g, "");
if (viewBox === undefined) throw new Error("glyph.svg has no viewBox");

const glyph = (x: number, y: number, size: number, fill = ink) =>
  `<svg x="${x}" y="${y}" width="${size}" height="${size}" viewBox="${viewBox}">${paths.replaceAll("currentColor", fill)}</svg>`;

const gradient = `<linearGradient id="paper" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${paperTop}"/><stop offset="1" stop-color="${paperBottom}"/></linearGradient>`;
const shadow = `<filter id="shadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="10" stdDeviation="14" flood-color="#000" flood-opacity="0.22"/></filter>`;

/**
 * A square icon of `size`: a paper tile inset by `inset` (a share of the size) with corners of
 * `radius` (a share of the tile), holding the glyph at `scale` of the tile.
 */
const icon = ({
  size,
  inset = 0,
  radius = 0.225,
  scale = 0.75,
  drop = false,
}: {
  size: number;
  inset?: number;
  radius?: number;
  scale?: number;
  drop?: boolean;
}) => {
  const tile = size * (1 - 2 * inset);
  const offset = size * inset;
  const mark = tile * scale;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
<defs>${gradient}${drop ? shadow : ""}</defs>
<rect x="${offset}" y="${offset}" width="${tile}" height="${tile}" rx="${tile * radius}" fill="url(#paper)"${drop ? ' filter="url(#shadow)"' : ""}/>
${glyph(offset + (tile - mark) / 2, offset + (tile - mark) / 2, mark)}
</svg>`;
};

// Text is drawn as paths in Geist, the brand face, so the images do not depend on installed fonts.
const geist = (weight: 400 | 600) => {
  const file = readFileSync(
    join(root, `node_modules/@fontsource/geist/files/geist-latin-${weight}-normal.woff`),
  );
  return opentype.parse(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength));
};
const fonts = { 400: geist(400), 600: geist(600) };
/** SVG path data for an outline; opentype.js's own toPathData sometimes prints NaN. */
const pathData = (path: Path) =>
  path.commands
    .map((command) => {
      const n = (value: number) => value.toFixed(2);
      switch (command.type) {
        case "M":
        case "L":
          return `${command.type}${n(command.x)} ${n(command.y)}`;
        case "Q":
          return `Q${n(command.x1)} ${n(command.y1)} ${n(command.x)} ${n(command.y)}`;
        case "C":
          return `C${n(command.x1)} ${n(command.y1)} ${n(command.x2)} ${n(command.y2)} ${n(command.x)} ${n(command.y)}`;
        case "Z":
          return "Z";
      }
    })
    .join("");

const text = (
  value: string,
  options: {
    x: number;
    y: number;
    size: number;
    fill: string;
    weight?: 400 | 600;
    /** Tracking in em, like CSS letter-spacing. */
    tracking?: number;
    center?: boolean;
  },
) => {
  const font = fonts[options.weight ?? 400];
  const scale = options.size / font.unitsPerEm;
  const tracking = (options.tracking ?? 0) * options.size;
  const glyphs = value.split("").map((char) => font.charToGlyph(char));
  const advances = glyphs.map(
    (glyph, i) =>
      (glyph.advanceWidth ?? 0) * scale +
      (i < glyphs.length - 1 ? font.getKerningValue(glyph, glyphs[i + 1]!) * scale + tracking : 0),
  );
  let x = options.center ? options.x - advances.reduce((sum, n) => sum + n, 0) / 2 : options.x;
  // One path per glyph: with tight tracking glyphs overlap, and a single path would cancel out.
  return glyphs
    .map((glyph, i) => {
      const d = pathData(glyph.getPath(0, 0, options.size));
      const at = `translate(${x.toFixed(2)} ${options.y})`;
      x += advances[i]!;
      return `<path transform="${at}" d="${d}" fill="${options.fill}"/>`;
    })
    .join("");
};

const png = (svg: string) => sharp(Buffer.from(svg)).png().toBuffer();
const write = async (path: string, svg: string) => writeFileSync(path, await png(svg));

/** An ICO container holding PNG images, which every current browser reads. */
const ico = (images: Array<{ size: number; data: Buffer }>) => {
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, data }, i) => {
    const entry = 6 + 16 * i;
    header.writeUInt8(size % 256, entry);
    header.writeUInt8(size % 256, entry + 1);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(data.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...images.map((image) => image.data)]);
};

// Desktop: macOS's 1024 grid keeps the tile at 824px with room for its shadow.
const app = (size: number) => icon({ size, inset: 100 / 1024, radius: 185 / 824, drop: true });
mkdirSync(desktop, { recursive: true });
await write(join(desktop, "icon.png"), app(1024));
const iconset = join(mkdtempSync(join(tmpdir(), "octodo-")), "icon.iconset");
mkdirSync(iconset);
for (const size of [16, 32, 128, 256, 512]) {
  await write(join(iconset, `icon_${size}x${size}.png`), app(size));
  await write(join(iconset, `icon_${size}x${size}@2x.png`), app(size * 2));
}
execFileSync("iconutil", ["-c", "icns", iconset, "-o", join(desktop, "icon.icns")]);
rmSync(join(iconset, ".."), { recursive: true });

// Web: the tile fills small icons, and favicons crowd it more so the glyph survives at 16px; the touch and maskable icons are full bleed because the
// platform rounds them, and the maskable glyph stays inside the 80% safe circle.
writeFileSync(join(web, "favicon.svg"), icon({ size: 64, scale: 0.86 }));
await write(join(web, "favicon-16.png"), icon({ size: 16, scale: 0.86 }));
await write(join(web, "favicon-32.png"), icon({ size: 32, scale: 0.86 }));
writeFileSync(
  join(web, "favicon.ico"),
  ico(
    await Promise.all(
      [16, 32, 48].map(async (size) => ({ size, data: await png(icon({ size, scale: 0.86 })) })),
    ),
  ),
);
await write(join(web, "icon-192.png"), icon({ size: 192 }));
await write(join(web, "icon-512.png"), icon({ size: 512 }));
await write(join(web, "apple-touch-icon.png"), icon({ size: 180, radius: 0, scale: 0.7 }));
await write(join(web, "icon-maskable-512.png"), icon({ size: 512, radius: 0, scale: 0.56 }));

// README banners: the app icon beside the wordmark, on paper or ink.
const banner = (dark: boolean) => {
  const background = dark ? ink : paperTop;
  const foreground = dark ? paperTop : ink;
  const muted = dark ? "#A7B0B8" : "#5B6670";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="320" viewBox="0 0 1280 320">
<rect width="1280" height="320" fill="${background}"/>
<svg x="80" y="20" width="280" height="280" viewBox="0 0 1024 1024">${app(1024).replace(/^<svg[^>]*>|<\/svg>$/g, "")}</svg>
${text("octodo", { x: 396, y: 182, size: 104, weight: 600, tracking: -0.045, fill: foreground })}
${text("Local-first tasks. Plain markdown.", { x: 402, y: 234, size: 26, fill: muted })}
</svg>`;
};
await write(join(docs, "readme-banner-light.png"), banner(false));
await write(join(docs, "readme-banner-dark.png"), banner(true));

// Landing page (apps/site): its favicons, the hero icon and the social preview card.
const site = join(root, "apps/site");
mkdirSync(site, { recursive: true });
writeFileSync(join(site, "favicon.svg"), icon({ size: 64, scale: 0.86 }));
await write(join(site, "apple-touch-icon.png"), icon({ size: 180, radius: 0, scale: 0.7 }));
await write(join(site, "icon.png"), app(512));
await write(
  join(site, "og-image.png"),
  `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
<rect width="1200" height="630" fill="${paperTop}"/>
<svg x="440" y="70" width="320" height="320" viewBox="0 0 1024 1024">${app(1024).replace(/^<svg[^>]*>|<\/svg>$/g, "")}</svg>
${text("octodo", { x: 600, y: 470, size: 96, weight: 600, tracking: -0.045, fill: ink, center: true })}
${text("Your tasks, in plain ink.", { x: 600, y: 530, size: 32, fill: "#5B6670", center: true })}
</svg>`,
);
