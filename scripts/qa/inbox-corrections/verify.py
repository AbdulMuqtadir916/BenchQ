import asyncio, json, os, re
from urllib.parse import urlparse, parse_qs
from playwright.async_api import async_playwright

BASE = os.getenv('QA_URL', 'http://host.docker.internal:4178')
if urlparse(BASE).hostname not in {'localhost','127.0.0.1','host.docker.internal'}:
    raise RuntimeError('QA_URL must point to the local synthetic harness.')


def email(i):
    return dict(id=f'mail-{i}', firm_id='qa-firm', candidate_id='qa-candidate', application_id=None if i == 1 else 'qa-app',
        from_name=f'Synthetic Recruiter {i}', from_email='recruiter@example.test', subject=f'Synthetic email {i}',
        snippet='Synthetic body', body=f'Synthetic body for email {i}', received_at='2026-10-31T12:00:00+00:00',
        is_read=i != 2, thread_id=f'thread-{i}', classification_state='DONE', classification_error=None,
        classification={'category':'assessment' if i == 1 else 'shortlisted','confidence':0.9,'outcome':'UNMATCHED' if i == 1 else 'NO_CHANGE','probabilities':{}})

async def run():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True, args=['--no-sandbox'])
        page = await browser.new_page(viewport={'width':1440,'height':1000}, reduced_motion='reduce')
        errors=[]
        page.on('pageerror', lambda error: errors.append(str(error)))
        calls=[]
        read_attempts=0
        messages=[email(i) for i in range(40)]
        old=email(99);old['id']='old-mail';old['subject']='Synthetic older review email'
        connection=dict(firm_id='qa-firm',candidate_id='qa-candidate',provider='GOOGLE',address='candidate@example.test',connected_at='2026-10-31T12:00:00Z',last_synced_at=None,status='CONNECTED',last_sync_error=None)
        async def api(route):
            nonlocal read_attempts
            request=route.request; url=urlparse(request.url); query=parse_qs(url.query)
            calls.append((request.method,url.path,query))
            if url.path == '/api/applications':
                await route.fulfill(json={'applications':[],'total':0});return
            if url.path.endswith('/read'):
                key=url.path.split('/')[-2]; msg=next((m for m in messages if m['id']==key),old)
                if key=='mail-2':
                    read_attempts+=1
                    if read_attempts==1:
                        await route.fulfill(status=503,json={'detail':'Synthetic read failure'});return
                msg['is_read']=True
                await route.fulfill(json=msg);return
            if url.path.endswith('/inbox'):
                mode=parse_qs(urlparse(page.url).query).get('state',[''])[0]
                if mode=='error':
                    await route.fulfill(status=503,json={'detail':'Synthetic inbox unavailable'});return
                if mode=='empty':
                    await route.fulfill(json=dict(firm_id='qa-firm',candidate_id='qa-candidate',connection=None,messages=[]));return
                if mode=='loading': await asyncio.sleep(1)
                key=query.get('message_id',[None])[0]
                if key=='missing-mail':
                    await route.fulfill(status=404,json={'detail':'Email not found.'});return
                if key=='old-mail':
                    await asyncio.sleep(0.3)
                    rows=[messages[0],old]
                else:
                    rows=messages
                if mode=='processing' and sum(1 for c in calls if c[1].endswith('/inbox'))==1:
                    rows=[{**messages[0],'classification_state':'PENDING','classification':None},*messages[1:]]
                await route.fulfill(json=dict(firm_id='qa-firm',candidate_id='qa-candidate',connection=connection,messages=rows));return
            await route.fulfill(status=200,json={})
        await page.route(re.compile(r'^http://[^/]+/api/'),api)
        await page.goto(BASE, wait_until='networkidle')

        try:
            await page.get_by_role('list',name='Emails').wait_for()
        except Exception:
            print('LOAD_FAILURE',json.dumps({'errors':errors,'body':(await page.locator('body').inner_text())[:600]}),flush=True)
            raise
        if errors: raise AssertionError(errors)
        await page.evaluate("""() => {
          window.qaMounts=0;window.qaLoadingFlashes=0;
          const list=document.querySelector('ul[aria-label="Emails"]');window.qaList=list;
          new MutationObserver(()=>{if(!document.contains(list))window.qaLoadingFlashes++}).observe(document.getElementById('root'),{childList:true,subtree:true});
        }""")
        before=len([c for c in calls if c[1].endswith('/inbox')])
        apps_before=sum(1 for c in calls if c[1]=='/api/applications')
        await page.locator('#mail-mail-1').click()
        await page.get_by_role('heading',name='Synthetic email 1',exact=True).wait_for()
        await page.get_by_role('combobox',name=re.compile('^Application')).select_option('qa-app')
        await page.locator('#mail-mail-3').click()
        await page.locator('#mail-mail-1').click()
        # Per-email selection does not leak from a different email or carry stale form state.
        preserved = await page.get_by_role('combobox',name=re.compile('^Application')).input_value()=='qa-app'
        if os.getenv('QA_BASELINE')!='1': assert preserved
        after=len([c for c in calls if c[1].endswith('/inbox')])
        baseline=os.getenv('QA_BASELINE')=='1'
        if baseline:
            print(json.dumps({'baseline':True,'review_selection_preserved':preserved,'cached_selections_collection_requests':after-before,'list_flashes':await page.evaluate('window.qaLoadingFlashes')}))
            await browser.close();return
        assert after==before, (before,after)
        assert sum(1 for c in calls if c[1]=='/api/applications')==apps_before
        assert await page.evaluate('window.qaLoadingFlashes')==0
        await page.locator('#mail-mail-2').click()
        await page.get_by_role('alert').filter(has_text='Couldn’t mark').wait_for()
        assert read_attempts==1
        assert await page.evaluate("window.qa.client.getQueryData(['qa-firm','inbox','byCandidate','qa-candidate']).messages.find(m=>m.id==='mail-2').isRead") is False
        await page.get_by_role('button',name='Retry',exact=True).click()
        await page.wait_for_function("window.qa.client.getQueryData(['qa-firm','inbox','byCandidate','qa-candidate']).messages.find(m=>m.id==='mail-2').isRead")
        assert read_attempts==2
        await page.get_by_role('button',name='Open older email',exact=True).click()
        assert await page.get_by_role('list',name='Emails').count()==1
        await page.get_by_role('heading',name='Synthetic older review email').wait_for()
        old_calls=[c for c in calls if c[2].get('message_id')==['old-mail']]
        assert len(old_calls)==1 and old_calls[0][2].get('limit')==['1']
        assert await page.get_by_role('list',name='Emails').locator('li').count()==41
        await page.go_back();await page.get_by_role('heading',name='Synthetic email 2',exact=True).wait_for()
        await page.go_forward();await page.get_by_role('heading',name='Synthetic older review email').wait_for()
        await page.get_by_role('button',name='Open missing email',exact=True).click()
        await page.get_by_text('Email not found.',exact=True).wait_for()
        assert await page.get_by_role('list',name='Emails').count()==1
        await page.locator('#mail-mail-4').click()
        await page.get_by_role('heading',name='Synthetic email 4',exact=True).wait_for()
        # Native list identity, scroll and filter survive selection.
        await page.get_by_role('button',name='Shortlisted 40',exact=True).click()
        await page.evaluate("document.querySelector('ul[aria-label=Emails]').scrollTop=100")
        await page.evaluate("window.qa.select('mail-5')")
        assert await page.get_by_role('button',name='Shortlisted 40',exact=True).get_attribute('aria-pressed')=='true'
        assert await page.evaluate("document.querySelector('ul[aria-label=Emails]')===window.qaList")
        assert await page.evaluate("document.querySelector('ul[aria-label=Emails]').scrollTop")>0
        await page.locator('#mail-mail-5').focus();await page.keyboard.press('ArrowDown')
        await page.get_by_role('heading',name='Synthetic email 6',exact=True).wait_for()
        await page.get_by_role('button',name='Needs BDE review 1',exact=True).click()
        await page.evaluate("window.qa.select('mail-3')")
        await page.get_by_role('heading',name='Synthetic email 3',exact=True).wait_for()
        await page.get_by_text('The selected email is outside this filter.',exact=False).wait_for()
        await page.get_by_role('button',name='Show all emails',exact=True).click()
        # All eleven statuses round-trip presentation; outcomes never fill an offer.
        for status in ['SAVED','APPLIED','INCOMPLETE_APPLICATION','SCREENING_CALL','SHORTLISTED','INTERVIEW_SCHEDULE_REQUEST','INTERVIEW_SCHEDULED','ASSESSMENT','OFFER','MOVE_ON','OTHER']:
            await page.evaluate('(value)=>window.qa.status(value)',status)
            await page.locator(f'[data-status="{status}"][data-state="current"]').wait_for()
        await page.evaluate("window.qa.status('MOVE_ON')")
        assert await page.locator('[data-status=OFFER]').get_attribute('data-state')=='future'
        # The actual drawer traps focus, closes with Escape and restores the opener.
        await page.get_by_role('button',name='Open application drawer',exact=True).click()
        await page.get_by_role('dialog').wait_for()
        await page.get_by_role('button',name='Close',exact=True).wait_for()
        assert await page.get_by_role('button',name='Close',exact=True).evaluate('(element)=>element===document.activeElement')
        await page.keyboard.press('Shift+Tab')
        assert await page.get_by_role('link',name='Open full application').evaluate('(element)=>element===document.activeElement')
        await page.keyboard.press('Tab')
        assert await page.get_by_role('button',name='Close',exact=True).evaluate('(element)=>element===document.activeElement')
        await page.keyboard.press('Escape')
        await page.get_by_role('dialog').wait_for(state='hidden')
        assert await page.get_by_role('button',name='Open application drawer',exact=True).evaluate('(element)=>element===document.activeElement')
        # Axe checks actual components. Harness navigation is deliberately outside the app shell.
        await page.add_script_tag(path=os.getenv('QA_AXE_PATH','/tmp/axe.min.js'))
        violations=[]
        for theme in ['light','dark']:
            await page.evaluate("(dark)=>document.documentElement.dataset.theme=dark?'dark':'light'",theme=='dark')
            for width in [1440,1024,390]:
                await page.set_viewport_size({'width':width,'height':1000})
                await page.wait_for_timeout(300)
                result=await page.evaluate("async()=> (await axe.run(document.querySelector('main'), {rules:{'region':{enabled:false}}})).violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary,html:n.html}))}))")
                violations+=result
                await page.get_by_role('button',name='Open application drawer',exact=True).click()
                await page.get_by_role('dialog').wait_for()
                await page.wait_for_timeout(300)
                violations += await page.evaluate("async()=> (await axe.run(document.querySelector('[role=dialog]'), {rules:{'region':{enabled:false}}})).violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))}))")
                assert await page.evaluate('document.documentElement.scrollWidth<=window.innerWidth'), (theme,width)
                await page.screenshot(path=f'/tmp/correction-{theme}-{width}.png',full_page=True)
                await page.keyboard.press('Escape')
                await page.get_by_role('dialog').wait_for(state='hidden')

        if violations: print('AXE_DETAILS',json.dumps(violations),flush=True)
        assert not violations, violations
        assert not errors, errors
        list_flashes = await page.evaluate('window.qaLoadingFlashes')
        assert list_flashes == 0
        # Skeleton, empty, error and read-only states exercise the real panel.
        await page.goto(BASE+'?state=loading',wait_until='domcontentloaded')
        await page.get_by_role('status',name='Loading list').wait_for()
        await page.get_by_role('list',name='Emails').wait_for()
        await page.goto(BASE+'?state=empty',wait_until='networkidle')
        await page.get_by_text('Connect Gmail for Synthetic',exact=True).wait_for()
        await page.goto(BASE+'?state=error',wait_until='networkidle')
        await page.get_by_text('Synthetic inbox unavailable',exact=True).wait_for()
        await page.get_by_role('button',name='Retry',exact=True).wait_for()
        calls.clear()
        await page.goto(BASE+'?state=readonly',wait_until='networkidle')
        await page.get_by_role('list',name='Emails').wait_for()
        await page.locator('#mail-mail-2').click()
        assert not [c for c in calls if c[0]=='PATCH']
        assert await page.get_by_role('button',name='Sync now',exact=True).count()==0
        assert await page.get_by_role('button',name='Disconnect',exact=True).count()==0
        calls.clear()
        await page.goto(BASE+'?state=processing',wait_until='networkidle')
        await page.wait_for_function("window.qa.client.getQueryData(['qa-firm','inbox','byCandidate','qa-candidate'])?.messages[0]?.classificationState==='DONE'")
        await page.wait_for_timeout(300)
        assert sum(1 for c in calls if c[1]=='/api/applications')>=2
        settled=sum(1 for c in calls if c[1].endswith('/inbox'))
        await page.wait_for_timeout(2500)
        assert sum(1 for c in calls if c[1].endswith('/inbox'))==settled
        print(json.dumps({'cached_selection_requests':after-before,'list_flashes':list_flashes,'read_failure_retry_requests':read_attempts,'older_email_requests':len(old_calls),'themes':2,'viewports':[1440,1024,390],'axe_violations':violations,'console_errors':errors,'result':'passed'}))
        await browser.close()

asyncio.run(run())
