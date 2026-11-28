// Génère les icônes de l'app (ARTCOL) à partir d'une seule source HTML/CSS :
// le A sur fond carmin, dans son cadre vert, tourné vers le visiteur, sur fond blanc.
// Usage : node scripts/render-icons.cjs
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const font = path.resolve(__dirname, '../node_modules/@fontsource/dm-serif-display/files/dm-serif-display-latin-400-normal.woff2');
const html = (size) => `<!doctype html><html><head><style>
@font-face { font-family: 'DM Serif Display'; src: url('file://${font}') format('woff2'); }
html, body { margin: 0; width: ${size}px; height: ${size}px; background: #ffffff; }
.stage { width: 100%; height: 100%; display: grid; place-items: center; perspective: ${size * 1.6}px; }
.frame { --s: ${size * 0.45}px; --t: calc(var(--s) * 0.08); width: var(--s); height: calc(var(--s) * 1.2); padding: var(--t); box-sizing: border-box;
  background: #2c3b38; transform: rotateY(16deg); box-shadow: calc(var(--s) * 0.06) calc(var(--s) * 0.1) calc(var(--s) * 0.18) rgba(32, 43, 41, 0.28); }
.mat { width: 100%; height: 100%; background: #c91f37; display: grid; place-items: center; }
.a { font-family: 'DM Serif Display'; font-size: calc(var(--s) * 0.78); line-height: 1; color: #ffffff; transform: translateY(0.04em); }
</style></head><body><div class="stage"><div class="frame"><div class="mat"><span class="a">A</span></div></div></div></body></html>`;

(async () => {
  const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
  const out = path.resolve(__dirname, '../public');
  for (const [name, size] of [['icon-512.png', 512], ['icon-192.png', 192], ['apple-touch-icon.png', 180]]) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    await page.setContent(html(size));
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(out, name) });
    await page.close();
  }
  await browser.close();
  fs.writeFileSync(
    path.join(out, 'icon.svg'),
    `<svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="32" height="32" rx="6" fill="#C91F37"/><path d="M8.07012 24V23.75L8.69512 23.525C9.02845 23.3917 9.28678 23.2333 9.47012 23.05C9.65345 22.85 9.80345 22.575 9.92012 22.225L15.0701 7.45H17.1951L22.2701 22.325C22.4035 22.6917 22.5535 22.975 22.7201 23.175C22.8868 23.3583 23.1451 23.5167 23.4951 23.65L23.7951 23.75V24H17.4451V23.75L17.8201 23.625C18.1701 23.4917 18.3785 23.3083 18.4451 23.075C18.5285 22.825 18.5201 22.5333 18.4201 22.2L17.2451 18.6H11.6951L10.4951 22.125C10.3785 22.4917 10.3368 22.7833 10.3701 23C10.4201 23.2167 10.6201 23.3917 10.9701 23.525L11.5201 23.75V24H8.07012ZM11.8701 18.1H17.0951L14.5701 10.325L11.8701 18.1Z" fill="white"/></svg>\n`
  );
  console.log('icônes écrites dans public/');
})();
