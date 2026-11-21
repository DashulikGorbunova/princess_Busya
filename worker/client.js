const el = id => document.getElementById(id);
const dateFormat = new Intl.DateTimeFormat('ru-RU', {day:'numeric', month:'long', year:'numeric', timeZone:'UTC'});
let currentDay;
let activeSession = 0;
let draft;

async function call(path, options) {
  const response = await fetch('/api/' + path, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw Object.assign(new Error(data.error ?? 'Не удалось связаться с дневником.'), {status:response.status});
  }
  return data;
}

function node(tag, className, text) {
  const item = document.createElement(tag);
  if (className) item.className = className;
  if (text) item.textContent = text;
  return item;
}

function locked() {
  activeSession++;
  el('album').hidden = true;
  el('logout').hidden = true;
  el('add').hidden = true;
  el('gate').hidden = false;
  el('feed').replaceChildren();
  el('upload').close();
  el('viewer').close();
  el('view-image').removeAttribute('src');
  el('uploader').reset();
  draft = undefined;
}

function openPhoto(photo, day) {
  el('view-day').textContent = day;
  el('view-image').src = photo.url;
  el('view-caption').textContent = photo.caption;
  el('viewer').showModal();
}

function render(photos) {
  const feed = el('feed');
  feed.replaceChildren();
  const names = new Intl.PluralRules('ru-RU');
  const word = {one:'фотография', few:'фотографии', many:'фотографий', other:'фотографии'};
  el('photo-count').textContent = photos.length
    ? photos.length + ' ' + word[names.select(photos.length)] + ' в альбоме'
    : 'Фотографии по дням';
  if (!photos.length) {
    const empty = node('div','empty');
    const heart = node('span','heart','♡');
    heart.setAttribute('aria-hidden','true');
    empty.append(heart, node('h3',null,'Здесь появится первое фото Буси'), node('p',null,'Как только оно будет загружено, ты увидишь его здесь.'));
    feed.append(empty);
    return;
  }
  let lastDay;
  let grid;
  let label;
  for (const photo of photos) {
    if (lastDay !== photo.day) {
      lastDay = photo.day;
      label = dateFormat.format(new Date(photo.day));
      const day = node('div','day');
      grid = node('div','grid');
      day.append(node('h3', null, label), grid);
      feed.append(day);
    }
    const button = node('button','card');
    button.type = 'button';
    const image = node('img');
    image.src = photo.url;
    image.alt = 'Фото Буси';
    image.loading = 'lazy';
    button.append(image);
    if (photo.caption) button.append(node('span',null,photo.caption));
    const date = label;
    button.addEventListener('click', () => openPhoto(photo,date));
    grid.append(button);
  }
}

async function refresh() {
  const version = activeSession;
  el('feed').replaceChildren(node('div','notice','Загружаем фотографии…'));
  try {
    const {photos} = await call('photos');
    if (version === activeSession) render(photos);
  } catch (error) {
    if (version !== activeSession) return;
    if (error.status === 401) return locked();
    const retry = node('button','quiet','Попробовать снова');
    retry.addEventListener('click',refresh);
    const notice = node('div','notice');
    notice.append(node('p',null,error.message),retry);
    el('feed').replaceChildren(notice);
  }
}

async function restore() {
  const state = await call('session');
  activeSession++;
  currentDay = state.today;
  el('gate').hidden = true;
  el('album').hidden = false;
  el('logout').hidden = false;
  el('add').hidden = state.role !== 'writer';
  await refresh();
}

async function compress(file) {
  if (file.size > 30_000_000) throw new Error('Выбери фото до 30 МБ.');
  if (file.type === 'image/gif' && file.size <= 6_000_000) return file;
  const url = URL.createObjectURL(file);
  try {
    const photo = new Image();
    photo.src = url;
    await photo.decode().catch(() => { throw new Error('Телефон не смог открыть фото. Попробуй выбрать JPEG или PNG.'); });
    const ratio = Math.min(1, 1600 / Math.max(photo.width,photo.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(photo.width * ratio));
    canvas.height = Math.max(1, Math.round(photo.height * ratio));
    const context = canvas.getContext('2d');
    context.fillStyle = '#fff';
    context.fillRect(0,0,canvas.width,canvas.height);
    context.drawImage(photo,0,0,canvas.width,canvas.height);
    const blob = await new Promise(resolve => canvas.toBlob(resolve,'image/jpeg',.88));
    if (!blob) throw new Error('Не удалось подготовить фотографию.');
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

el('login').addEventListener('submit', async event => {
  event.preventDefault();
  const submit = event.submitter;
  submit.disabled = true;
  el('login-error').textContent = '';
  try {
    await call('login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:el('password').value})});
    el('password').value = '';
    await restore();
    el('logout').focus();
  } catch (error) {
    el('login-error').textContent = error.message;
  } finally {
    submit.disabled = false;
  }
});

el('logout').addEventListener('click', async () => {
  el('logout').disabled = true;
  try {
    await call('logout',{method:'POST'});
    locked();
    el('password').focus();
  } catch (error) {
    const notice = node('p','error',error.message);
    notice.setAttribute('role','alert');
    el('feed').prepend(notice);
  } finally {
    el('logout').disabled = false;
  }
});

el('add').addEventListener('click', () => {
  el('day').max = currentDay;
  if (!el('day').value) el('day').value = currentDay;
  el('upload-error').textContent = '';
  el('upload').showModal();
});

el('file').addEventListener('change', () => { draft = undefined; });
el('uploader').addEventListener('submit', async event => {
  event.preventDefault();
  const submit = event.submitter;
  submit.disabled = true;
  el('upload-error').textContent = '';
  try {
    const file = el('file').files[0];
    if (!file) throw new Error('Выбери фотографию.');
    draft ??= {file, blob:await compress(file)};
    const query = new URLSearchParams({day:el('day').value,caption:el('caption').value});
    await call('photos?' + query,{method:'POST',headers:{'Content-Type':draft.blob.type},body:draft.blob});
    event.target.reset();
    draft = undefined;
    el('upload').close();
    await refresh();
  } catch (error) {
    if (error.status === 401) {
      locked();
      el('login-error').textContent = 'Срок входа закончился. Войди снова.';
    } else {
      el('upload-error').textContent = error.message;
    }
  } finally {
    submit.disabled = false;
  }
});

document.querySelectorAll('[data-close]').forEach(button => {
  button.addEventListener('click', () => button.closest('dialog').close());
});

restore().catch(error => {
  if (error.status !== 401) el('login-error').textContent = error.message;
});
