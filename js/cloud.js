// js/cloud.js — Firebase-Anbindung für verschlüsselte EDUBAN-Dateien
import { schoolDatabases } from '../config-databases.js';

const DB_KEY = 'thomaeum';
const AUTH_KEY = 'kf_firebase_auth';
const STUDENT_ID_KEY = 'kf_student_cloud_id';
const FIREBASE_SDK_VERSION = '10.14.1';

const cfg = schoolDatabases?.[DB_KEY]?.config || null;
let appCheckInstancePromise = null;

function getConfig() {
  if (!cfg?.apiKey || !cfg?.projectId || cfg.apiKey === 'PLATZHALTER') {
    throw new Error('Firebase ist für diese Schule noch nicht eingerichtet.');
  }
  return cfg;
}

function b64Url(bytes) {
  let s = '';
  const arr = new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function randomId(prefix = 'kf') {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return `${prefix}_${b64Url(bytes)}`;
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

async function sha256Text(text) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return b64Url(hash).slice(0, 32);
}

function readAuth() {
  try {
    const auth = JSON.parse(localStorage.getItem(AUTH_KEY) || 'null');
    if (auth?.idToken && auth?.expiresAt && auth.expiresAt > Date.now() + 60000) return auth;
  } catch(e) {}
  return null;
}

async function getAppCheckInstance() {
  const config = getConfig();
  const siteKey = config.appCheckSiteKey;
  if (!siteKey || siteKey === 'PLATZHALTER') return null;
  if (!appCheckInstancePromise) {
    appCheckInstancePromise = Promise.all([
      import(`https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/firebase-app.js`),
      import(`https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/firebase-app-check.js`),
    ]).then(([firebaseApp, firebaseAppCheck]) => {
      const app = firebaseApp.getApps().find(existing => existing.options?.projectId === config.projectId)
        || firebaseApp.initializeApp(config);
      return firebaseAppCheck.initializeAppCheck(app, {
        provider: new firebaseAppCheck.ReCaptchaEnterpriseProvider(siteKey),
        isTokenAutoRefreshEnabled: true,
      });
    }).catch(err => {
      appCheckInstancePromise = null;
      throw err;
    });
  }
  return appCheckInstancePromise;
}

async function getAppCheckToken() {
  const appCheck = await getAppCheckInstance();
  if (!appCheck) return '';
  try {
    const { getToken } = await import(`https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/firebase-app-check.js`);
    const result = await getToken(appCheck, false);
    return result?.token || '';
  } catch (err) {
    throw new Error(`App Check konnte nicht bestätigt werden. ${err?.message || err || ''}`.trim());
  }
}

async function firebaseHeaders({ auth = null, json = false } = {}) {
  const headers = {};
  const appCheckToken = await getAppCheckToken();
  if (appCheckToken) headers['X-Firebase-AppCheck'] = appCheckToken;
  if (auth?.idToken) headers.Authorization = `Bearer ${auth.idToken}`;
  if (json) headers['Content-Type'] = 'application/json';
  return headers;
}

async function ensureAuth() {
  const cached = readAuth();
  if (cached) return cached;

  const { apiKey } = getConfig();
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: await firebaseHeaders({ json: true }),
    body: JSON.stringify({ returnSecureToken: true }),
  });
  if (!res.ok) throw new Error('Anonyme Firebase-Anmeldung fehlgeschlagen.');
  const json = await res.json();
  const auth = {
    uid: json.localId,
    idToken: json.idToken,
    refreshToken: json.refreshToken,
    expiresAt: Date.now() + (Number(json.expiresIn || 3600) * 1000),
  };
  localStorage.setItem(AUTH_KEY, JSON.stringify(auth));
  return auth;
}

function apiBase() {
  const { projectId } = getConfig();
  return `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
}

async function listDocumentsPaged(collectionPath, { auth, pageSize = 100 } = {}) {
  const docs = [];
  let pageToken = '';

  do {
    const url = new URL(`${apiBase()}/${collectionPath}`);
    url.searchParams.set('pageSize', String(pageSize));
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const res = await fetch(url.toString(), {
      headers: await firebaseHeaders({ auth }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Lesen aus Firebase fehlgeschlagen.${detail ? ' ' + detail.slice(0, 160) : ''}`);
    }
    const json = await res.json();
    docs.push(...(json.documents || []));
    pageToken = json.nextPageToken || '';
  } while (pageToken);

  return docs.map(docToPlain);
}

async function runStructuredQuery(queryBody, { auth } = {}) {
  const res = await fetch(`${apiBase()}:runQuery`, {
    method: 'POST',
    headers: await firebaseHeaders({ auth, json: true }),
    body: JSON.stringify(queryBody),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Datenbanksuche fehlgeschlagen.${detail ? ' ' + detail.slice(0, 160) : ''}`);
  }
  const rows = await res.json();
  return (rows || [])
    .map(row => row.document)
    .filter(Boolean)
    .map(docToPlain);
}

function valToFs(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(valToFs) } };
  if (typeof value === 'object') {
    const fields = {};
    Object.entries(value).forEach(([k, v]) => { fields[k] = valToFs(v); });
    return { mapValue: { fields } };
  }
  return { stringValue: String(value) };
}

function fsToVal(field) {
  if (!field || typeof field !== 'object') return null;
  if ('stringValue' in field) return field.stringValue;
  if ('booleanValue' in field) return field.booleanValue;
  if ('integerValue' in field) return Number(field.integerValue);
  if ('doubleValue' in field) return field.doubleValue;
  if ('timestampValue' in field) return field.timestampValue;
  if ('nullValue' in field) return null;
  if ('arrayValue' in field) return (field.arrayValue.values || []).map(fsToVal);
  if ('mapValue' in field) {
    const obj = {};
    Object.entries(field.mapValue.fields || {}).forEach(([k, v]) => { obj[k] = fsToVal(v); });
    return obj;
  }
  return null;
}

function docToPlain(doc) {
  const data = {};
  Object.entries(doc.fields || {}).forEach(([k, v]) => { data[k] = fsToVal(v); });
  data._path = doc.name;
  data._id = doc.name?.split('/').pop() || '';
  return data;
}

function parseEncryptedPayload(jsonText) {
  const payload = JSON.parse(jsonText);
  if (payload?.encrypted !== true || !payload?.encData) {
    throw new Error('Es dürfen nur verschlüsselte EDUBAN-Dateien hochgeladen werden.');
  }
  return {
    format: 'kanbanfluss-encrypted-v1',
    kanbanfluss: payload.kanbanfluss === true,
    encrypted: true,
    version: payload.version || 2,
    teacherName: payload.teacherName || '',
    stuKeyEnc: payload.stuKeyEnc || null,
    tchKeyEnc: payload.tchKeyEnc || null,
    encData: payload.encData,
    exportedAt: payload.exportedAt || new Date().toISOString(),
  };
}

window.kfCloud = {
  getStudentId() {
    let id = localStorage.getItem(STUDENT_ID_KEY);
    if (!id) {
      id = randomId('stu');
      localStorage.setItem(STUDENT_ID_KEY, id);
    }
    return id;
  },

  async getStableStudentId({ teacherPublicKeyJwk, studentLabel } = {}) {
    const label = String(studentLabel || '').trim().toLowerCase().replace(/\s+/g, ' ');
    if (!teacherPublicKeyJwk || !label) return this.getStudentId();
    return `stu_${await sha256Text(`${stableStringify(teacherPublicKeyJwk)}|${label}`)}`;
  },

  async getTeacherId(publicKeyJwk) {
    if (!publicKeyJwk) throw new Error('Tutor-Schlüssel fehlt.');
    return sha256Text(stableStringify(publicKeyJwk));
  },

  async getPasswordShareId({ teacherPublicKeyJwk, studentPassword } = {}) {
    if (!teacherPublicKeyJwk || !studentPassword) return '';
    return `share_${await sha256Text(`${stableStringify(teacherPublicKeyJwk)}|${studentPassword}`)}`;
  },

  async saveEncryptedFile({ encryptedJson, json, teacherPublicKeyJwk, studentId, studentLabel, title = '', kind, appVersion = 'standalone-1.0', passwordShareId = '' }) {
    const auth = await ensureAuth();
    const teacherId = await this.getTeacherId(teacherPublicKeyJwk);
    const payload = parseEncryptedPayload(encryptedJson || json);
    const now = new Date().toISOString();
    const fileId = `${kind}-${Date.now()}-${randomId('file')}`;
    const doc = {
      teacherId,
      studentId: studentId || this.getStudentId(),
      studentLabel: studentLabel || '',
      title: title || '',
      kind,
      createdAt: now,
      updatedAt: now,
      appVersion,
      payload,
    };

    const collectionPath = kind === 'student-private' && passwordShareId
      ? `kanbanPasswordFiles/${encodeURIComponent(passwordShareId)}/files`
      : kind === 'student-private'
        ? `kanbanPrivateFiles/${encodeURIComponent(doc.studentId)}/files`
      : `kanbanFiles/${encodeURIComponent(teacherId)}/files`;
    const res = await fetch(`${apiBase()}/${collectionPath}?documentId=${encodeURIComponent(fileId)}`, {
      method: 'POST',
      headers: await firebaseHeaders({ auth, json: true }),
      body: JSON.stringify({ fields: Object.fromEntries(Object.entries(doc).map(([k, v]) => [k, valToFs(v)])) }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Speichern in Firebase fehlgeschlagen.${detail ? ' ' + detail.slice(0, 160) : ''}`);
    }
    return { ...doc, fileId };
  },

  async listTeacherFiles(teacherPublicKeyJwk) {
    const auth = await ensureAuth();
    const teacherId = await this.getTeacherId(teacherPublicKeyJwk);
    return (await listDocumentsPaged(`kanbanFiles/${encodeURIComponent(teacherId)}/files`, { auth }))
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  },

  async findTeacherFilesByName(teacherName) {
    const auth = await ensureAuth();
    const name = String(teacherName || '').trim();
    if (!name) return [];
    return (await runStructuredQuery({
      structuredQuery: {
        from: [{ collectionId: 'files', allDescendants: true }],
        where: {
          fieldFilter: {
            field: { fieldPath: 'payload.teacherName' },
            op: 'EQUAL',
            value: { stringValue: name },
          },
        },
      },
    }, { auth }))
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  },

  async listStudentPrivateFiles({ teacherPublicKeyJwk, studentLabel } = {}) {
    const auth = await ensureAuth();
    const studentId = await this.getStableStudentId({ teacherPublicKeyJwk, studentLabel });
    const legacyStudentId = this.getStudentId();
    const ids = Array.from(new Set([studentId, legacyStudentId].filter(Boolean)));
    const all = [];

    for (const id of ids) {
      const docs = await listDocumentsPaged(`kanbanPrivateFiles/${encodeURIComponent(id)}/files`, { auth });
      all.push(...docs.map(doc => ({ ...doc, _privateFile: true })));
    }

    return all
      .filter(doc => doc.kind === 'student-private')
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  },

  async listStudentPrivateFilesForTeacher(teacherPublicKeyJwk) {
    const auth = await ensureAuth();
    const teacherId = await this.getTeacherId(teacherPublicKeyJwk);
    return (await runStructuredQuery({
      structuredQuery: {
        from: [{ collectionId: 'files', allDescendants: true }],
        where: {
          fieldFilter: {
            field: { fieldPath: 'teacherId' },
            op: 'EQUAL',
            value: { stringValue: teacherId },
          },
        },
      },
    }, { auth }))
      .filter(doc => doc.kind === 'student-private')
      .map(doc => ({ ...doc, _privateFile: true }))
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  },

  async listStudentPasswordFiles({ teacherPublicKeyJwk, studentPassword } = {}) {
    const auth = await ensureAuth();
    const shareId = await this.getPasswordShareId({ teacherPublicKeyJwk, studentPassword });
    if (!shareId) return [];
    return (await listDocumentsPaged(`kanbanPasswordFiles/${encodeURIComponent(shareId)}/files`, { auth }))
      .filter(doc => doc.kind === 'student-private')
      .map(doc => ({ ...doc, _privateFile: true, _passwordShared: true }))
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  },

  async deleteCloudFile({ teacherPublicKeyJwk, fileId, studentId = '', privateFile = false }) {
    if (!fileId) throw new Error('Datenbankdatei fehlt.');
    const auth = await ensureAuth();
    const teacherId = await this.getTeacherId(teacherPublicKeyJwk);
    const docPath = privateFile && studentId
      ? `kanbanPrivateFiles/${encodeURIComponent(studentId)}/files/${encodeURIComponent(fileId)}`
      : `kanbanFiles/${encodeURIComponent(teacherId)}/files/${encodeURIComponent(fileId)}`;
    const res = await fetch(`${apiBase()}/${docPath}`, {
      method: 'DELETE',
      headers: await firebaseHeaders({ auth }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Löschen aus Firebase fehlgeschlagen.${detail ? ' ' + detail.slice(0, 160) : ''}`);
    }
    return true;
  },

  async saveTemplate({ teacherPublicKeyJwk, template, title, teacherName = '', appVersion = 'standalone-1.0' }) {
    if (!template?.kanbanfluss_template || !template?.template) {
      throw new Error('Keine gültige EDUBAN-Vorlage.');
    }
    const auth = await ensureAuth();
    const teacherId = await this.getTeacherId(teacherPublicKeyJwk);
    const now = new Date().toISOString();
    const templateId = `template-${Date.now()}-${randomId('tpl')}`;
    const doc = {
      teacherId,
      title: title || template.boardName || 'EDUBAN Vorlage',
      teacherName,
      kind: 'board-template',
      createdAt: now,
      updatedAt: now,
      appVersion,
      template,
    };

    const res = await fetch(`${apiBase()}/kanbanTemplates/${encodeURIComponent(teacherId)}/templates?documentId=${encodeURIComponent(templateId)}`, {
      method: 'POST',
      headers: await firebaseHeaders({ auth, json: true }),
      body: JSON.stringify({ fields: Object.fromEntries(Object.entries(doc).map(([k, v]) => [k, valToFs(v)])) }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Vorlage konnte nicht in Firebase gespeichert werden.${detail ? ' ' + detail.slice(0, 160) : ''}`);
    }
    return { ...doc, templateId };
  },

  async listTemplates(teacherPublicKeyJwk) {
    const auth = await ensureAuth();
    const teacherId = await this.getTeacherId(teacherPublicKeyJwk);
    return (await listDocumentsPaged(`kanbanTemplates/${encodeURIComponent(teacherId)}/templates`, { auth }))
      .filter(doc => doc.kind === 'board-template' && doc.template?.kanbanfluss_template)
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  },

  async deleteTemplate({ teacherPublicKeyJwk, templateId }) {
    if (!templateId) throw new Error('Vorlage fehlt.');
    const auth = await ensureAuth();
    const teacherId = await this.getTeacherId(teacherPublicKeyJwk);
    const res = await fetch(`${apiBase()}/kanbanTemplates/${encodeURIComponent(teacherId)}/templates/${encodeURIComponent(templateId)}`, {
      method: 'DELETE',
      headers: await firebaseHeaders({ auth }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Vorlage konnte nicht aus Firebase gelöscht werden.${detail ? ' ' + detail.slice(0, 160) : ''}`);
    }
    return true;
  },

  encryptedJsonFromCloudFile(file) {
    if (!file?.payload?.encrypted || !file.payload.encData) {
      throw new Error('Diese Datenbankdatei enthält kein gültiges verschlüsseltes Paket.');
    }
    const { format, ...payload } = file.payload;
    return JSON.stringify(payload);
  },
};
