from __future__ import annotations

from datetime import datetime, timedelta
from pathlib import Path
from uuid import uuid4
import html
import mimetypes
import os
import re

from flask import Flask, jsonify, request, session, send_from_directory
from flask_cors import CORS
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import or_
from werkzeug.security import check_password_hash, generate_password_hash
from werkzeug.utils import secure_filename

BASE_DIR = Path(__file__).resolve().parent
PROJECT_DIR = BASE_DIR.parent
FRONTEND_DIR = PROJECT_DIR / 'frontend'
UPLOAD_ROOT = BASE_DIR / 'uploads'
AVATAR_DIR = UPLOAD_ROOT / 'avatars'
FILE_DIR = UPLOAD_ROOT / 'files'
DB_PATH = BASE_DIR / 'maximka.db'

for p in [AVATAR_DIR, FILE_DIR]:
    p.mkdir(parents=True, exist_ok=True)

app = Flask(__name__, static_folder=str(FRONTEND_DIR), static_url_path='')
app.config['SECRET_KEY'] = 'maximka-super-secret-change-me'
app.config['SQLALCHEMY_DATABASE_URI'] = f'sqlite:///{DB_PATH}'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['MAX_CONTENT_LENGTH'] = 50 * 1024 * 1024
app.config['JSON_AS_ASCII'] = False
CORS(app, supports_credentials=True)
db = SQLAlchemy(app)


class User(db.Model):
    __tablename__ = 'users'
    user_id = db.Column(db.Integer, primary_key=True)
    login = db.Column(db.String(50), unique=True, nullable=False)
    password_hash = db.Column(db.String(255), nullable=False)
    display_name = db.Column(db.String(100), nullable=False)
    avatar_path = db.Column(db.String(255))
    user_status = db.Column(db.String(20), nullable=False, default='offline')
    last_seen_at = db.Column(db.DateTime)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)


class UserSettings(db.Model):
    __tablename__ = 'user_settings'
    user_id = db.Column(db.Integer, db.ForeignKey('users.user_id', ondelete='CASCADE'), primary_key=True)
    theme_mode = db.Column(db.String(20), nullable=False, default='dark')
    color_theme = db.Column(db.String(20), nullable=False, default='ocean')
    font_size = db.Column(db.Integer, nullable=False, default=16)
    density_mode = db.Column(db.String(20), nullable=False, default='comfortable')
    browser_notifications = db.Column(db.Boolean, nullable=False, default=True)
    sound_notifications = db.Column(db.Boolean, nullable=False, default=True)
    toast_notifications = db.Column(db.Boolean, nullable=False, default=True)


class Chat(db.Model):
    __tablename__ = 'chats'
    chat_id = db.Column(db.Integer, primary_key=True)
    chat_type = db.Column(db.String(20), nullable=False, default='private')
    title = db.Column(db.String(255))
    avatar_path = db.Column(db.String(255))
    description = db.Column(db.Text)
    invite_code = db.Column(db.String(64), unique=True)
    created_by = db.Column(db.Integer, db.ForeignKey('users.user_id', ondelete='SET NULL'))
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)


class ChatMember(db.Model):
    __tablename__ = 'chat_members'
    chat_member_id = db.Column(db.Integer, primary_key=True)
    chat_id = db.Column(db.Integer, db.ForeignKey('chats.chat_id', ondelete='CASCADE'), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey('users.user_id', ondelete='CASCADE'), nullable=False)
    member_role = db.Column(db.String(20), nullable=False, default='member')
    joined_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    is_muted = db.Column(db.Boolean, nullable=False, default=False)
    is_archived = db.Column(db.Boolean, nullable=False, default=False)
    last_read_message_id = db.Column(db.Integer)
    __table_args__ = (db.UniqueConstraint('chat_id', 'user_id', name='uq_chat_user'),)


class Message(db.Model):
    __tablename__ = 'messages'
    message_id = db.Column(db.Integer, primary_key=True)
    chat_id = db.Column(db.Integer, db.ForeignKey('chats.chat_id', ondelete='CASCADE'), nullable=False)
    sender_id = db.Column(db.Integer, db.ForeignKey('users.user_id', ondelete='SET NULL'))
    message_text = db.Column(db.Text)
    message_html = db.Column(db.Text)
    message_type = db.Column(db.String(20), nullable=False, default='text')
    reply_to_message_id = db.Column(db.Integer, db.ForeignKey('messages.message_id', ondelete='SET NULL'))
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    edited_at = db.Column(db.DateTime)
    sender = db.relationship('User', foreign_keys=[sender_id])
    reply_to = db.relationship('Message', remote_side=[message_id], foreign_keys=[reply_to_message_id])


class Attachment(db.Model):
    __tablename__ = 'attachments'
    attachment_id = db.Column(db.Integer, primary_key=True)
    message_id = db.Column(db.Integer, db.ForeignKey('messages.message_id', ondelete='CASCADE'), nullable=False)
    file_name = db.Column(db.String(255), nullable=False)
    file_path = db.Column(db.String(255), nullable=False)
    file_size = db.Column(db.Integer, nullable=False)
    mime_type = db.Column(db.String(100))


class MessageRead(db.Model):
    __tablename__ = 'message_reads'
    message_read_id = db.Column(db.Integer, primary_key=True)
    message_id = db.Column(db.Integer, db.ForeignKey('messages.message_id', ondelete='CASCADE'), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey('users.user_id', ondelete='CASCADE'), nullable=False)
    delivered_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    read_at = db.Column(db.DateTime)
    __table_args__ = (db.UniqueConstraint('message_id', 'user_id', name='uq_message_read_user'),)


STATUS_LABELS = {
    'online': 'В сети',
    'offline': 'Не в сети',
    'dnd': 'Не беспокоить',
}


def now() -> datetime:
    return datetime.utcnow()


def model_status(user: User | None) -> str:
    if not user:
        return 'offline'
    if user.user_status == 'offline':
        return 'offline'
    if user.last_seen_at and user.last_seen_at < now() - timedelta(minutes=5):
        return 'dnd'
    return 'online'


def save_upload(storage, target_dir: Path) -> str | None:
    if not storage or not storage.filename:
        return None
    filename = secure_filename(storage.filename)
    suffix = Path(filename).suffix.lower()
    name = f'{uuid4().hex}{suffix}'
    target = target_dir / name
    storage.save(target)
    rel = target.relative_to(BASE_DIR)
    return str(rel).replace('\\', '/')


def format_text(text: str | None) -> str:
    escaped = html.escape(text or '')
    escaped = re.sub(r'`([^`]+)`', r'<code>\1</code>', escaped)
    escaped = re.sub(r'\*\*([^*]+)\*\*', r'<strong>\1</strong>', escaped)
    escaped = re.sub(r'(?<!\*)\*([^*]+)\*(?!\*)', r'<em>\1</em>', escaped)
    escaped = re.sub(r'@([a-zA-Z0-9_]+)', r'<span class="mention">@\1</span>', escaped)
    return escaped.replace('\n', '<br>')


def detect_type(file_path: str | None) -> tuple[str, str | None]:
    if not file_path:
        return 'text', None
    mime_type, _ = mimetypes.guess_type(file_path)
    mime_type = mime_type or 'application/octet-stream'
    if mime_type.startswith('image/'):
        return 'image', mime_type
    if mime_type.startswith('video/'):
        return 'video', mime_type
    if mime_type.startswith('audio/'):
        return 'audio', mime_type
    return 'file', mime_type


def initials(user: User | None) -> str:
    if not user:
        return '??'
    source = (user.display_name or user.login).strip()
    parts = source.split()
    if len(parts) >= 2:
        return (parts[0][:1] + parts[1][:1]).upper()
    return source[:2].upper()


def status_label(code: str) -> str:
    return STATUS_LABELS.get(code, 'Не в сети')


def current_user() -> User | None:
    user_id = session.get('user_id')
    if not user_id:
        return None
    user = db.session.get(User, user_id)
    if not user:
        return None
    if request.path not in ['/api/logout']:
        user.last_seen_at = now()
        user.user_status = 'online'
        db.session.commit()
    return user


def require_auth() -> User:
    user = current_user()
    if not user:
        raise PermissionError('Требуется авторизация')
    return user


def user_payload(user: User) -> dict:
    status = model_status(user)
    return {
        'user_id': user.user_id,
        'login': user.login,
        'display_name': user.display_name,
        'avatar_url': f'/api/media/{user.avatar_path}' if user.avatar_path else None,
        'initials': initials(user),
        'user_status': status,
        'user_status_label': status_label(status),
        'last_seen_at': user.last_seen_at.isoformat() if user.last_seen_at else None,
    }


def unread_count(member: ChatMember) -> int:
    query = Message.query.filter(Message.chat_id == member.chat_id, Message.sender_id != member.user_id)
    if member.last_read_message_id:
        query = query.filter(Message.message_id > member.last_read_message_id)
    return query.count()


def last_message(chat_id: int) -> Message | None:
    return Message.query.filter_by(chat_id=chat_id).order_by(Message.message_id.desc()).first()


def chat_title_for(chat: Chat, me_id: int) -> tuple[str, str | None, str]:
    if chat.chat_type == 'group':
        title = chat.title or 'Группа'
        avatar_url = f'/api/media/{chat.avatar_path}' if chat.avatar_path else None
        subtitle = chat.description or 'Групповой чат'
        return title, avatar_url, subtitle
    members = ChatMember.query.filter_by(chat_id=chat.chat_id).all()
    other_member = next((m for m in members if m.user_id != me_id), None)
    other = db.session.get(User, other_member.user_id) if other_member else None
    if not other:
        return 'Диалог', None, 'Личный чат'
    return other.display_name, (f'/api/media/{other.avatar_path}' if other.avatar_path else None), f'@{other.login} · {status_label(model_status(other))}'


def message_payload(message: Message, me_id: int) -> dict:
    attachment = Attachment.query.filter_by(message_id=message.message_id).first()
    sender = message.sender
    delivered = MessageRead.query.filter_by(message_id=message.message_id, user_id=me_id).first()
    all_reads = MessageRead.query.filter_by(message_id=message.message_id).all()
    reply = None
    if message.reply_to:
        reply = {
            'message_id': message.reply_to.message_id,
            'sender_name': message.reply_to.sender.display_name if message.reply_to.sender else 'Удалённый пользователь',
            'message_text': (message.reply_to.message_text or '')[:120],
        }
    preview = None
    if attachment:
        file_url = f'/api/media/{attachment.file_path}'
        preview = {
            'file_name': attachment.file_name,
            'file_size': attachment.file_size,
            'mime_type': attachment.mime_type,
            'file_url': file_url,
            'kind': message.message_type,
        }
    return {
        'message_id': message.message_id,
        'chat_id': message.chat_id,
        'sender': user_payload(sender) if sender else None,
        'message_text': message.message_text,
        'message_html': message.message_html,
        'message_type': message.message_type,
        'created_at': message.created_at.isoformat(),
        'edited_at': message.edited_at.isoformat() if message.edited_at else None,
        'is_own': message.sender_id == me_id,
        'reply_to': reply,
        'attachment': preview,
        'delivery_status': 'Прочитано' if delivered and delivered.read_at else 'Доставлено',
        'read_by_count': len([r for r in all_reads if r.read_at]),
    }


def ensure_private_chat(user_a_id: int, user_b_id: int) -> Chat:
    my_chats = {m.chat_id for m in ChatMember.query.filter_by(user_id=user_a_id).all()}
    other_chats = {m.chat_id for m in ChatMember.query.filter_by(user_id=user_b_id).all()}
    for chat_id in my_chats & other_chats:
        chat = db.session.get(Chat, chat_id)
        if not chat or chat.chat_type != 'private':
            continue
        members = ChatMember.query.filter_by(chat_id=chat.chat_id).count()
        if members == 2:
            return chat
    chat = Chat(chat_type='private', created_by=user_a_id)
    db.session.add(chat)
    db.session.flush()
    db.session.add(ChatMember(chat_id=chat.chat_id, user_id=user_a_id, member_role='owner'))
    db.session.add(ChatMember(chat_id=chat.chat_id, user_id=user_b_id, member_role='member'))
    db.session.commit()
    return chat


def record_reads(message: Message):
    members = ChatMember.query.filter_by(chat_id=message.chat_id).all()
    for member in members:
        mr = MessageRead(message_id=message.message_id, user_id=member.user_id)
        if member.user_id == message.sender_id:
            mr.read_at = now()
        db.session.add(mr)


@app.errorhandler(PermissionError)
def permission_error(exc):
    return jsonify({'error': str(exc)}), 401


@app.route('/')
def root():
    return app.send_static_file('index.html')


@app.route('/api/media/<path:media_path>')
def media(media_path: str):
    target = BASE_DIR / media_path
    if not target.exists():
        return jsonify({'error': 'Файл не найден'}), 404
    return send_from_directory(target.parent, target.name)


@app.route('/api/register', methods=['POST'])
def register():
    data = request.get_json(force=True)
    login = (data.get('login') or '').strip().lower()
    password = data.get('password') or ''
    display_name = (data.get('display_name') or '').strip()
    if len(login) < 3 or len(password) < 4 or len(display_name) < 2:
        return jsonify({'error': 'Проверь логин, пароль и отображаемое имя'}), 400
    if User.query.filter_by(login=login).first():
        return jsonify({'error': 'Такой логин уже существует'}), 400
    user = User(login=login, password_hash=generate_password_hash(password), display_name=display_name, user_status='online', last_seen_at=now())
    db.session.add(user)
    db.session.flush()
    settings = UserSettings(user_id=user.user_id)
    db.session.add(settings)
    db.session.commit()
    session['user_id'] = user.user_id
    return jsonify({'ok': True, 'user': user_payload(user)})


@app.route('/api/login', methods=['POST'])
def login():
    data = request.get_json(force=True)
    login = (data.get('login') or '').strip().lower()
    password = data.get('password') or ''
    user = User.query.filter_by(login=login).first()
    if not user or not check_password_hash(user.password_hash, password):
        return jsonify({'error': 'Неверный логин или пароль'}), 400
    session['user_id'] = user.user_id
    user.user_status = 'online'
    user.last_seen_at = now()
    db.session.commit()
    return jsonify({'ok': True, 'user': user_payload(user)})


@app.route('/api/logout', methods=['POST'])
def logout():
    user_id = session.get('user_id')
    if user_id:
        user = db.session.get(User, user_id)
        if user:
            user.user_status = 'offline'
            db.session.commit()
    session.clear()
    return jsonify({'ok': True})


@app.route('/api/me')
def me():
    user = require_auth()
    settings = db.session.get(UserSettings, user.user_id)
    return jsonify({'user': user_payload(user), 'settings': settings_payload(settings)})


@app.route('/api/activity', methods=['POST'])
def activity():
    user = require_auth()
    user.last_seen_at = now()
    user.user_status = 'online'
    db.session.commit()
    return jsonify({'ok': True, 'status': user_payload(user)['user_status']})


def settings_payload(settings: UserSettings | None) -> dict:
    if not settings:
        return {
            'theme_mode': 'dark',
            'color_theme': 'ocean',
            'font_size': 16,
            'density_mode': 'comfortable',
            'browser_notifications': True,
            'sound_notifications': True,
            'toast_notifications': True,
        }
    return {
        'theme_mode': settings.theme_mode,
        'color_theme': settings.color_theme,
        'font_size': settings.font_size,
        'density_mode': settings.density_mode,
        'browser_notifications': settings.browser_notifications,
        'sound_notifications': settings.sound_notifications,
        'toast_notifications': settings.toast_notifications,
    }


@app.route('/api/settings', methods=['GET', 'PUT'])
def settings_route():
    user = require_auth()
    settings = db.session.get(UserSettings, user.user_id)
    if request.method == 'GET':
        return jsonify({'settings': settings_payload(settings)})
    data = request.get_json(force=True)
    settings.theme_mode = data.get('theme_mode', settings.theme_mode)
    settings.color_theme = data.get('color_theme', settings.color_theme)
    settings.font_size = max(13, min(22, int(data.get('font_size', settings.font_size))))
    settings.density_mode = data.get('density_mode', settings.density_mode)
    settings.browser_notifications = bool(data.get('browser_notifications', settings.browser_notifications))
    settings.sound_notifications = bool(data.get('sound_notifications', settings.sound_notifications))
    settings.toast_notifications = bool(data.get('toast_notifications', settings.toast_notifications))
    db.session.commit()
    return jsonify({'ok': True, 'settings': settings_payload(settings)})


@app.route('/api/profile', methods=['GET', 'PUT'])
def profile_route():
    user = require_auth()
    if request.method == 'GET':
        return jsonify({'user': user_payload(user)})
    display_name = (request.form.get('display_name') or user.display_name).strip()
    avatar = request.files.get('avatar')
    if len(display_name) < 2:
        return jsonify({'error': 'Имя слишком короткое'}), 400
    user.display_name = display_name
    avatar_path = save_upload(avatar, AVATAR_DIR)
    if avatar_path:
        user.avatar_path = avatar_path
    db.session.commit()
    return jsonify({'ok': True, 'user': user_payload(user)})


@app.route('/api/users/search')
def user_search():
    user = require_auth()
    q = (request.args.get('q') or '').strip()
    query = User.query.filter(User.user_id != user.user_id)
    if q:
        pattern = f'%{q}%'
        query = query.filter(or_(User.login.ilike(pattern), User.display_name.ilike(pattern)))
    users = query.order_by(User.display_name.asc()).limit(25).all()
    return jsonify({'users': [user_payload(u) for u in users]})


@app.route('/api/chats', methods=['GET'])
def chats_list():
    user = require_auth()
    members = ChatMember.query.filter_by(user_id=user.user_id).order_by(ChatMember.chat_member_id.desc()).all()
    items = []
    for member in members:
        chat = db.session.get(Chat, member.chat_id)
        if not chat:
            continue
        title, avatar_url, subtitle = chat_title_for(chat, user.user_id)
        last = last_message(chat.chat_id)
        unread = unread_count(member)
        items.append({
            'chat_id': chat.chat_id,
            'chat_type': chat.chat_type,
            'title': title,
            'avatar_url': avatar_url,
            'subtitle': subtitle,
            'last_message': (last.message_text if last and last.message_text else ('Вложение' if last else '')),
            'last_message_time': last.created_at.isoformat() if last else chat.created_at.isoformat(),
            'unread_count': unread,
            'has_unread': unread > 0,
            'is_archived': member.is_archived,
            'is_muted': member.is_muted,
        })
    items.sort(key=lambda x: x['last_message_time'], reverse=True)
    return jsonify({'chats': items})


@app.route('/api/chats/private', methods=['POST'])
def private_chat():
    me = require_auth()
    data = request.get_json(force=True)
    target_id = int(data.get('user_id'))
    if target_id == me.user_id:
        return jsonify({'error': 'Нельзя создать чат с собой'}), 400
    target = db.session.get(User, target_id)
    if not target:
        return jsonify({'error': 'Пользователь не найден'}), 404
    chat = ensure_private_chat(me.user_id, target_id)
    return jsonify({'ok': True, 'chat_id': chat.chat_id})


@app.route('/api/chats/group', methods=['POST'])
def create_group():
    me = require_auth()
    title = (request.form.get('title') or '').strip()
    description = (request.form.get('description') or '').strip()
    member_ids_raw = request.form.get('member_ids', '')
    avatar = request.files.get('avatar')
    if len(title) < 2:
        return jsonify({'error': 'Название группы слишком короткое'}), 400
    avatar_path = save_upload(avatar, AVATAR_DIR)
    chat = Chat(chat_type='group', title=title, description=description, created_by=me.user_id, invite_code=uuid4().hex[:10], avatar_path=avatar_path)
    db.session.add(chat)
    db.session.flush()
    db.session.add(ChatMember(chat_id=chat.chat_id, user_id=me.user_id, member_role='owner'))
    member_ids = {int(x) for x in member_ids_raw.split(',') if x.strip().isdigit()}
    for uid in member_ids:
        if uid != me.user_id and db.session.get(User, uid):
            db.session.add(ChatMember(chat_id=chat.chat_id, user_id=uid, member_role='member'))
    db.session.commit()
    return jsonify({'ok': True, 'chat_id': chat.chat_id})


@app.route('/api/chats/<int:chat_id>')
def chat_detail(chat_id: int):
    me = require_auth()
    member = ChatMember.query.filter_by(chat_id=chat_id, user_id=me.user_id).first()
    if not member:
        raise PermissionError('Нет доступа к чату')
    chat = db.session.get(Chat, chat_id)
    title, avatar_url, subtitle = chat_title_for(chat, me.user_id)
    members = ChatMember.query.filter_by(chat_id=chat_id).all()
    result_members = []
    for m in members:
        u = db.session.get(User, m.user_id)
        result_members.append({
            **user_payload(u),
            'member_role': m.member_role,
        })
    return jsonify({
        'chat': {
            'chat_id': chat.chat_id,
            'chat_type': chat.chat_type,
            'title': title,
            'subtitle': subtitle,
            'avatar_url': avatar_url,
            'description': chat.description,
            'invite_code': chat.invite_code,
            'members': result_members,
        }
    })


@app.route('/api/chats/<int:chat_id>/messages', methods=['GET', 'POST'])
def chat_messages(chat_id: int):
    me = require_auth()
    member = ChatMember.query.filter_by(chat_id=chat_id, user_id=me.user_id).first()
    if not member:
        raise PermissionError('Нет доступа к чату')
    if request.method == 'GET':
        messages = Message.query.filter_by(chat_id=chat_id).order_by(Message.message_id.asc()).all()
        last_msg = messages[-1] if messages else None
        if last_msg:
            member.last_read_message_id = last_msg.message_id
            db.session.commit()
            reads = MessageRead.query.join(Message, MessageRead.message_id == Message.message_id).filter(
                Message.chat_id == chat_id,
                MessageRead.user_id == me.user_id,
                Message.sender_id != me.user_id,
                MessageRead.read_at.is_(None),
            ).all()
            for read in reads:
                read.read_at = now()
            db.session.commit()
        return jsonify({'messages': [message_payload(m, me.user_id) for m in messages]})

    text = (request.form.get('text') or '').strip()
    reply_id = request.form.get('reply_to_message_id')
    file = request.files.get('file')
    if not text and not file:
        return jsonify({'error': 'Введите сообщение или выберите файл'}), 400
    file_path = save_upload(file, FILE_DIR) if file else None
    message_type, mime_type = detect_type(file_path)
    message = Message(
        chat_id=chat_id,
        sender_id=me.user_id,
        message_text=text,
        message_html=format_text(text),
        message_type=message_type,
        reply_to_message_id=int(reply_id) if reply_id and reply_id.isdigit() else None,
    )
    db.session.add(message)
    db.session.flush()
    if file_path and file:
        stored_size = os.path.getsize(BASE_DIR / file_path) if file_path else 0
        db.session.add(Attachment(
            message_id=message.message_id,
            file_name=file.filename,
            file_path=file_path,
            file_size=stored_size,
            mime_type=mime_type,
        ))
    record_reads(message)
    member.last_read_message_id = message.message_id
    db.session.commit()
    msg = db.session.get(Message, message.message_id)
    return jsonify({'ok': True, 'message': message_payload(msg, me.user_id)})


@app.route('/api/chats/<int:chat_id>/read', methods=['POST'])
def mark_read(chat_id: int):
    me = require_auth()
    member = ChatMember.query.filter_by(chat_id=chat_id, user_id=me.user_id).first()
    if not member:
        raise PermissionError('Нет доступа к чату')
    last = last_message(chat_id)
    if last:
        member.last_read_message_id = last.message_id
        reads = MessageRead.query.join(Message, MessageRead.message_id == Message.message_id).filter(
            Message.chat_id == chat_id,
            MessageRead.user_id == me.user_id,
            Message.sender_id != me.user_id,
            MessageRead.read_at.is_(None),
        ).all()
        for read in reads:
            read.read_at = now()
        db.session.commit()
    return jsonify({'ok': True})


@app.route('/api/messages/<int:message_id>', methods=['PUT', 'DELETE'])
def edit_message(message_id: int):
    me = require_auth()
    message = db.session.get(Message, message_id)
    if not message or message.sender_id != me.user_id:
        return jsonify({'error': 'Сообщение не найдено'}), 404
    if request.method == 'DELETE':
        attachment = Attachment.query.filter_by(message_id=message.message_id).first()
        if attachment:
            db.session.delete(attachment)
        db.session.delete(message)
        db.session.commit()
        return jsonify({'ok': True})
    data = request.get_json(force=True)
    text = (data.get('text') or '').strip()
    message.message_text = text
    message.message_html = format_text(text)
    message.edited_at = now()
    db.session.commit()
    return jsonify({'ok': True, 'message': message_payload(message, me.user_id)})


@app.route('/api/seed')
def seed():
    if User.query.first():
        return jsonify({'ok': True, 'message': 'База уже заполнена'})
    u1 = User(login='marishka', password_hash=generate_password_hash('1234'), display_name='Маришка', user_status='offline')
    u2 = User(login='tank', password_hash=generate_password_hash('1234'), display_name='Танька', user_status='offline')
    u3 = User(login='vivivi', password_hash=generate_password_hash('1234'), display_name='Vivivi', user_status='offline')
    db.session.add_all([u1, u2, u3])
    db.session.flush()
    for u in [u1, u2, u3]:
        db.session.add(UserSettings(user_id=u.user_id))
    chat = Chat(chat_type='private', created_by=u1.user_id)
    db.session.add(chat)
    db.session.flush()
    db.session.add(ChatMember(chat_id=chat.chat_id, user_id=u1.user_id, member_role='owner'))
    db.session.add(ChatMember(chat_id=chat.chat_id, user_id=u2.user_id, member_role='member'))
    m = Message(chat_id=chat.chat_id, sender_id=u2.user_id, message_text='Привет!', message_html='Привет!', message_type='text')
    db.session.add(m)
    db.session.flush()
    record_reads(m)
    db.session.commit()
    return jsonify({'ok': True, 'message': 'Тестовые данные созданы'})


@app.route('/<path:path>')
def frontend_files(path):
    target = FRONTEND_DIR / path
    if target.exists():
        return send_from_directory(FRONTEND_DIR, path)
    return app.send_static_file('index.html')


if __name__ == '__main__':
    with app.app_context():
        db.create_all()
    app.run(debug=True, port=5000)
