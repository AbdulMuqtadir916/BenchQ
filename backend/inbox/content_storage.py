"""Convert retained body/preview storage during the unmerged Gmail migration.

Uses deployment-owned keys; never creates or logs a key. An absent/wrong key fails
transactionally rather than discarding or exposing unreadable retained content.
"""
from sqlalchemy import text
from backend.inbox.google_oauth import encrypt_content, decrypt_content


def convert_retained_content(connection, *, encrypt):
    after = None
    while True:
        rows = connection.execute(text('SELECT id, body, snippet FROM inbox_messages '
            'WHERE (CAST(:after AS uuid) IS NULL OR id > CAST(:after AS uuid)) ORDER BY id LIMIT 100'),
            {'after': str(after) if after else None}).mappings().all()
        if not rows:
            return
        for row in rows:
            values = {}
            for field in ('body', 'snippet'):
                value = row[field]
                if value is None or value == '':
                    values[field] = value
                elif encrypt:
                    values[field] = value if value.startswith('bqenc1:') else encrypt_content(value)
                else:
                    values[field] = decrypt_content(value)
            connection.execute(text('UPDATE inbox_messages SET body=:body, snippet=:snippet WHERE id=:id'),
                {**values, 'id': row['id']})
        after = rows[-1]['id']
