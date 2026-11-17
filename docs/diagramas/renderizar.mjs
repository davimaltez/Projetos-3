/** Ferramentas instaladas fora do projeto: ver README.md desta pasta. */
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const pasta = path.dirname(fileURLToPath(import.meta.url));
const ferramentas = process.argv[2];
if (!ferramentas) throw new Error('Uso: node docs/diagramas/renderizar.mjs /caminho/das/ferramentas');
const resolver = createRequire(path.resolve(ferramentas, 'package.json'));
const puppeteer = resolver('puppeteer');
const { PDFDocument } = resolver('pdf-lib');
const config = path.join(pasta, 'mermaid.config.json');
const cli = path.resolve(ferramentas, 'node_modules/@mermaid-js/mermaid-cli/src/cli.js');
const arquivos = (await readdir(pasta)).filter(a => /^\d\d-.*\.mmd$/.test(a)).sort();
const origem = JSON.parse(await readFile(path.join(pasta, 'origem.json'), 'utf8'));
const descricoes = [
  'Identidades, conversas, mensagens e tickets. As cardinalidades refletem o domínio e as ausências admitidas na reconstituição.',
  'O Atendimento e o FluxoDoOperador coordenam as regras por meio de interfaces. IA e resolvedor de serviços são opcionais.',
  'Os adaptadores implementam os contratos do núcleo. O mesmo pool PostgreSQL é compartilhado; a implementação em memória é usada nos testes.',
  'Integrações concretas com WhatsApp, Gemini e HTTP. Config é lida em app.ts, que cria e injeta as dependências.',
  'Valores dos enums do código, contrato de serviço contratado e exceções da fila. StatusServico é uma união de strings, e não um enum TypeScript.',
];
const navegador = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
const pdf = await PDFDocument.create();
const figuras = [];
const escapar = texto => texto.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
try {
  for (const [i, arquivo] of arquivos.entries()) {
    const base = path.join(pasta, arquivo.slice(0, -4));
    const cfgPuppeteer = JSON.stringify({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    // /tmp não altera as dependências ou o lockfile da aplicação.
    const cfgPath = path.join(process.env.TMPDIR || '/tmp', `wxn-diagrama-puppeteer-${process.pid}.json`);
    await writeFile(cfgPath, cfgPuppeteer);
    const render = spawnSync(process.execPath, [cli, '-i', base + '.mmd', '-o', base + '.svg', '-c', config, '-p', cfgPath], { encoding: 'utf8' });
    if (render.status !== 0) throw new Error(render.stderr || render.stdout);
    const svg = await readFile(base + '.svg', 'utf8');
    const fonte = await readFile(base + '.mmd', 'utf8');
    const titulo = /^title: (.+)$/m.exec(fonte)[1];
    const dimensoes = /viewBox="([^"]+)"/.exec(svg)[1].split(/\s+/).map(Number);
    const paisagem = dimensoes[2] > dimensoes[3];
    const largura = paisagem ? '594mm' : '420mm';
    const altura = paisagem ? '420mm' : '594mm';
    const pagina = await navegador.newPage();
    await pagina.setContent(`<!doctype html><html lang="pt-BR"><meta charset="utf-8"><style>
      @page{size:${largura} ${altura};margin:16mm}
      *{box-sizing:border-box}body{margin:0;font-family:"DejaVu Sans",sans-serif;color:#172b4d}
      header{height:29mm;border-bottom:2px solid #597aa8}small{color:#53657d;font-size:14px;letter-spacing:1px}
      header h1{font-size:29px;margin:10px 0 7px}header p{font-size:16px;margin:0;line-height:1.45}
      main{height:calc(${altura} - 78mm);padding:8mm 0;display:flex;justify-content:center;align-items:center}
      svg{width:100%;height:100%;max-width:100%!important}
      footer{height:12mm;font-size:13px;border-top:1px solid #c9d5e4;padding-top:3mm;color:#53657d;line-height:1.5}
      </style><header><small>WXN TECNOLOGIA · PROJETOS 3 · CESAR SCHOOL</small><h1>${escapar(titulo)}</h1><p>${descricoes[i]}</p></header>
      <main>${svg}</main><footer>Fonte: PR #${origem.pr} consolidado com main · commit ${origem.commit.slice(0, 7)} · ${origem.data}<br>
      + público · − privado · ? admite ausência · triângulo: herança/implementação · losango: todo/parte · página ${i + 1}/${arquivos.length}</footer></html>`, { waitUntil: 'load' });
    await pagina.evaluate(() => document.fonts.ready);
    const paginaPdf = await PDFDocument.load(await pagina.pdf({ printBackground: true, preferCSSPageSize: true }));
    if (paginaPdf.getPageCount() !== 1) throw new Error(`${arquivo}: paginação inesperada`);
    for (const paginaCopiada of await pdf.copyPages(paginaPdf, [0])) pdf.addPage(paginaCopiada);
    if (i === 0) {
      await pagina.setViewport({ width: Math.ceil(dimensoes[2]) + 32, height: Math.ceil(dimensoes[3]) + 32, deviceScaleFactor: 1.5 });
      await pagina.setContent(`<html><meta charset="utf-8"><style>body{margin:16px;background:white}svg{max-width:none!important;width:${dimensoes[2]}px;height:${dimensoes[3]}px}</style>${svg}</html>`);
      await pagina.evaluate(() => document.fonts.ready);
      await pagina.screenshot({ path: base + '.png', fullPage: true });
    }
    await pagina.close();
    figuras.push({ titulo, svg, fonte, arquivo });
    console.log(`Renderizado: ${arquivo}`);
  }
  pdf.setTitle('WXN — Diagrama de classes do projeto');
  pdf.setSubject(`Código consolidado do PR #${origem.pr}, commit ${origem.commit}`);
  pdf.setAuthor('Equipe WXN · Projetos 3');
  await writeFile(path.join(pasta, 'diagrama-de-classes.pdf'), await pdf.save());
  const conteudo = figuras.map((f, i) => `<section id="vista-${i+1}"><h2>${escapar(f.titulo)}</h2><p>${descricoes[i]}</p><div class="desenho">${f.svg}</div><details><summary>Fonte Mermaid editável</summary><pre>${escapar(f.fonte)}</pre></details></section>`).join('\n');
  await writeFile(path.join(pasta, 'index.html'), `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>WXN — Diagrama de classes</title>
    <style>body{font-family:system-ui,sans-serif;margin:0;color:#172b4d;background:#f4f7fc}header,section{max-width:1500px;margin:24px auto;padding:28px;background:white;border:1px solid #d6e1ef;border-radius:12px}h1,h2{margin:0 0 12px}header p,section>p{line-height:1.55}nav a{display:inline-block;margin:4px 16px 4px 0;color:#24508d}section{scroll-margin-top:16px}.desenho{overflow:auto;background:white;border:1px solid #e0e7ef;margin:22px 0}.desenho svg{max-width:none!important}pre{overflow:auto;padding:20px;background:#f4f7fc}summary{cursor:pointer}small{color:#53657d}@media print{body{background:white}header,section{border:0}section{break-before:page}nav,details{display:none}}</style>
    <header><h1>WXN · Diagrama de classes</h1><p>Código consolidado do PR #${origem.pr} com a main, commit <strong>${origem.commit.slice(0,7)}</strong> (${origem.data}).<br>35 classes de produção distribuídas em cinco vistas. Diagramas vetoriais: use o zoom do navegador para ampliar.</p><nav>${figuras.map((f,i)=>`<a href="#vista-${i+1}">${i+1}. ${escapar(f.titulo.replace('WXN — ',''))}</a>`).join('')}</nav><p><small>+ público · − privado · ? valor nulo/opcional · $ estático · linha tracejada com triângulo: implementa · linha contínua com triângulo: herda.</small></p></header>${conteudo}</html>`);
  console.log(`PDF validado: ${pdf.getPageCount()} páginas`);
} finally { await navegador.close(); }
