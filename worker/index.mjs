const encoder = new TextEncoder();
const ttl = 60 * 60 * 24 * 35;
const imageTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const photoKey = /^photos\/\d{4}-\d{2}-\d{2}\/[a-f0-9-]{36}$/;
const common = {
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
  'X-Robots-Tag': 'noindex, nofollow',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
};

function respond(body, status = 200, headers = {}) {
  return new Response(body, {status, headers: {...common, ...headers}});
}

function json(value, status = 200, headers = {}) {
  return respond(JSON.stringify(value), status, {'Content-Type': 'application/json', ...headers});
}

async function hmac(secret, value) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), {name:'HMAC', hash:'SHA-256'}, false, ['sign']);
  return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value))),
    byte => byte.toString(16).padStart(2, '0')).join('');
}

function equal(a, b) {
  return crypto.subtle.timingSafeEqual
    ? a.length === b.length && crypto.subtle.timingSafeEqual(encoder.encode(a), encoder.encode(b))
    : a.length === b.length && Array.from(a).reduce((diff, char, i) => diff | (char.charCodeAt(0) ^ b.charCodeAt(i)), 0) === 0;
}

async function session(request, env) {
  const cookie = request.headers.get('Cookie')?.match(/(?:^|; *)__Host-busya=([^;]+)/)?.[1];
  const match = cookie?.match(/^(reader|writer)\.(\d{10})\.([a-f0-9]{64})$/);
  if (!match || !env.SESSION_KEY) return null;
  const [, role, expiry, signature] = match;
  if (Number(expiry) <= Date.now() / 1000) return null;
  return equal(signature, await hmac(env.SESSION_KEY, role + '.' + expiry)) ? role : null;
}

function sessionCookie(value, maxAge) {
  return '__Host-busya=' + value + '; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=' + maxAge;
}

function today() {
  return new Intl.DateTimeFormat('sv-SE', {timeZone:'Europe/Moscow'}).format(new Date());
}

function validDay(day) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day > today()) return false;
  const date = new Date(day);
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === day;
}

function isImage(bytes, type) {
  const ascii = (start, end) => new TextDecoder().decode(bytes.slice(start, end));
  if (type === 'image/jpeg') return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (type === 'image/png') return [137,80,78,71,13,10,26,10].every((byte, i) => bytes[i] === byte);
  if (type === 'image/gif') return ['GIF87a', 'GIF89a'].includes(ascii(0, 6));
  return ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP';
}

async function login(request, env) {
  if (!env.SESSION_KEY || !env.READER_PASSWORD || !env.WRITER_PASSWORD) return json({error:'Вход пока недоступен.'}, 503);
  if (Number(request.headers.get('Content-Length')) > 4096) return json({error:'Пароль слишком длинный.'}, 413);
  const body = await request.json().catch(() => null);
  if (typeof body?.password !== 'string' || body.password.length > 128) return json({error:'Проверь пароль.'}, 401);
  const [provided, reader, writer] = await Promise.all(
    [body.password, env.READER_PASSWORD, env.WRITER_PASSWORD].map(value => hmac(env.SESSION_KEY, value)));
  const role = equal(provided, writer) ? 'writer' : equal(provided, reader) ? 'reader' : null;
  if (!role) return json({error:'Пароль не подошёл. Попробуй ещё раз.'}, 401);
  const value = role + '.' + (Math.floor(Date.now() / 1000) + ttl);
  return json({role}, 200, {'Set-Cookie':sessionCookie(value + '.' + await hmac(env.SESSION_KEY, value), ttl)});
}

async function upload(request, bucket, url) {
  const day = url.searchParams.get('day') ?? '';
  const caption = (url.searchParams.get('caption') ?? '').trim();
  const type = request.headers.get('Content-Type');
  const size = Number(request.headers.get('Content-Length'));
  if (!validDay(day) || caption.length > 240) return json({error:'Проверь дату и подпись.'}, 400);
  if (!imageTypes.has(type)) return json({error:'Выбери фото в формате JPEG, PNG, WebP или GIF.'}, 415);
  if (!size || size > 6_000_000) return json({error:'Размер фото должен быть меньше 6 МБ.'}, 413);
  const buffer = await request.arrayBuffer();
  if (buffer.byteLength !== size || !isImage(new Uint8Array(buffer), type)) return json({error:'Не удалось прочитать фото.'}, 400);
  const key = 'photos/' + day + '/' + crypto.randomUUID();
  await bucket.put(key, buffer, {httpMetadata:{contentType:type}, customMetadata:{caption}});
  return json({key}, 201);
}

async function photos(bucket) {
  const entries = [];
  let cursor;
  do {
    const page = await bucket.list({prefix:'photos/', limit:100, cursor, include:['customMetadata']});
    for (const object of page.objects) {
      if (photoKey.test(object.key)) entries.push({
        url:'/' + object.key, day:object.key.split('/')[1],
        caption:object.customMetadata?.caption ?? '', added:object.uploaded.toISOString()
      });
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  entries.sort((a, b) => b.day.localeCompare(a.day) || b.added.localeCompare(a.added));
  return entries;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const {pathname} = url;
    const {method} = request;
    try {
      if (method === 'GET' && (pathname === '/' || pathname === '/app')) return respond(page, 200, {'Content-Type':'text/html; charset=utf-8'});
      if (method === 'GET' && pathname === '/app.js') return respond(client, 200, {'Content-Type':'text/javascript; charset=utf-8'});
      if (method === 'GET' && pathname === '/hero.webp' && cover) return respond(Uint8Array.from(atob(cover), char => char.charCodeAt(0)), 200, {'Content-Type':'image/webp', 'Cache-Control':'public, max-age=86400'});
      if (method === 'POST' && request.headers.get('Origin') !== url.origin) return json({error:'Запрос отклонён.'}, 403);
      if (method === 'POST' && pathname === '/api/login') return login(request, env);
      if (method === 'POST' && pathname === '/api/logout') return json({}, 200, {'Set-Cookie':sessionCookie('', 0)});
      if (!pathname.startsWith('/api/') && !photoKey.test(pathname.slice(1))) return respond('Страница не найдена', 404);
      const role = await session(request, env);
      if (!role) return json({error:'Войди в дневник.'}, 401);
      if (method === 'GET' && pathname === '/api/session') return json({role, today:today()});
      if (!env.BUCKET) return json({error:'Хранилище фотографий недоступно.'}, 503);
      if (method === 'GET' && pathname === '/api/photos') return json({photos:await photos(env.BUCKET)});
      if (method === 'POST' && pathname === '/api/photos') {
        return role === 'writer' ? await upload(request, env.BUCKET, url) : json({error:'Этот пароль открывает просмотр.'}, 403);
      }
      if (method === 'GET' && photoKey.test(pathname.slice(1))) {
        const photo = await env.BUCKET.get(pathname.slice(1));
        if (photo) return respond(photo.body, 200, {'Content-Type':photo.httpMetadata.contentType});
      }
      return json({error:'Страница не найдена.'}, 404);
    } catch (error) {
      console.error(error.name);
      return json({error:'Что-то пошло не так. Попробуй ещё раз.'}, 500);
    }
  }
};
