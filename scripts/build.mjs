import {mkdir, readFile, writeFile, copyFile} from 'node:fs/promises';

await mkdir('dist/server', {recursive:true});
await mkdir('dist/.openai', {recursive:true});
const [worker, page, client, cover] = await Promise.all([
  readFile('worker/index.mjs','utf8'),
  readFile('worker/page.html','utf8'),
  readFile('worker/client.js','utf8'),
  readFile('worker/hero.webp','base64')
]);
const assets = Object.entries({page,client,cover})
  .map(([name,value]) => 'const ' + name + ' = ' + JSON.stringify(value) + ';');
await writeFile('dist/server/index.js', [worker, ...assets].join('\n'));
await copyFile('.openai/hosting.json', 'dist/.openai/hosting.json');
