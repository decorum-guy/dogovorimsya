import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { createApp } from '../server/app.js';
import { openDatabase, getReviews } from '../server/db.js';
import { sessionCookie, tokenHash } from '../server/auth.js';
import type { Bootstrap, Review } from '../shared/types.js';
import { inDirection } from '../shared/review-direction.js';

async function fixture(withPartner = true) {
  const directory = await mkdtemp(join(tmpdir(), 'dogovorimsya-two-way-'));
  const sent: { userId: number; reviewId: number; body: string; title: string }[] = [];
  const options = { dataDir: directory, origin: 'https://fictional.invalid', secure: false, demo: false,
    pushSender: async (_subscription: unknown, payload: string) => { sent.push(JSON.parse(payload)); } };
  const { app, db, notifications } = createApp(options), server = createServer(app);
  db.exec("INSERT INTO users (id,login,password_hash,name,role,is_admin) VALUES (1,'fictional-a','unused','Первый космос','reviewer',1)");
  if (withPartner) db.exec("INSERT INTO users (id,login,password_hash,name,role) VALUES (2,'fictional-b','unused','Второй космос','recipient')");
  const cookies: Record<number, string> = {};
  for (const id of withPartner ? [1, 2] : [1]) {
    const token = randomBytes(32).toString('hex');
    db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(tokenHash(token),id,Date.now()+86_400_000);
    cookies[id] = sessionCookie+'='+token;
    db.prepare('INSERT INTO push_subscriptions VALUES (?,?,?,?,?)').run('https://fcm.googleapis.com/fictional-two-way-'+id,id,tokenHash(token),'{}',Date.now());
  }
  await new Promise<void>(resolve => server.listen(0,'127.0.0.1',resolve));
  options.origin = 'http://127.0.0.1:'+(server.address() as AddressInfo).port;
  const request = (path: string, method = 'GET', body?: unknown, user = 1, key?: string) => fetch(options.origin+path, {
    method, headers: { Origin: options.origin, ...(body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), ...(cookies[user] ? { Cookie: cookies[user] } : {}), ...(key ? { 'Idempotency-Key':key } : {}) },
    body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body),
  });
  const bootstrap = async (id = 1) => await (await request('/api/bootstrap','GET',undefined,id)).json() as Bootstrap;
  const review = async (id: number) => (await bootstrap()).reviews.find(review => review.id === id)!;
  const input = { rating:49,title:'Вымышленная встречная нежность',body:'Только тестовые данные.',photoIds:[] as string[] };
  const edit = (review: Review) => ({ ...input,rating:review.rating,photoIds:review.photoIds,eventDate:review.eventDate,eventTime:review.eventTime,revision:review.revision });
  const close = async () => { await notifications.stop(); await new Promise<void>(resolve=>server.close(()=>resolve())); db.close(); await rm(directory,{recursive:true,force:true}); };
  return { db, directory, request, bootstrap, review, input, edit, notifications, sent, close };
}

test('reciprocal ratings preserve ownership, private interactions and notification direction', async t => {
  const f = await fixture(); let outgoing = 0, incoming = 0, recipientPhoto = '';
  try {
    await t.test('both create, the server chooses the other person and retry keys stay scoped to their author', async () => {
      const key = randomUUID();
      for (const user of [1,2]) {
        const response = await f.request('/api/reviews','POST',{ ...f.input, recipientId:user, authorId:999,isAdmin:true,role:'reviewer' },user,key);
        assert.equal(response.status,201);
        const id = (await response.json()).id;
        if (user === 1) outgoing=id; else incoming=id;
        assert.equal((await (await f.request('/api/reviews','POST',{ ...f.input,recipientId:user,authorId:999,isAdmin:true,role:'reviewer' },user,key)).json()).id,id);
        const review = await f.review(id);
        assert.equal(review.authorId,user); assert.equal(review.recipientId,user===1 ? 2 : 1);
        assert.equal(review.revisions.length,1);
      }
      assert.notEqual(outgoing,incoming);
      assert.equal((await f.bootstrap(2)).user.isAdmin,false);
      assert.deepEqual(f.db.prepare('SELECT user_id,kind,review_id FROM push_outbox ORDER BY rowid').all().map(row=>({...row})),[
        {user_id:2,kind:'review_created',review_id:outgoing},{user_id:1,kind:'review_created',review_id:incoming},
      ]);
      await f.notifications.drain();
      assert.ok(f.sent.every(push=>!JSON.stringify(push).includes(f.input.title) && !JSON.stringify(push).includes(f.input.body)));
    });
    await t.test('each edits only their own review, even when the other author is an admin', async () => {
      const before = await f.review(incoming);
      assert.equal((await f.request('/api/reviews/'+incoming,'PATCH',{...f.edit(before),rating:10},1)).status,403);
      assert.equal((await f.request('/api/reviews/'+outgoing,'PATCH',{...f.edit(await f.review(outgoing)),rating:10},2)).status,403);
      assert.equal((await f.request('/api/reviews/'+incoming,'PATCH',{...f.edit(before),rating:50,recipientId:2,authorId:1},2)).status,200);
      assert.equal((await f.request('/api/reviews/'+incoming,'PATCH',{...f.edit(before),rating:10},2)).status,409);
      const after = await f.review(incoming);
      assert.equal(after.authorId,2); assert.equal(after.recipientId,1);
      assert.deepEqual(after.revisions.map(version=>version.rating),[49,50]);
      assert.equal(f.db.prepare('SELECT user_id FROM push_outbox').get()!.user_id,1);
      await f.notifications.drain(); assert.equal(f.sent.at(-1)!.userId,1);
      const sent = f.sent.length;
      await f.request('/api/reviews/'+incoming,'PATCH',{...f.edit(after),body:'Правка текста, без изменения балла.'},2);
      await f.notifications.drain(); assert.equal(f.sent.length,sent);
    });
    await t.test('the reverse author can attach private photos; versions retain the originals', async () => {
      const bytes = await sharp({create:{width:40,height:40,channels:3,background:'#e9c7cf'}}).png().toBuffer();
      const form = new FormData(); form.set('kind','photo'); form.append('photos',new Blob([new Uint8Array(bytes)],{type:'image/png'}),'fictional.png');
      const response = await f.request('/api/uploads','POST',form,2);
      assert.equal(response.status,201); recipientPhoto=(await response.json()).ids[0];
      assert.equal((await f.request('/media/'+recipientPhoto,'GET',undefined,0)).status,401);
      assert.equal((await f.request('/media/'+recipientPhoto)).status,200);
      const before = await f.review(incoming);
      assert.equal((await f.request('/api/reviews/'+incoming,'PATCH',{...f.edit(before),photoIds:[recipientPhoto]},2)).status,200);
      const after = await f.review(incoming);
      assert.deepEqual(after.photoIds,[recipientPhoto]); assert.deepEqual(after.revisions.at(-2)!.photoIds,[]);
      assert.equal((await f.request('/api/reviews/'+outgoing,'PATCH',{...f.edit(await f.review(outgoing)),photoIds:[recipientPhoto]},1)).status,400);
    });
    await t.test('comments, photo captions, favorites and reactions work in each direction without self notifications', async () => {
      f.db.exec('DELETE FROM push_outbox');
      const cases = [
        [incoming+'/comments','POST',{body:'Ответ на встречную нежность'},1,2],
        [incoming+'/comments','POST',{photos:[{id:recipientPhoto,caption:'Вымышленная улика'}]},2,1],
        [incoming+'/favorite','PUT',{favorite:true},1,2],
        [incoming+'/favorite','PUT',{favorite:true},2,1],
        [outgoing+'/favorite','PUT',{favorite:true},2,1],
        [incoming+'/reactions','PUT',{emoji:'❤️',active:true},1,2],
        [outgoing+'/reactions','PUT',{emoji:'🔥',active:true},2,1],
      ] as const;
      for (const [path,method,body,actor,target] of cases) {
        const response = await f.request('/api/reviews/'+path,method,body,actor);
        assert.ok([200,201].includes(response.status));
        assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM push_outbox').get()!.n,1);
        await f.notifications.drain(); assert.equal(f.sent.at(-1)!.userId,target);
      }
      const comments=(await f.review(incoming)).comments;
      assert.equal((await f.request('/api/comments/'+comments[1].id,'PATCH',{body:'Чужая правка'},1)).status,403);
      assert.equal(comments[1].photos[0].caption,'Вымышленная улика');
      assert.equal((await f.bootstrap(1)).reviews.find(review=>review.id===outgoing)!.favorite,false);
      assert.equal((await f.bootstrap(2)).reviews.find(review=>review.id===outgoing)!.favorite,true);
    });
    await t.test('averages, distributions and feed filters stay separate for each recipient', async () => {
      const state=await f.bootstrap();
      assert.equal(state.statistics.reviewCount,2);
      assert.deepEqual(state.statistics.favorites,{reviewer:1,recipient:2,mutual:1});
      const first=state.statistics.participants.find(person=>person.userId===1)!;
      const second=state.statistics.participants.find(person=>person.userId===2)!;
      assert.deepEqual([first.receivedCount,first.sentCount,first.averageRating,first.perfectCount],[1,1,5,1]);
      assert.deepEqual([second.receivedCount,second.sentCount,second.averageRating,second.perfectCount],[1,1,4.9,0]);
      assert.equal(first.ratingDistribution.gold,1); assert.equal(second.ratingDistribution.rose,1);
      for (const [user,received,sent] of [[1,incoming,outgoing],[2,outgoing,incoming]]) {
        assert.deepEqual(state.reviews.filter(review=>inDirection(review,user,'received')).map(review=>review.id),[received]);
        assert.deepEqual(state.reviews.filter(review=>inDirection(review,user,'sent')).map(review=>review.id),[sent]);
        assert.equal(state.reviews.filter(review=>inDirection(review,user,'all')).length,2);
      }
    });
    await t.test('profile flavor never grants admin rights, and rating authors do not need admin rights', async () => {
      await f.request('/api/profile','PATCH',{name:'Второй космос',avatarId:null,role:'reviewer',isAdmin:true},2);
      assert.equal((await f.bootstrap(2)).user.role,'recipient'); assert.equal((await f.bootstrap(2)).user.isAdmin,false);
      for (const [path,method,body] of [['/api/admin/access','GET',undefined],['/api/admin/codes','POST',{}],['/api/admin/users/1/password','POST',{password:'fictional-hijack-123'}]] as const) assert.equal((await f.request(path,method,body,2)).status,403);
      assert.equal((await f.request('/api/admin/access')).status,200);
      f.db.exec('UPDATE users SET is_admin=0 WHERE id=1');
      assert.equal((await f.request('/api/admin/access')).status,403);
      assert.equal((await f.request('/api/reviews/'+outgoing,'PATCH',{...f.edit(await f.review(outgoing)),note:'Уточнение без админских прав'})).status,200);
      f.db.exec('UPDATE users SET is_admin=1 WHERE id=1');
      await f.request('/api/notifications/preferences','PATCH',{events:{review_created:false,rating_changed:false}},1);
      f.db.exec('DELETE FROM push_outbox');
      assert.equal((await f.request('/api/reviews','POST',f.input,2)).status,201);
      assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM push_outbox').get()!.n,0);
    });
  } finally { await f.close(); }
});

test('pending notes acquire the invited partner at signup without new revisions or retrospective pushes', async () => {
  const f=await fixture(false);
  try {
    const key=randomUUID();
    const created=await f.request('/api/reviews','POST',f.input,1,key), id=(await created.json()).id;
    const before=await f.review(id); assert.equal(before.recipientId,null);
    assert.equal(inDirection(before,1,'received'),false); assert.equal(inDirection(before,1,'sent'),true);
    const code=await (await f.request('/api/admin/codes','POST',{})).json();
    const response=await f.request('/api/register','POST',{code:code.code,login:'fictional-new-partner',name:'Второй космос',password:'fictional-invite-123',isAdmin:true,role:'reviewer'},0);
    assert.equal(response.status,201); const user=(await response.json()).user;
    assert.equal(user.isAdmin,false); assert.equal(user.role,'recipient');
    assert.deepEqual(await f.review(id),{...before,recipientId:user.id});
    assert.equal((await (await f.request('/api/reviews','POST',f.input,1,key)).json()).id,id);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM reviews').get()!.n,1);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM revisions').get()!.n,1);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM push_outbox').get()!.n,0);
    assert.equal((await f.bootstrap()).statistics.participants.find(person=>person.userId===user.id)!.receivedCount,1);
    assert.equal((await f.request('/api/register','POST',{code:code.code,login:'fictional-third',name:'Лишний',password:'fictional-invite-123'},0)).status,409);
  } finally { await f.close(); }
});

test('v7 upgrade assigns recipients and a separate admin flag without changing any legacy data', async () => {
  const directory=await mkdtemp(join(tmpdir(),'dogovorimsya-v8-migration-'));
  let db=openDatabase(directory);
  try {
    db.exec('ALTER TABLE users DROP COLUMN is_admin; ALTER TABLE reviews DROP COLUMN recipient_id; PRAGMA user_version=7;');
    db.exec("INSERT INTO users (id,login,password_hash,name,role,registered_at) VALUES (41,'fictional-a','unchanged-a','Первый','reviewer','2026-11-01T09:00:00Z'),(83,'fictional-b','unchanged-b','Второй','recipient','2026-11-02T09:00:00Z'); INSERT INTO sessions VALUES ('fictional-session',41,9999999999999);");
    db.exec("INSERT INTO reviews (id,author_id,rating,title,body,event_date,event_time,created_at,updated_at,revision,design_variant) VALUES (77,41,49,'Личная вымышленная запись','Первый текст','2026-11-02','12:34','2026-11-02T09:34:00Z','2026-11-02T11:00:00Z',2,3); INSERT INTO revisions (id,review_id,user_id,rating,title,body,event_date,event_time,photo_ids,note,created_at) VALUES (9,77,41,45,'Старая версия','Текст','2026-11-02','12:34','[]','','2026-11-02T09:34:00Z'),(10,77,41,49,'Личная вымышленная запись','Первый текст','2026-11-02','12:34','[]','Причина','2026-11-02T11:00:00Z'); INSERT INTO comments (review_id,user_id,body,photos,created_at,updated_at,revision) VALUES (77,83,'Текст с фото','[]','2026-11-02T12:00:00Z','2026-11-02T12:01:00Z',2); INSERT INTO favorites VALUES (77,41),(77,83); INSERT INTO reactions VALUES (77,83,'❤️');");
    const tables=['users','reviews','revisions','comments','sessions','favorites','reactions','access_codes','notification_preferences','push_subscriptions','push_outbox','media','write_receipts'];
    const before=tables.map(table=>({table,columns:db.prepare('PRAGMA table_info('+table+')').all().map(column=>String(column.name)),rows:db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all()}));
    db.close(); db=openDatabase(directory);
    assert.equal(db.prepare('PRAGMA user_version').get()!.user_version,8);
    for (const {table,columns,rows} of before) assert.deepEqual(db.prepare('SELECT '+columns.join(',')+' FROM '+table+' ORDER BY rowid').all(),rows,table+' must retain every old value');
    assert.equal(db.prepare('SELECT recipient_id FROM reviews WHERE id=77').get()!.recipient_id,83);
    assert.equal(db.prepare('SELECT is_admin FROM users WHERE id=41').get()!.is_admin,1);
    assert.equal(db.prepare('SELECT is_admin FROM users WHERE id=83').get()!.is_admin,0);
    assert.throws(()=>db.exec('UPDATE reviews SET recipient_id=author_id'));
    const state=getReviews(db,41); assert.equal(state[0].recipientId,83); assert.equal(state[0].revisions.length,2);
    db.exec('UPDATE users SET is_admin=0 WHERE id=41');
    db.close(); db=openDatabase(directory);
    assert.equal(db.prepare('SELECT is_admin FROM users WHERE id=41').get()!.is_admin,0,'restarting must not re-grant admin based on profile');
    assert.deepEqual(getReviews(db,41),state);
  } finally { db.close(); await rm(directory,{recursive:true,force:true}); }
});
