#!/usr/bin/env python3
"""Privacy-isolated preference memory for the Tarot reader.

Stores only explicit style/language preferences and opt-in schedule flags
under ~/.cache/tarot/memory.sqlite3 (stdlib sqlite3). Strictly scoped by
room_id (chat_id) and optional user_id (sender_id) so DMs and rooms never
leak across contexts, and rejects personal worries or prompt-injection payloads.

  python3 memory.py remember --room <room_id> [--user <user_id>] <key> <value>
  python3 memory.py recall --room <room_id> [--user <user_id>] [<key>]
  python3 memory.py forget --room <room_id> [--user <user_id>] [<key>]
  python3 memory.py lang --room <room_id> [--user <user_id>] [--set <zh-Hant|zh-Hans|en>]
  python3 memory.py feedback --room <room_id> [--user <user_id>] <sentiment> [--note <text>]
"""

import argparse
import datetime
import json
import os
import re
import sqlite3
import sys

DEFAULT_DB = os.path.expanduser('~/.cache/tarot/memory.sqlite3')

ALLOWED_KEYS = ('lang', 'style', 'opt_in_weekly', 'opt_in_solar_term', 'mute')
BOOLEAN_KEYS = ('opt_in_weekly', 'opt_in_solar_term', 'mute')
SENTIMENTS = ('helpful', 'unhelpful', 'accurate', 'off', 'positive', 'negative', 'neutral')

LANG_ALIASES = {
    'zh-hant': 'zh-Hant',
    'zh_hant': 'zh-Hant',
    'zh-tw': 'zh-Hant',
    'zh_tw': 'zh-Hant',
    'zh-hk': 'zh-Hant',
    'zh_hk': 'zh-Hant',
    'zh-hans': 'zh-Hans',
    'zh_hans': 'zh-Hans',
    'zh-cn': 'zh-Hans',
    'zh_cn': 'zh-Hans',
    'zh': 'zh-Hans',
    'en': 'en',
    'en-gb': 'en',
    'en-us': 'en',
}

INJECTION_PATTERNS = (
    re.compile(r'\[(?:channel message context|new message|recent channel messages|internal hint|no_reply)\]', re.I),
    re.compile(r'(?:^|\s)(?:system|assistant|developer|prompt)\s*:', re.I),
    re.compile(r'<\s*/?\s*(?:system|prompt|instructions?)\s*>', re.I),
    re.compile(r'<<\s*sys\s*>>|<\|[^|]*\|>', re.I),
    re.compile(r'(?:ignore|disregard|forget|override)\s+(?:all\s+|previous\s+|prior\s+|your\s+)?(?:instructions?|rules?|prompt)', re.I),
    re.compile(r'(?:reveal|print|dump|leak)\s+(?:your\s+)?(?:system|prompt|instructions?|env|tokens?)', re.I),
    re.compile(r'(?:run|execute)\s+(?:command|shell|bash|zsh|python)', re.I),
    re.compile(r'忽略(?:之前|以上|所有)|无视(?:规则|指令)|無視(?:規則|指令)|覆盖(?:系统|指令)|覆蓋(?:系統|指令)', re.I),
    re.compile(r'&&|\|\||;|\$\(|`'),
)

WORRY_PATTERNS = (
    re.compile(r'[?？]'),
    re.compile(r'https?://', re.I),
    re.compile(r'\b(?:should i|will i|worried|anxiety|anxious|depressed|suicide|self-harm|divorce|breakup|cheating|fired|debt|secret|my partner|my boyfriend|my girlfriend|my husband|my wife|my boss)\b', re.I),
    re.compile(r'分手|離婚|离婚|裁員|裁员|出軌|出轨|抑鬱|抑郁|焦慮|焦虑|自殺|自杀|欠債|欠债|煩惱|烦恼|隱私|隐私|秘密|我該不該|我该不该|我能不能|男朋友|女朋友|老公|老婆|上司|暗戀|暗恋'),
)


def _now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds')


def _db_path():
    return os.path.expanduser(os.environ.get('TAROT_MEMORY_DB', DEFAULT_DB))


def _connect():
    path = _db_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    conn = sqlite3.connect(path)
    conn.execute(
        '''
        CREATE TABLE IF NOT EXISTS preferences (
            room_id TEXT NOT NULL,
            user_id TEXT NOT NULL DEFAULT '',
            key TEXT NOT NULL,
            value TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            PRIMARY KEY (room_id, user_id, key)
        )
        '''
    )
    conn.execute(
        '''
        CREATE TABLE IF NOT EXISTS feedback (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            room_id TEXT NOT NULL,
            user_id TEXT NOT NULL DEFAULT '',
            sentiment TEXT NOT NULL,
            note TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL
        )
        '''
    )
    conn.commit()
    return conn


def _fail(msg):
    sys.stderr.write(json.dumps({'ok': False, 'error': msg}, ensure_ascii=False) + '\n')
    sys.exit(1)


def _validate_safe_text(text, label, max_len=120, check_worry=False):
    if any(ord(c) < 32 or ord(c) == 127 for c in text):
        _fail(f'{label} contains invalid control characters')
    cleaned = text.strip()
    if len(cleaned) > max_len:
        _fail(f'{label} exceeds maximum length of {max_len}')
    for pat in INJECTION_PATTERNS:
        if pat.search(cleaned):
            _fail(f'{label} rejected by injection filter')
    if check_worry:
        for pat in WORRY_PATTERNS:
            if pat.search(cleaned):
                _fail(f'{label} rejected: personal worries, questions, URLs, or private disclosures cannot be stored')
    return cleaned


def _validate_id(raw, label, allow_empty=False):
    if raw is None:
        raw = ''
    val = _validate_safe_text(raw, label, max_len=128, check_worry=False)
    if not val and not allow_empty:
        _fail(f'{label} is required')
    if any(ch.isspace() for ch in val):
        _fail(f'{label} must not contain whitespace')
    return val


def normalize_lang(raw):
    val = _validate_safe_text(raw, 'lang', max_len=32, check_worry=False)
    canon = LANG_ALIASES.get(val.lower())
    if not canon:
        _fail(f'unsupported lang "{val}"; expected zh-Hant, zh-Hans, or en')
    return canon


def _normalize_bool(raw, key):
    val = _validate_safe_text(raw, key, max_len=16, check_worry=False).lower()
    if val in ('true', 'on', 'yes', '1'):
        return 'true'
    if val in ('false', 'off', 'no', '0'):
        return 'false'
    _fail(f'invalid boolean value "{raw}" for {key}')


def _validate_value(key, raw):
    if key not in ALLOWED_KEYS:
        _fail(f'key "{key}" is not allowed; allowed keys: {", ".join(ALLOWED_KEYS)}')
    if key == 'lang':
        return normalize_lang(raw)
    if key in BOOLEAN_KEYS:
        return _normalize_bool(raw, key)
    val = _validate_safe_text(raw, key, max_len=80, check_worry=True)
    if not val:
        _fail(f'{key} value must not be empty')
    return val


def cmd_remember(args):
    room = _validate_id(args.room, 'room')
    user = _validate_id(args.user, 'user', allow_empty=True)
    key = _validate_safe_text(args.key, 'key', max_len=32)
    val = _validate_value(key, args.value)
    now = _now()
    with _connect() as conn:
        conn.execute(
            '''
            INSERT INTO preferences (room_id, user_id, key, value, updated_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(room_id, user_id, key)
            DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
            ''',
            (room, user, key, val, now),
        )
        conn.commit()
    print(json.dumps({'ok': True, 'room': room, 'user': user, 'key': key, 'value': val}, ensure_ascii=False))


def cmd_recall(args):
    room = _validate_id(args.room, 'room')
    user = _validate_id(args.user, 'user', allow_empty=True)
    key = _validate_safe_text(args.key, 'key', max_len=32) if args.key else None
    if key and key not in ALLOWED_KEYS:
        _fail(f'key "{key}" is not allowed')
    with _connect() as conn:
        if key:
            room_rows = conn.execute(
                'SELECT key, value FROM preferences WHERE room_id = ? AND user_id = ? AND key = ?',
                (room, '', key),
            ).fetchall()
            user_rows = (
                conn.execute(
                    'SELECT key, value FROM preferences WHERE room_id = ? AND user_id = ? AND key = ?',
                    (room, user, key),
                ).fetchall()
                if user
                else []
            )
        else:
            room_rows = conn.execute(
                'SELECT key, value FROM preferences WHERE room_id = ? AND user_id = ? ORDER BY key',
                (room, ''),
            ).fetchall()
            user_rows = (
                conn.execute(
                    'SELECT key, value FROM preferences WHERE room_id = ? AND user_id = ? ORDER BY key',
                    (room, user),
                ).fetchall()
                if user
                else []
            )
    room_prefs = dict(room_rows)
    user_prefs = dict(user_rows)
    effective = dict(room_prefs)
    effective.update(user_prefs)
    print(
        json.dumps(
            {
                'ok': True,
                'room': room,
                'user': user,
                'user_prefs': user_prefs,
                'room_prefs': room_prefs,
                'effective': effective,
            },
            ensure_ascii=False,
        )
    )


def cmd_forget(args):
    room = _validate_id(args.room, 'room')
    user = _validate_id(args.user, 'user', allow_empty=True)
    key = _validate_safe_text(args.key, 'key', max_len=32) if args.key else None
    with _connect() as conn:
        if key:
            cur = conn.execute(
                'DELETE FROM preferences WHERE room_id = ? AND user_id = ? AND key = ?',
                (room, user, key),
            )
        else:
            cur = conn.execute(
                'DELETE FROM preferences WHERE room_id = ? AND user_id = ?',
                (room, user),
            )
        conn.commit()
    print(json.dumps({'ok': True, 'room': room, 'user': user, 'deleted': cur.rowcount}, ensure_ascii=False))


def cmd_lang(args):
    room = _validate_id(args.room, 'room')
    user = _validate_id(args.user, 'user', allow_empty=True)
    if args.set_lang:
        canon = normalize_lang(args.set_lang)
        now = _now()
        with _connect() as conn:
            conn.execute(
                '''
                INSERT INTO preferences (room_id, user_id, key, value, updated_at)
                VALUES (?, ?, 'lang', ?, ?)
                ON CONFLICT(room_id, user_id, key)
                DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
                ''',
                (room, user, canon, now),
            )
            conn.commit()
        print(json.dumps({'ok': True, 'room': room, 'user': user, 'lang': canon, 'source': 'user' if user else 'room'}, ensure_ascii=False))
        return

    with _connect() as conn:
        if user:
            row = conn.execute(
                "SELECT value FROM preferences WHERE room_id = ? AND user_id = ? AND key = 'lang'",
                (room, user),
            ).fetchone()
            if row:
                print(json.dumps({'ok': True, 'room': room, 'user': user, 'lang': row[0], 'source': 'user'}, ensure_ascii=False))
                return
        row = conn.execute(
            "SELECT value FROM preferences WHERE room_id = ? AND user_id = '' AND key = 'lang'",
            (room,),
        ).fetchone()
        if row:
            print(json.dumps({'ok': True, 'room': room, 'user': user, 'lang': row[0], 'source': 'room'}, ensure_ascii=False))
            return
    print(json.dumps({'ok': True, 'room': room, 'user': user, 'lang': None, 'source': None}, ensure_ascii=False))


def cmd_feedback(args):
    room = _validate_id(args.room, 'room')
    user = _validate_id(args.user, 'user', allow_empty=True)
    sentiment = _validate_safe_text(args.sentiment, 'sentiment', max_len=24).lower()
    if sentiment not in SENTIMENTS:
        _fail(f'invalid sentiment "{sentiment}"; expected one of: {", ".join(SENTIMENTS)}')
    note = _validate_safe_text(args.note, 'note', max_len=80, check_worry=True) if args.note else ''
    now = _now()
    with _connect() as conn:
        conn.execute(
            'INSERT INTO feedback (room_id, user_id, sentiment, note, created_at) VALUES (?, ?, ?, ?, ?)',
            (room, user, sentiment, note, now),
        )
        conn.commit()
    print(json.dumps({'ok': True, 'room': room, 'user': user, 'sentiment': sentiment, 'note': note}, ensure_ascii=False))


def main():
    ap = argparse.ArgumentParser(description='Privacy-isolated tarot preference memory')
    sub = ap.add_subparsers(dest='cmd', required=True)

    p = sub.add_parser('remember')
    p.add_argument('--room', required=True)
    p.add_argument('--user', default='')
    p.add_argument('key')
    p.add_argument('value')
    p.set_defaults(fn=cmd_remember)

    p = sub.add_parser('recall')
    p.add_argument('--room', required=True)
    p.add_argument('--user', default='')
    p.add_argument('key', nargs='?')
    p.set_defaults(fn=cmd_recall)

    p = sub.add_parser('forget')
    p.add_argument('--room', required=True)
    p.add_argument('--user', default='')
    p.add_argument('key', nargs='?')
    p.set_defaults(fn=cmd_forget)

    p = sub.add_parser('lang')
    p.add_argument('--room', required=True)
    p.add_argument('--user', default='')
    p.add_argument('--set', dest='set_lang')
    p.set_defaults(fn=cmd_lang)

    p = sub.add_parser('feedback')
    p.add_argument('--room', required=True)
    p.add_argument('--user', default='')
    p.add_argument('sentiment')
    p.add_argument('--note', default='')
    p.set_defaults(fn=cmd_feedback)

    args = ap.parse_args()
    args.fn(args)


if __name__ == '__main__':
    main()
