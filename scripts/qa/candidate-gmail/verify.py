"""Synthetic acceptance for the real Inbox hook/components; blocks external traffic."""
import asyncio
import json
import os
import re
from pathlib import Path
from urllib.parse import parse_qs, urlparse
from playwright.async_api import async_playwright

BASE = os.getenv('QA_URL', 'http://host.docker.internal:4185')
if urlparse(BASE).hostname not in {'localhost', '127.0.0.1', 'host.docker.internal'}:
    raise RuntimeError('Use the local synthetic harness only.')


def message(key, unread=False):
    return dict(id=key, firm_id='qa-firm', candidate_id='qa-candidate', application_id=None,
        from_name='Synthetic Recruiter', from_email='recruiter@example.test', subject=f'Synthetic email {key}',
        snippet='Synthetic snippet', body=f'Synthetic body {key}', received_at='2026-11-02T00:00:00Z',
        source_address='retained-account@example.test', is_read=not unread)


async def run():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True, args=['--no-sandbox'])
        page = await browser.new_page(viewport={'width':1440, 'height':1100}, reduced_motion='reduce')
        errors, calls = [], []
        page.on('pageerror', lambda error: errors.append(str(error)))
        connection = dict(firm_id='qa-firm', candidate_id='qa-candidate', provider='GOOGLE',
            address='candidate@example.test', connected_at='2026-11-02T00:00:00Z',
            last_synced_at=None, status='CONNECTED', last_sync_error=None)
        messages = [message('a'), message('b', True)]
        reads = 0
        async def route_request(route):
            nonlocal reads
            request = route.request
            url = urlparse(request.url)
            if url.hostname == 'accounts.google.com':
                await route.fulfill(body='<h1>Synthetic Google consent</h1>', content_type='text/html')
                return
            if url.hostname != urlparse(BASE).hostname:
                await route.abort()
                return
            if not url.path.startswith('/api/'):
                await route.continue_()
                return
            calls.append((request.method, url.path))
            mode = parse_qs(urlparse(page.url).query).get('state', [''])[0]
            if url.path.endswith('/read'):
                key = url.path.split('/')[-2]
                row = next(row for row in messages if row['id'] == key)
                reads += 1
                if reads == 1:
                    await route.fulfill(status=503, json={'detail':'Synthetic read failed'})
                else:
                    row['is_read'] = True
                    await route.fulfill(json=row)
                return
            if url.path.endswith('/mailbox/oauth'):
                await route.fulfill(json={'authorization_url':'https://accounts.google.com/o/oauth2/v2/auth?state=synthetic'})
                return
            if request.method == 'DELETE':
                connection['status'] = 'DISCONNECTED'
            if url.path.endswith('/inbox') and mode == 'error':
                await route.fulfill(status=503, json={'detail':'Synthetic Inbox failed'})
                return
            if url.path.endswith('/inbox') and mode == 'loading':
                await asyncio.sleep(0.8)
            payload = dict(firm_id='qa-firm', candidate_id='qa-candidate',
                connection=None if mode in {'empty','readonly-empty'} else connection,
                messages=[] if mode in {'empty','readonly-empty'} else messages)
            await route.fulfill(json={'imported':0,'inbox':payload} if url.path.endswith('/sync') else payload)
        await page.route('**/*', route_request)
        await page.goto(BASE, wait_until='networkidle')
        await page.get_by_role('list', name='Emails').wait_for()
        assert await page.get_by_text('Unclassified email', exact=True).count() == 3
        await page.get_by_role('button', name=re.compile('Synthetic email a')).focus()
        await page.keyboard.press('ArrowDown')
        await page.get_by_role('alert').wait_for()
        await page.wait_for_timeout(250)
        assert reads == 1, 'failed read must not loop automatically'
        await page.get_by_role('button', name='Retry').click()
        await page.wait_for_timeout(250)
        assert reads == 2
        await page.get_by_text('Synthetic body b', exact=True).wait_for()
        await page.get_by_text('Mailbox: retained-account@example.test', exact=True).wait_for()
        await page.get_by_role('button', name='Sync now').click()
        await page.wait_for_timeout(150)
        assert ('POST','/api/firms/qa-firm/candidates/qa-candidate/mailbox/sync') in calls
        await page.get_by_role('button', name='Disconnect', exact=True).click()
        await page.get_by_text('Mailbox disconnected · imported email retained', exact=True).wait_for()
        assert await page.get_by_role('list', name='Emails').count() == 1
        assert await page.get_by_role('button', name='Continue to Google').count() == 1
        assert await page.get_by_role('button', name='Sync now').count() == 0

        axe = os.getenv('QA_AXE_PATH') or str(next(Path('/app/node_modules/.pnpm').glob('axe-core@*/node_modules/axe-core/axe.min.js')))
        for theme in ['light','dark']:
            for width in [1440,1024,390]:
                await page.set_viewport_size({'width':width,'height':1100})
                await page.evaluate('(theme)=>document.documentElement.dataset.theme=theme', theme)
                assert await page.evaluate('document.documentElement.scrollWidth <= innerWidth'), (theme,width,'overflow')
                await page.add_script_tag(path=axe)
                violations = await page.evaluate("async()=> (await axe.run(document.getElementById('root'),{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}})).violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)}))")
                assert not violations, (theme,width,violations)
                await page.keyboard.press('Tab')
                assert await page.evaluate("document.activeElement !== document.body"), 'keyboard focus missing'
        connection['status'] = 'CONNECTED'
        messages[1]['is_read'] = False
        before_writes = len([call for call in calls if call[0] != 'GET'])
        await page.goto(BASE+'?state=readonly', wait_until='networkidle')
        await page.get_by_role('button', name=re.compile('Synthetic email b')).click()
        await page.wait_for_timeout(100)
        assert len([call for call in calls if call[0] != 'GET']) == before_writes
        assert await page.get_by_role('button', name='Continue to Google').count() == 0
        assert await page.get_by_role('button', name='Disconnect', exact=True).count() == 0
        await page.goto(BASE+'?state=error', wait_until='networkidle')
        await page.get_by_role('alert').wait_for()
        await page.goto(BASE+'?state=loading', wait_until='domcontentloaded')
        assert await page.get_by_role('list', name='Emails').count() == 0
        await page.get_by_role('list', name='Emails').wait_for()
        await page.goto(BASE+'?state=empty', wait_until='networkidle')
        await page.get_by_role('button', name='Continue to Google').focus()
        await page.keyboard.press('Enter')
        await page.wait_for_url('https://accounts.google.com/**')
        await page.get_by_text('Synthetic Google consent').wait_for()
        assert not errors, errors
        print(json.dumps({'result':'passed','themes':2,'viewports':[1440,1024,390],
            'read_retry_calls':reads,'retained_mail':True,'oauth_google_navigation':True,'page_errors':errors}))
        await browser.close()

asyncio.run(run())
