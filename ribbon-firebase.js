/* Ribbon: connects the app to Firebase (sign-in, shared lists, photos, AI ideas, reminders).
   It exposes window.RB with the same small database API the app was written against. */
const V = "10.12.2";
const G = `https://www.gstatic.com/firebasejs/${V}/`;
const CONFIG = {
  apiKey: "AIzaSyBYJobGD6gkSmLBWGsNXPh5drcLaXal5n4",
  authDomain: "ribbon-a1d6f.firebaseapp.com",
  projectId: "ribbon-a1d6f",
  storageBucket: "ribbon-a1d6f.firebasestorage.app",
  messagingSenderId: "8151824228",
  appId: "1:8151824228:web:adc24385cd60af4465ac71"
};
const VAPID = "BFH2ja1IBCjRqMmHGDjp2EqQBnQD3rfNNNQ8nqnMjo-6_a3LClxlou5d3K0BmxEkg3Js5kX9smR1OcMeMpPDswg";
const REGION = "europe-west2";

(async () => {
try {
  const [appM, authM, fsM, stM, fnM, msgM] = await Promise.all([
    import(G + "firebase-app.js"), import(G + "firebase-auth.js"), import(G + "firebase-firestore.js"),
    import(G + "firebase-storage.js"), import(G + "firebase-functions.js"), import(G + "firebase-messaging.js")
  ]);
  const app = appM.initializeApp(CONFIG);
  const auth = authM.getAuth(app);
  let fs;
  try { fs = fsM.initializeFirestore(app, { ignoreUndefinedProperties: true, localCache: fsM.persistentLocalCache({ tabManager: fsM.persistentMultipleTabManager() }) }); }
  catch (e) { fs = fsM.initializeFirestore(app, { ignoreUndefinedProperties: true }); }
  const storage = stM.getStorage(app);
  const fns = fnM.getFunctions(app, REGION);
  const call = (name, data) => fnM.httpsCallable(fns, name, { timeout: 90000 })(data).then(r => r.data);

  /* ---- database shim ---- */
  const CODES = { "permission-denied": "invalid_argument", "unauthenticated": "invalid_argument", "resource-exhausted": "resource_exhausted", "not-found": "not_found" };
  function mapErr(e) { const c = String((e && e.code) || "").replace(/^(firestore|storage|functions)\//, ""); const x = new Error((e && e.message) || "error"); x.code = CODES[c] || c || "unknown"; x.raw = e; return x; }
  const thrower = e => { throw mapErr(e); };
  const wrapDoc = s => ({ id: s.id, exists: s.exists(), data: () => s.data() || {}, metadata: s.metadata });
  const wrapQuery = s => ({ docs: s.docs.map(wrapDoc), size: s.size, empty: s.empty, metadata: s.metadata });
  const isPlain = v => v && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype;
  function flatten(obj, pre = [], out = []) {
    for (const [k, v] of Object.entries(obj)) {
      if (v === undefined) continue;
      const p = pre.concat(k);
      if (isPlain(v) && Object.keys(v).length) flatten(v, p, out); else out.push([p, v]);
    }
    return out;
  }
  function D(r) {
    return {
      id: r.id, _ref: r,
      get: () => fsM.getDoc(r).then(wrapDoc, thrower),
      set: (d, o) => fsM.setDoc(r, d, o || {}).catch(thrower),
      /* Nested maps are merged (e.g. {approvals:{Dube:true}} keeps the others' approvals). */
      update: async d => {
        const pairs = flatten(d); if (!pairs.length) return;
        const args = []; pairs.forEach(([p, v]) => args.push(new fsM.FieldPath(...p), v));
        try { await fsM.updateDoc(r, ...args); }
        catch (e) { if (String(e && e.code).includes("not-found")) await fsM.setDoc(r, d, { merge: true }).catch(thrower); else throw mapErr(e); }
      },
      delete: () => fsM.deleteDoc(r).catch(thrower),
      onSnapshot: (cb, err) => fsM.onSnapshot(r, s => cb(wrapDoc(s)), e => err && err(mapErr(e)))
    };
  }
  function Q(q) {
    return {
      where: (f, op, v) => Q(fsM.query(q, fsM.where(f, op, v))),
      orderBy: (f, dir) => Q(fsM.query(q, fsM.orderBy(f, dir))),
      limit: n => Q(fsM.query(q, fsM.limit(n))),
      get: () => fsM.getDocs(q).then(wrapQuery, thrower),
      onSnapshot: (cb, err) => fsM.onSnapshot(q, s => cb(wrapQuery(s)), e => err && err(mapErr(e)))
    };
  }
  function C(path) {
    const c = fsM.collection(fs, path);
    return Object.assign(Q(c), { doc: id => D(id ? fsM.doc(c, id) : fsM.doc(c)), add: d => fsM.addDoc(c, d).then(D, thrower) });
  }
  const db = { doc: p => D(fsM.doc(fs, p)), collection: C };

  /* ---- sign-in ---- */
  async function memberName() {
    const u = auth.currentUser; if (!u) return null;
    try { const s = await fsM.getDoc(fsM.doc(fs, "members/" + u.uid)); if (s.exists()) return s.data().name; } catch (e) { /* not a member yet: rules hide the doc */ }
    try { const r = await call("claimMember", {}); return (r && r.name) || null; }
    catch (e) { const c = String(e && e.code); if (c.includes("permission-denied")) return null; throw mapErr(e); }
  }

  /* ---- photos ---- */
  const assets = {
    async upload(blob) {
      const u = auth.currentUser; if (!u) throw Object.assign(new Error("signed out"), { code: "invalid_argument" });
      const path = `uploads/${u.uid}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}.jpg`;
      const ref = stM.ref(storage, path);
      await stM.uploadBytes(ref, blob, { contentType: blob.type || "image/jpeg" }).catch(thrower);
      return { id: path, url: await stM.getDownloadURL(ref) };
    }
  };

  /* ---- downloads ---- */
  const TYPES = { json: "application/json", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };
  const downloads = {
    async save({ filename, data }) {
      const ext = String(filename).split(".").pop().toLowerCase();
      const blob = data instanceof Blob && data.type ? data : new Blob([data], { type: TYPES[ext] || "application/octet-stream" });
      const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
      if (ios && navigator.canShare) {
        const file = new File([blob], filename, { type: blob.type });
        if (navigator.canShare({ files: [file] })) {
          try { await navigator.share({ files: [file] }); return; }
          catch (e) { if (e && e.name === "AbortError") throw Object.assign(new Error("declined"), { code: "declined" }); }
        }
      }
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = filename;
      document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 5000);
    }
  };

  /* ---- AI gift ideas (runs in a Cloud Function so the API key stays private) ---- */
  async function ask(prompt, json) {
    try { return await call("ai", { prompt, json: !!json }); }
    catch (e) { const c = String(e && e.code); const x = new Error("ai"); x.code = c.includes("resource-exhausted") ? "rate_limited" : c.includes("permission-denied") ? "not_granted" : "failed"; throw x; }
  }
  const sample = Object.assign(async (prompt) => ({ text: (await ask(prompt)).text || "" }), {
    json: async (prompt) => { const t = (await ask(prompt, true)).text || ""; const m = t.match(/[\[{][\s\S]*[\]}]/); return m ? JSON.parse(m[0]) : null; }
  });

  /* ---- service worker and reminders ---- */
  const swReg = ("serviceWorker" in navigator) ? navigator.serviceWorker.register("sw.js", { scope: "./" }).catch(() => null) : Promise.resolve(null);
  const pushSupported = await msgM.isSupported().catch(() => false) && "Notification" in window && "serviceWorker" in navigator;
  const messaging = pushSupported ? msgM.getMessaging(app) : null;
  async function saveToken(name) {
    const reg = await swReg; if (!reg || !messaging) throw new Error("no sw");
    await navigator.serviceWorker.ready;
    const token = await msgM.getToken(messaging, { vapidKey: VAPID, serviceWorkerRegistration: reg });
    if (!token) throw new Error("no token");
    const old = localStorage.getItem("ribbon-push-token");
    if (old && old !== token) fsM.deleteDoc(fsM.doc(fs, "tokens/" + old)).catch(() => {});
    await fsM.setDoc(fsM.doc(fs, "tokens/" + token), { uid: auth.currentUser.uid, name, at: new Date().toISOString(), ua: navigator.userAgent.slice(0, 200) });
    localStorage.setItem("ribbon-push-token", token);
    return token;
  }
  async function enablePush(name) {
    if (!messaging) return { ok: false };
    const p = await Notification.requestPermission();
    if (p !== "granted") return { ok: false, denied: p === "denied" };
    await saveToken(name); return { ok: true };
  }
  async function disablePush() {
    const t = localStorage.getItem("ribbon-push-token"); localStorage.removeItem("ribbon-push-token");
    if (t) await fsM.deleteDoc(fsM.doc(fs, "tokens/" + t)).catch(() => {});
    if (messaging) await msgM.deleteToken(messaging).catch(() => {});
  }

  /* ---- one-time import from the old app ---- */
  const COLS = ["items", "payments", "prefs", "proposals", "picks", "comments", "feedback", "profiles", "config"];
  async function importAll(json, by) {
    const ops = [];
    for (const c of COLS) for (const d of (json.collections[c] || [])) {
      if (!d || !d.id) continue;
      const data = Object.assign({}, d.data || {}); if (c === "profiles") { delete data.hash; delete data.salt; delete data.iterations; delete data.resetAt; }
      ops.push([c + "/" + d.id, data]);
    }
    for (let i = 0; i < ops.length; i += 400) {
      const b = fsM.writeBatch(fs);
      ops.slice(i, i + 400).forEach(([p, data]) => b.set(fsM.doc(fs, p), data));
      await b.commit().catch(thrower);
    }
    await fsM.setDoc(fsM.doc(fs, "meta/import"), { by, at: new Date().toISOString(), count: ops.length, exportedAt: json.exportedAt || "" });
    return ops.length;
  }

  window.RB = {
    db, assets, downloads, sample, pushSupported,
    onAuth: cb => authM.onAuthStateChanged(auth, cb),
    signIn: (e, p) => authM.signInWithEmailAndPassword(auth, e, p),
    signUp: (e, p) => authM.createUserWithEmailAndPassword(auth, e, p),
    resetPassword: e => authM.sendPasswordResetEmail(auth, e),
    signOut: async () => { await disablePush().catch(() => {}); return authM.signOut(auth); },
    changePassword: async (oldPw, newPw) => {
      const u = auth.currentUser;
      await authM.reauthenticateWithCredential(u, authM.EmailAuthProvider.credential(u.email, oldPw));
      await authM.updatePassword(u, newPw);
    },
    memberName, enablePush, disablePush, refreshPush: saveToken, importAll
  };
  window.dispatchEvent(new Event("rb-ready"));
} catch (e) {
  console.error("Ribbon failed to start", e);
  window.dispatchEvent(new Event("rb-failed"));
}
})();
