const firstDay = '2026-11-28';
const firstFeeding = '2026-11-27';
const lastDay = '2026-12-29';
const dayPattern = /^2026-(?:11-(?:28|29|30)|12-(?:0[1-9]|1[0-9]|2[0-9]))$/;
const imagePattern = /^\/photos\/(2026-\d{2}-\d{2})\/[a-f0-9-]{36}$/;

async function diaryRequest(request, bucket, pathname, role, json) {
  if (request.method === 'GET' && pathname === '/api/diary') {
    const [index, settings] = await Promise.all([
      bucket.list({prefix:'diary/day/', limit:40}), bucket.get('diary/settings')
    ]);
    const records = await Promise.all(index.objects.map(async ({key}) => {
      const object = await bucket.get(key);
      return object && [key.split('/').at(-1), {...await object.json(), version:object.etag}];
    }));
    const data = settings ? await settings.json() : {goal:12};
    return json({goal:data.goal, entries:Object.fromEntries(records.filter(Boolean))});
  }
  if (request.method !== 'POST') return json({error:'Страница не найдена.'},404);
  const length = Number(request.headers.get('Content-Length'));
  if (length > 8192) return json({error:'Запись слишком длинная.'},413);
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return json({error:'Проверь запись.'},400);

  if (pathname === '/api/diary/goal') {
    if (role !== 'reader') return json({error:'Цель меняет Даша.'},403);
    const {goal} = body;
    if (!Number.isInteger(goal) || goal < 1 || goal > 21) return json({error:'Укажи цель от 1 до 21.'},400);
    await bucket.put('diary/settings',JSON.stringify({goal}));
    return json({goal});
  }
  const day = pathname.split('/').at(-1);
  if (!dayPattern.test(day) || day < firstDay || day > lastDay) return json({error:'Этой даты нет в календаре.'},404);
  const key = 'diary/day/' + day;
  const current = await bucket.get(key);
  const previous = current ? await current.json() : null;
  if ((body.version ?? null) !== (current?.etag ?? null)) {
    return json({error:'Запись уже изменилась. Открой день заново.'},409);
  }

  let updated;
  if (role === 'writer') {
    if (previous?.approved) return json({error:'Даша уже одобрила этот день.'},409);
    const {photos,note,leonDay='',busyaDay='',fedBro=false} = body;
    const feedingDay = (Date.parse(day) - Date.parse(firstFeeding)) / 86400000 % 2 === 0;
    if (!Array.isArray(photos) || photos.length > 4 || new Set(photos).size !== photos.length ||
        !photos.every(url => typeof url === 'string' && imagePattern.exec(url)?.[1] === day) ||
        typeof note !== 'string' || note.length > 700 ||
        [leonDay,busyaDay].some(value => typeof value !== 'string' || value.length > 500) ||
        typeof fedBro !== 'boolean' || (fedBro && !feedingDay) ||
        (!photos.length && !note.trim() && !leonDay.trim() && !busyaDay.trim() && !fedBro)) {
      return json({error:'Добавь до четырёх фото или послание.'},400);
    }
    const objects = await Promise.all(photos.map(url => bucket.head(url.slice(1))));
    if (objects.some(object => !object)) return json({error:'Не удалось найти загруженное фото.'},400);
    updated = {...previous,photos,note:note.trim(),leonDay:leonDay.trim(),busyaDay:busyaDay.trim(),fedBro,approved:false};
  } else {
    if (!previous) return json({error:'Лёня ещё не добавил запись.'},404);
    const {reply,rating} = body;
    if (typeof reply !== 'string' || reply.length > 700 ||
        (rating !== undefined && ![1,2,3].includes(rating))) {
      return json({error:'Проверь комментарий и количество поцелуйчиков.'},400);
    }
    updated = {...previous,reply:reply.trim()};
    if (rating !== undefined) Object.assign(updated,{approved:true,rating});
  }
  const onlyIf = new Headers(current ? {'If-Match':current.httpEtag} : {'If-None-Match':'*'});
  const result = await bucket.put(key,JSON.stringify(updated),{onlyIf});
  if (!result) return json({error:'Запись уже изменилась. Открой день заново.'},409);
  return json({...updated,version:result.etag});
}
