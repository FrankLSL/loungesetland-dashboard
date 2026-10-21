"""Opslag van het dashboard: één SQLite-bestand op het Railway-volume (/data).

Tabellen
  datasets : per bron de rijen (JSON) en de beschrijving (titel, schema, laatst bijgewerkt)
  docs     : losse documenten die de pagina zelf bewaart (gedeelde instellingen, opschaalplan, ...)
  blobs    : downloadbare bestanden (bijv. de CSV van de containerplanning)
  kv       : sleutels/tokens (OneDrive-koppeling) en status
  runs     : logboek van de automatische taken
  users    : gebruikers met rol (beheerder / bekijker)
"""
import os, json, sqlite3, threading, datetime
from pathlib import Path

DATA = Path(os.getenv('DATA_DIR') or Path(__file__).parent / 'data')
DATA.mkdir(parents=True, exist_ok=True)
DB_PATH = DATA / 'dashboard.db'
_lock = threading.RLock()


def now_iso():
    return datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat().replace('+00:00', 'Z')


def _conn():
    c = sqlite3.connect(DB_PATH, timeout=30, check_same_thread=False)
    c.row_factory = sqlite3.Row
    return c


def init():
    with _lock, _conn() as c:
        c.executescript('''
        PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS datasets (id TEXT PRIMARY KEY, meta TEXT NOT NULL DEFAULT '{}', rows TEXT, updated_at TEXT);
        CREATE TABLE IF NOT EXISTS docs (path TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT, updated_by TEXT);
        CREATE TABLE IF NOT EXISTS blobs (name TEXT PRIMARY KEY, mime TEXT, data BLOB, updated_at TEXT);
        CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT);
        CREATE TABLE IF NOT EXISTS runs (id INTEGER PRIMARY KEY AUTOINCREMENT, job TEXT, started TEXT, finished TEXT, ok INTEGER, message TEXT);
        CREATE TABLE IF NOT EXISTS users (username TEXT PRIMARY KEY, name TEXT, pw_hash TEXT, role TEXT, created TEXT);
        ''')


# ---------- datasets ----------
def dataset_meta_all():
    with _conn() as c:
        return {r['id']: {**json.loads(r['meta'] or '{}'), 'updated_at': r['updated_at']} for r in c.execute('SELECT id, meta, updated_at FROM datasets')}


def dataset_meta(ds):
    with _conn() as c:
        r = c.execute('SELECT meta, updated_at FROM datasets WHERE id=?', (ds,)).fetchone()
    return ({**json.loads(r['meta'] or '{}'), 'updated_at': r['updated_at']} if r else None)


def dataset_rows(ds):
    with _conn() as c:
        r = c.execute('SELECT rows FROM datasets WHERE id=?', (ds,)).fetchone()
    return json.loads(r['rows']) if r and r['rows'] is not None else None


def dataset_rows_raw(ds):
    with _conn() as c:
        r = c.execute('SELECT rows, updated_at FROM datasets WHERE id=?', (ds,)).fetchone()
    return (r['rows'], r['updated_at']) if r else (None, None)


def save_dataset(ds, rows, meta=None, by='server'):
    """Schrijft de rijen van een bron. meta wordt samengevoegd met wat er al stond."""
    with _lock, _conn() as c:
        old = c.execute('SELECT meta FROM datasets WHERE id=?', (ds,)).fetchone()
        m = json.loads(old['meta']) if old else {}
        if meta:
            m.update(meta)
        m['updated'] = {'at': now_iso(), 'by': by}
        c.execute('INSERT INTO datasets(id, meta, rows, updated_at) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET meta=excluded.meta, rows=excluded.rows, updated_at=excluded.updated_at',
                  (ds, json.dumps(m, ensure_ascii=False), json.dumps(rows, ensure_ascii=False, separators=(',', ':')), now_iso()))


def set_dataset_meta(ds, meta):
    with _lock, _conn() as c:
        old = c.execute('SELECT meta FROM datasets WHERE id=?', (ds,)).fetchone()
        m = json.loads(old['meta']) if old else {}
        m.update(meta)
        if old:
            c.execute('UPDATE datasets SET meta=? WHERE id=?', (json.dumps(m, ensure_ascii=False), ds))
        else:
            c.execute('INSERT INTO datasets(id, meta, rows, updated_at) VALUES(?,?,NULL,NULL)', (ds, json.dumps(m, ensure_ascii=False)))


def dataset_count():
    with _conn() as c:
        return c.execute('SELECT COUNT(*) n FROM datasets WHERE rows IS NOT NULL').fetchone()['n']


# ---------- docs ----------
def get_doc(path):
    with _conn() as c:
        r = c.execute('SELECT data, updated_at, updated_by FROM docs WHERE path=?', (path,)).fetchone()
    return {'data': json.loads(r['data']), 'updated_at': r['updated_at'], 'updated_by': r['updated_by']} if r else None


def set_doc(path, data, by=''):
    with _lock, _conn() as c:
        c.execute('INSERT INTO docs(path, data, updated_at, updated_by) VALUES(?,?,?,?) ON CONFLICT(path) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at, updated_by=excluded.updated_by',
                  (path, json.dumps(data, ensure_ascii=False), now_iso(), by))


def merge_doc(path, data, by=''):
    cur = (get_doc(path) or {}).get('data') or {}
    cur.update(data)
    set_doc(path, cur, by)
    return cur


# ---------- blobs ----------
def put_blob(name, data, mime):
    with _lock, _conn() as c:
        c.execute('INSERT INTO blobs(name, mime, data, updated_at) VALUES(?,?,?,?) ON CONFLICT(name) DO UPDATE SET mime=excluded.mime, data=excluded.data, updated_at=excluded.updated_at',
                  (name, mime, data, now_iso()))


def get_blob(name):
    with _conn() as c:
        r = c.execute('SELECT mime, data FROM blobs WHERE name=?', (name,)).fetchone()
    return (r['mime'], r['data']) if r else (None, None)


# ---------- kv ----------
def kv_get(key, default=None):
    with _conn() as c:
        r = c.execute('SELECT value FROM kv WHERE key=?', (key,)).fetchone()
    return json.loads(r['value']) if r else default


def kv_set(key, value):
    with _lock, _conn() as c:
        c.execute('INSERT INTO kv(key, value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', (key, json.dumps(value)))


# ---------- runs ----------
def run_start(job):
    with _lock, _conn() as c:
        cur = c.execute('INSERT INTO runs(job, started) VALUES(?,?)', (job, now_iso()))
        return cur.lastrowid


def run_end(rid, ok, message=''):
    with _lock, _conn() as c:
        c.execute('UPDATE runs SET finished=?, ok=?, message=? WHERE id=?', (now_iso(), 1 if ok else 0, (message or '')[:4000], rid))
        c.execute('DELETE FROM runs WHERE id < (SELECT MAX(id) - 2000 FROM runs)')


def recent_runs(limit=200):
    with _conn() as c:
        return [dict(r) for r in c.execute('SELECT * FROM runs ORDER BY id DESC LIMIT ?', (limit,))]


def last_runs_per_job():
    with _conn() as c:
        return [dict(r) for r in c.execute('SELECT r.* FROM runs r JOIN (SELECT job, MAX(id) mid FROM runs GROUP BY job) m ON r.id = m.mid ORDER BY r.job')]


# ---------- users ----------
def users():
    with _conn() as c:
        return [dict(r) for r in c.execute('SELECT username, name, role, created FROM users ORDER BY username')]


def user(username):
    with _conn() as c:
        r = c.execute('SELECT * FROM users WHERE username=?', (username,)).fetchone()
    return dict(r) if r else None


def save_user(username, name, pw_hash, role):
    with _lock, _conn() as c:
        if pw_hash:
            c.execute('INSERT INTO users(username, name, pw_hash, role, created) VALUES(?,?,?,?,?) ON CONFLICT(username) DO UPDATE SET name=excluded.name, pw_hash=excluded.pw_hash, role=excluded.role',
                      (username, name, pw_hash, role, now_iso()))
        else:
            c.execute('UPDATE users SET name=?, role=? WHERE username=?', (name, role, username))


def delete_user(username):
    with _lock, _conn() as c:
        c.execute('DELETE FROM users WHERE username=?', (username,))
