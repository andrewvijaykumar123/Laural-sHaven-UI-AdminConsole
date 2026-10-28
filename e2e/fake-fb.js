/* End-to-end test double for fb.js (the bundled Firebase SDK). It talks to the in-process fake Firestore in e2e/world.js
   through window.__fbCall (a Playwright binding) and receives snapshots through window.__fbPush. Test use only. */
(() => {
  'use strict';
  const call = (op, args) => window.__fbCall(op, args);
  const revive = (v) => (v && typeof v === 'object' && !Array.isArray(v) && '__ts' in v ? { toMillis: () => v.__ts, toDate: () => new Date(v.__ts) } : v);
  const reviveDoc = (d) => { const o = {}; Object.keys(d).forEach((k) => { o[k] = revive(d[k]); }); return o; };
  const fail = (e) => Object.assign(new Error(e.message || e.code), { code: e.code });

  /* ----- auth ----- */
  const saved = () => { try { return JSON.parse(localStorage.getItem('fake.user')); } catch (e) { return null; } };
  const mkUser = (u) => (u ? { uid: u.uid, isAnonymous: !!u.anon, getIdToken: async () => `fake-token-${u.uid}` } : null);
  const auth = { currentUser: mkUser(saved()) };
  const subs = new Set();
  const setUser = (u) => {
    if (u) localStorage.setItem('fake.user', JSON.stringify(u)); else localStorage.removeItem('fake.user');
    auth.currentUser = mkUser(u);
    subs.forEach((cb) => cb(auth.currentUser));
  };
  const uidNow = () => (auth.currentUser ? auth.currentUser.uid : null);

  /* ----- references ----- */
  const doc = (base, ...segs) => {
    const path = (base && base.type === 'col' ? [base.path, ...segs] : segs).join('/');
    const p = path.split('/');
    return { type: 'doc', path, id: p[p.length - 1], col: p.slice(0, -1).join('/') };
  };
  const collection = (db, ...segs) => ({ type: 'col', path: segs.join('/') });
  const query = (col, ...cons) => ({ type: 'query', col: col.path, cons });
  const spec = (t) => (t.type === 'doc' ? { doc: t.path } : t.type === 'col' ? { col: t.path, cons: [] } : { col: t.col, cons: t.cons });

  const mkDoc = (path, data) => ({ id: path.split('/').pop(), ref: { path }, exists: () => true, data: () => reviveDoc(data), metadata: { fromCache: false } });

  /* ----- listeners ----- */
  const listeners = new Map();
  let lid = 0;
  const onSnapshot = (target, a, b, c) => {
    const fn = typeof a === 'function';
    const next = fn ? a : b;
    const err = fn ? b : c;
    const id = ++lid;
    listeners.set(id, { target, next, err });
    call('listen', { id, spec: spec(target), uid: uidNow() });
    return () => { listeners.delete(id); call('unlisten', { id }); };
  };
  window.__fbPush = (id, msg) => {
    const l = listeners.get(id);
    if (!l) return;
    if (msg.err) { if (l.err) l.err(fail(msg.err)); return; }
    const byId = new Map(msg.docs.map((d) => [d.path, d]));
    if (l.target.type === 'doc') {
      const d = msg.docs[0];
      l.next(d ? mkDoc(d.path, d.data) : { exists: () => false, data: () => undefined, id: l.target.id, metadata: { fromCache: false } });
      return;
    }
    const docs = msg.docs.map((d) => mkDoc(d.path, d.data));
    l.next({
      docs, empty: docs.length === 0, size: docs.length, metadata: { fromCache: false },
      docChanges: () => msg.changes.map((c) => ({ type: c.type, doc: mkDoc(c.path, (byId.get(c.path) || { data: {} }).data) }))
    });
  };

  /* ----- writes and reads ----- */
  const setDoc = async (ref, data, opts) => {
    const r = await call('set', { path: ref.path, data, merge: !!(opts && opts.merge), uid: uidNow() });
    if (r && r.err) throw fail(r.err);
  };
  const getDocs = async (q) => {
    const r = await call('get', { spec: spec(q), uid: uidNow() });
    if (r.err) throw fail(r.err);
    const docs = r.docs.map((d) => mkDoc(d.path, d.data));
    return { docs, empty: !docs.length, size: docs.length };
  };
  const writeBatch = () => {
    const ops = [];
    return {
      set(ref, data, opts) { ops.push({ op: 'set', path: ref.path, data, merge: !!(opts && opts.merge) }); return this; },
      delete(ref) { ops.push({ op: 'delete', path: ref.path }); return this; },
      async commit() { const r = await call('batch', { ops, uid: uidNow() }); if (r && r.err) throw fail(r.err); }
    };
  };

  window.LH_FB = {
    initializeApp: () => ({}),
    getAuth: () => auth, initializeAuth: () => auth,
    indexedDBLocalPersistence: {}, browserLocalPersistence: {},
    onAuthStateChanged: (a, cb) => { subs.add(cb); setTimeout(() => cb(auth.currentUser), 0); return () => subs.delete(cb); },
    signInAnonymously: async () => {
      const r = await call('signin', { anon: true });
      setUser({ uid: r.uid, anon: true });
      return { user: auth.currentUser };
    },
    signInWithEmailAndPassword: async (a, email, password) => {
      const r = await call('signin', { email, password });
      if (r.err) throw fail(r.err);
      setUser({ uid: r.uid, anon: false });
      return { user: auth.currentUser };
    },
    signOut: async () => setUser(null),
    initializeFirestore: () => ({}), getFirestore: () => ({}), persistentLocalCache: () => ({}), persistentMultipleTabManager: () => ({}),
    doc, collection, setDoc, onSnapshot, query,
    where: (f, op, v) => ({ kind: 'where', f, op, v }),
    orderBy: (f, dir) => ({ kind: 'order', f, dir: dir || 'asc' }),
    limit: (n) => ({ kind: 'limit', n }),
    writeBatch, getDocs,
    serverTimestamp: () => ({ __serverTs: true }),
    enableNetwork: async () => {}, disableNetwork: async () => {}
  };
  window.LH_QR = () => 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';
})();
