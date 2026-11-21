const byId = id => document.getElementById(id);
const create = (tag, text, className) => {
  const el = document.createElement(tag);
  if (text) el.textContent = text;
  if (className) el.className = className;
  return el;
};
let state = {entries:{},goal:12};
const start = Date.UTC(2026,10,28);
const firstFeeding = Date.UTC(2026,10,27);
const dates = Array.from({length:32}, (_,i) => new Date(start+i*86400000).toISOString().slice(0,10));
const dateLabel = new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'long',timeZone:'UTC'});
const shortDate = new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'short',timeZone:'UTC'});
let role, selected;
let filter = "pending";
const feedingDay = day => (Date.parse(day)-firstFeeding)/86400000%2 === 0;
function points({photos,note,leonDay,busyaDay,fedBro},day) {
  const message = Number(Boolean(note || leonDay || busyaDay));
  return (feedingDay(day) ? Number(photos.length > 0) + Number(Boolean(fedBro)) : Math.min(photos.length,2)) + message;
}
const awarded = (item,day) => item.approved ? (item.rating ?? points(item,day)) : 0;
async function api(path, options) {
  const res=await fetch('/api/'+path,options);
  const data=await res.json().catch(()=>({}));
  if(!res.ok) throw Object.assign(new Error(data.error ?? 'Не удалось связаться с дневником.'),{status:res.status});
  return data;
}
function post(path,data) {
  return api(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
}
async function restore() {
  const session=await api('session');
  state=await api('diary');
  enter(session.role);
}
async function saveDay(day, data) {
  try {
    state.entries[day]=await post('diary/'+day,{...data,version:state.entries[day]?.version});
  } catch(error) {
    if(error.status===409) {
      state=await api('diary');
      render();
      if(byId('day-dialog').open && selected===day) openDay(day);
    }
    throw error;
  }
}
function todayInSochi() {
  return new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Moscow'}).format(new Date());
}
function todayForCard() {
  const today = todayInSochi();
  return today;
}
function renderToday() {
  const card = byId('today-card');
  card.hidden = role !== 'writer';
  if (card.hidden) return;
  const day = todayForCard();
  const item = state.entries[day];
  const inRange = dates.includes(day);
  const open = byId('today-open');
  const fish = byId('today-bro');
  byId('today-date').textContent = dateLabel.format(new Date(day));
  open.hidden = !inRange;
  open.textContent = item ? 'Открыть запись' : 'Добавить фото Буси';
  byId('today-note').textContent = !inRange
    ? (day < dates[0] ? 'Дневник начнётся 28 ноября.' : 'Дневник завершён. Все записи есть в календаре.')
    : item?.approved ? 'День одобрен ♡'
    : item ? 'Запись ждёт проверки.' : '';
  fish.hidden = !inRange || !feedingDay(day);
  fish.textContent = item?.fedBro ? '🐟 Бро покормлен' : '🐟 Бро ждёт ужин';
}
function render() {
  renderToday();
  byId('reply-legend').hidden = role !== 'writer';
  byId('surprise-note').hidden = role !== 'writer';
  byId('diary-title').textContent = 'Лёня, здесь ваши дни с Бусей';
  byId('diary-title').hidden = role !== 'writer';
  byId('instruction').textContent = role === 'writer' ? 'Выбери день, чтобы добавить фото или рассказать о дне.' : 'Выбери день, чтобы посмотреть фото, прочитать ответы и одобрить запись.';
  byId('admin').hidden = role !== 'reader';
  if (role === 'reader') renderQueue();
  byId('goal-control').hidden = role !== 'reader';
  byId('goal').value = state.goal;
  const months = byId('months');
  months.replaceChildren();
  for (const [month,title] of [['11','Ноябрь'],['12','Декабрь']]) {
    const days = dates.filter(day=>day.slice(5,7) === month);
    const section = create('div',null,'month');
    const grid = create('div',null,'calendar');
    for (const name of ['Пн','Вт','Ср','Чт','Пт','Сб','Вс']) grid.append(create('div',name,'weekday'));
    const offset = (new Date(days[0]).getUTCDay()+6)%7;
    for(let i=0;i<offset;i++) grid.append(create('div'));
    for (const day of days) {
      const item = state.entries[day];
      const b = create('button',String(Number(day.slice(-2))),'day');
      b.type = 'button';
      b.setAttribute('aria-label',dateLabel.format(new Date(day)) + (item ? item.approved ? ', одобрено' : ', ждёт одобрения' : ''));
      if(item) {
        b.dataset.state = item.approved ? 'approved' : 'pending';
        b.append(create('span',item.approved ? '♥ '+awarded(item,day) : '•'));
      }
      if (feedingDay(day)) {
        b.append(create('span','🐟','bro-mark'));
        b.setAttribute('aria-label', b.getAttribute('aria-label') + ', кормление Бро');
      }
      if (role === 'writer' && item?.reply) {
        b.append(create('span','💌','reply-mark'));
        b.setAttribute('aria-label', b.getAttribute('aria-label') + ', Даша ответила');
      }
      b.addEventListener('click',()=>openDay(day));
      grid.append(b);
    }
    section.append(create('h3',title),grid);
    months.append(section);
  }
  const weeks = byId('weeks');
  weeks.replaceChildren();
  for (let i=0;i<dates.length;i+=7) {
    const week = dates.slice(i,i+7);
    const total = week.reduce((sum,day)=> {
      const item=state.entries[day];
      return sum+(item ? awarded(item,day) : 0);
    },0);
    const target = Math.ceil(state.goal * week.length / 7);
    const row = create('div',null,'week');
    const line = create('div',null,'week-line');
    const range = shortDate.format(new Date(week[0]))+' – '+shortDate.format(new Date(week.at(-1)));
    line.append(create('strong',range),create('span',total+' / '+target+' 💋'));
    const progress = create('progress');
    progress.max = target;
    progress.value = Math.min(total,target);
    progress.setAttribute('aria-label',range);
    row.append(line,progress);
    if(total >= target) row.append(create('p','Сюрприз от Даши 🎁','reward'));
    weeks.append(row);
  }
}
function renderQueue() {
  const pending = dates.filter(day => state.entries[day] && !state.entries[day].approved).length;
  byId('admin-count').textContent = 'Ждут проверки: ' + pending;
  document.querySelectorAll('[data-filter]').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.filter === filter));
  });
  const queue = byId('queue');
  queue.replaceChildren();
  const days = dates.filter(day => {
    const item = state.entries[day];
    return item && (filter === 'all' || item.approved === (filter === 'approved'));
  }).reverse();
  if (!days.length) {
    queue.append(create('p', filter === 'pending' ? 'Пока нет записей на проверке.' : 'Здесь пока нет записей.', 'muted'));
    return;
  }
  for (const day of days) {
    const item = state.entries[day];
    const row = create('article', null, 'review-row');
    const preview = create(item.photos.length ? 'img' : 'div', item.photos.length ? '' : '♡', 'review-thumb');
    if (item.photos.length) { preview.src = item.photos[0]; preview.alt = ''; }
    const details = create('div');
    details.append(create('strong', dateLabel.format(new Date(day))), create('p', item.note || 'Фото: ' + item.photos.length));
    const open = create('button', 'Открыть');
    open.type = 'button';
    open.setAttribute('aria-label', 'Открыть запись за ' + dateLabel.format(new Date(day)));
    open.addEventListener('click', () => openDay(day));
    row.append(preview, details, open);
    queue.append(row);
  }
}
function enter(nextRole) {
  role = nextRole;
  byId('welcome').hidden = true;
  byId('diary').hidden = false;
  byId('password').value = '';
  byId('login-error').textContent = '';
  render();
  window.scrollTo(0,0);
  byId(role === 'writer' ? 'diary-title' : 'admin').focus();
}
function openDay(day) {
  selected = day;
  const item = state.entries[day];
  const content = byId('entry');
  byId('entry-error').textContent = '';
  byId('day-title').textContent = dateLabel.format(new Date(day));
  content.replaceChildren();
  if (feedingDay(day)) content.append(create('p', item?.fedBro ? '🐟 Бро покормлен' : '🐟 Сегодня день кормления Бро.', 'status'));
  if(item) {
    content.append(create('p',item.approved ? 'Одобрено · '+awarded(item,day)+' 💋' : 'Ждёт одобрения Даши','status'));
    if(item.note) content.append(create('p',item.note,'note'));
    if(item.leonDay) content.append(create('p','День Лёни: '+item.leonDay,'note'));
    if(item.busyaDay) content.append(create('p','Как вела себя Буся: '+item.busyaDay,'note'));
    if(item.photos.length) {
      const grid = create('div',null,'entry-photos');
      for (const url of item.photos) {
        const image=create('img');
        image.alt='Фото Буси';
        image.src=url;
        const button = create('button');
        button.type = 'button';
        button.addEventListener('click', () => {
          byId('full-image').src = url;
          byId('photo-dialog').showModal();
        });
        button.append(image);
        grid.append(button);
      }
      content.append(grid);
    }
    if (item.reply) {
      const reply = create('div', null, 'reply');
      reply.append(create('strong', 'От Даши ♡'), create('p', item.reply, 'note'));
      content.append(reply);
    }
  } else if(role === 'reader') {
    content.append(create('p','В этот день Лёня ещё ничего не добавил.','muted'));
  }
  byId('photos').value = '';
  byId('leon-day').value = item?.leonDay ?? '';
  byId('busya-day').value = item?.busyaDay ?? '';
  byId('bro-check').hidden = !feedingDay(day);
  byId('fed-bro').checked = Boolean(item?.fedBro);
  byId('entry-form').hidden = role !== 'writer' || Boolean(item?.approved);
  byId('review-form').hidden = role !== 'reader' || !item;
  if (item && role === 'reader') {
    const suggested = points(item,day);
    byId('suggestion').textContent = 'По правилам за эту запись: ' + suggested + ' 💋';
    byId('review-form').elements.rating.value = item.rating ?? suggested;
    byId('reply').value = item.reply ?? '';
    byId('approve').textContent = item.approved ? 'Обновить баллы и ответ' : 'Одобрить и начислить';
  }
  if(!byId('day-dialog').open) byId('day-dialog').showModal();
}
async function imageData(file) {
  if(file.size > 25_000_000) throw new Error('Выбери фото размером до 25 МБ.');
  const url=URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode().catch(()=>{throw new Error('Не удалось открыть фото. Попробуй JPEG или PNG.');});
    const ratio=Math.min(1,850/Math.max(image.naturalWidth,image.naturalHeight));
    const canvas=create('canvas');
    canvas.width=Math.max(1,Math.round(image.naturalWidth*ratio));
    canvas.height=Math.max(1,Math.round(image.naturalHeight*ratio));
    canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.82));
    if(!blob) throw new Error('Не удалось подготовить фото.');
    return blob;
  } finally { URL.revokeObjectURL(url); }
}
byId('login-button').addEventListener('click',async event=>{
  event.preventDefault();
  const button=event.currentTarget;
  button.disabled=true;
  byId('login-error').textContent='';
  try {
    await post('login',{password:byId('password').value});
    await restore();
  } catch(error) { byId('login-error').textContent=error.message; }
  finally { button.disabled=false; }
});
byId('back').addEventListener('click',async ()=>{
  try {
    await post('logout',{});
    role=undefined;
    state={entries:{},goal:12};
    byId('welcome').hidden=false;
    byId('diary').hidden=true;
    window.scrollTo(0,0);
  } catch(error) { byId('diary-error').textContent=error.message; }
});
byId('today-open').addEventListener('click',()=>{
  const day=todayForCard();
  if(role==='writer' && dates.includes(day)) openDay(day);
});
byId('close').addEventListener('click',()=>byId('day-dialog').close());
byId('goal').addEventListener('change',async event=>{
  const goal=event.target.valueAsNumber;
  if(!Number.isInteger(goal)||goal<1||goal>21){event.target.reportValidity();event.target.value=state.goal;return;}
  const input=event.target;
  input.disabled=true;
  try {
    await post('diary/goal',{goal});
    state.goal=goal;
    render();
    byId('diary-error').textContent='';
  } catch(error) {
    input.value=state.goal;
    byId('diary-error').textContent=error.message;
  } finally { input.disabled=false; }
});
byId('send-entry').addEventListener('click',async event=>{
  event.preventDefault();
  if(role!=='writer')return;
  const day=selected;
  const old=state.entries[day];
  if(old?.approved)return;
  const files=[...byId('photos').files];
  const note=old?.note ?? '';
  const leonDay=byId('leon-day').value.trim();
  const busyaDay=byId('busya-day').value.trim();
  const fedBro=feedingDay(day) && byId('fed-bro').checked;
  const errorBox=byId('entry-error');
  const kept=old?.photos ?? [];
  errorBox.textContent='';
  if(files.length+kept.length>4){errorBox.textContent='В один день можно добавить до четырёх фото.';return;}
  if(!files.length&&!kept.length&&!note&&!leonDay&&!busyaDay&&!fedBro){errorBox.textContent='Добавь фото, текст или отметь кормление Бро.';return;}
  const button=event.currentTarget;
  button.disabled=true;
  button.textContent='Отправляем…';
  try{
    const photos=[...kept,...await Promise.all(files.map(async file=>{
      const blob=await imageData(file);
      const {key}=await api('photos?day='+day,{method:'POST',headers:{'Content-Type':'image/jpeg'},body:blob});
      return '/'+key;
    }))];
    if(role!=='writer'||state.entries[day]?.approved)return;
    await saveDay(day,{photos,note,leonDay,busyaDay,fedBro});
    render();
    if(selected===day&&byId('day-dialog').open) byId('day-dialog').close();
    byId('action-status').textContent='Отправлено Даше ♡ Запись ждёт проверки.';
  }catch(error){errorBox.textContent=error.message;}
  finally{button.disabled=false;button.textContent='Отправить Даше';}
});
byId('close-photo').addEventListener('click',()=>byId('photo-dialog').close());
document.querySelectorAll('[data-filter]').forEach(button => {
  button.addEventListener('click',()=>{ filter=button.dataset.filter; renderQueue(); });
});
async function reviewEntry(event){
  event.preventDefault();
  const item=state.entries[selected];
  if(role!=='reader'||!item)return;
  const reply=byId('reply').value.trim();
  const action=event.currentTarget.value;
  const day=selected;
  const rating=action==='approve' ? Number(byId('review-form').elements.rating.value) : undefined;
  const controls=[byId('approve'),byId('reply-only')];
  controls.forEach(button=>{button.disabled=true;});
  try {
    await saveDay(day,{reply,rating});
    render();
    if(selected===day&&byId('day-dialog').open) openDay(day);
  } catch(error) { byId('entry-error').textContent=error.message; }
  finally { controls.forEach(button=>{button.disabled=false;}); }
}
byId('approve').addEventListener('click',reviewEntry);
byId('reply-only').addEventListener('click',reviewEntry);
byId('password').addEventListener('keydown',event=>{
  if(event.key==='Enter'){event.preventDefault();byId('login-button').click();}
});
restore().catch(error=>{
  if(error.status!==401) byId('login-error').textContent=error.message;
});
