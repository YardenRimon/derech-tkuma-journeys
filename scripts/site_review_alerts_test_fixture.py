"""Portable test dependency fixture; NOT the deployed operations security layer.

Only the fixed Derech test identity and adapter dependency interface are present.
Production uses canonical weekly_telegram/client_notifications on the server;
those helpers and unrelated tenant metadata are deliberately not bundled here.
"""
from dataclasses import dataclass
import json
from pathlib import Path
import stat


class FixtureError(ValueError):
    pass


def require(condition, code):
    if not condition:
        raise FixtureError(code)


@dataclass(frozen=True)
class FixtureTenant:
    slug: str = 'derech'
    uid: int = 10001
    gid: int = 10000
    chat_id: int = -5379385865
    bot_id: int = 8905221076
    owner_id: int = 885011787


class FixtureWeekly:
    """Explicit injected contract fixture, no imports from private server code."""
    WeeklyError = FixtureError
    MAX_DB = 128 * 1024 * 1024
    TENANTS = {'derech': FixtureTenant()}

    @staticmethod
    def protected_file(path, uid, gid, limit):
        path = Path(path)
        for parent in (*path.parents, path):
            require(not parent.is_symlink(), 'unsafe_private_path')
        info = path.lstat()
        require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and stat.S_IMODE(info.st_mode) == 0o600 and (info.st_uid, info.st_gid) == (uid, gid), 'private_file_protection_failed')
        require(info.st_size <= limit, 'private_file_too_large')
        return info

    @staticmethod
    def read_json(path, uid, gid):
        FixtureWeekly.protected_file(path, uid, gid, 1024 * 1024)
        raw = Path(path).read_bytes()
        return json.loads(raw), raw

    @staticmethod
    def _identity(db, tenant, config):
        require(config.get('owner_id') == tenant.owner_id and config.get('chat_id') == tenant.chat_id and config.get('bot_id') == tenant.bot_id and config.get('owner_status') == 'creator' and config.get('bot_status') == 'member', 'tenant_configuration_mismatch')
        allowed = {tenant.owner_id, tenant.chat_id, *config.get('operator_ids', []), *config.get('viewer_ids', [])}
        require(all(row[0] in allowed for row in db.execute('SELECT DISTINCT chat_id FROM outbox')), 'database_destination_mismatch')


def fixture_owner_dm(db, tenant):
    row = db.execute('SELECT owner_id,tenant_slug,bot_id,chat_id,update_id,message_id FROM scoped_owner_dm WHERE owner_id=?', (tenant.owner_id,)).fetchone()
    return bool(row and tuple(row[:4]) == (tenant.owner_id, tenant.slug, tenant.bot_id, tenant.owner_id) and row[4] >= 0 and row[5] > 0)
