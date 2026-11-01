import asyncio, json, re, os
from urllib.parse import urlparse
from playwright.async_api import async_playwright

async def main():
    base=os.getenv('QA_NEXT_URL','http://host.docker.internal:3002')
    transport=os.getenv('QA_BACKEND_URL','http://host.docker.internal:8000')
    if any(urlparse(url).hostname not in {'localhost','127.0.0.1','host.docker.internal'} for url in [base,transport]):
        raise RuntimeError('Route smoke targets must be local.')
    sample=json.load(open(os.getenv('QA_CANDIDATE_SAMPLE','/tmp/benchq-candidate-sample.json')))['list'][0]
    candidate_id='cand_06'
    backend_candidate_id=sample['id']
    candidate_name=sample['full_name']
    sample.update(qa_bank=[])
    firm=sample['firm_id']
    connection=dict(firm_id=firm,candidate_id=backend_candidate_id,provider='GOOGLE',address='synthetic@example.test',connected_at='2026-10-31T12:00:00Z',last_synced_at=None,status='CONNECTED',last_sync_error=None)
    def message(i):
        return dict(id=f'synthetic-next-mail-{i}',firm_id=firm,candidate_id=backend_candidate_id,application_id=None,from_name='Synthetic Recruiter',from_email='recruiter@example.test',subject=f'Synthetic Next email {i}',snippet='Synthetic body',body='Synthetic route acceptance only.',received_at='2026-10-31T12:00:00Z',is_read=True,thread_id=f'synthetic-thread-{i}',classification_state='DONE',classification_error=None,classification={'category':'assessment','confidence':0.9,'outcome':'UNMATCHED','probabilities':{}})
    async with async_playwright() as p:
        browser=await p.chromium.launch(headless=True,args=['--no-sandbox'])
        context=await browser.new_context(viewport={'width':1440,'height':1000},reduced_motion='reduce')
        response=await context.request.post(transport+'/api/auth/sign-in',headers={'Origin':'http://localhost:3000'},data={'email':'imran@hyderabad-tech-staffing.benchq.test','password':'benchq-demo-2026'})
        assert response.status==200, response.status
        try:
            page=await context.new_page();errors=[];requests=[];rsc=[]
            page.on('pageerror',lambda error:errors.append(str(error)))
            page.on('request',lambda request:rsc.append(request.url) if '_rsc=' in request.url else None)
            async def api(route):
                if route.request.method != 'GET':
                    raise AssertionError('Unexpected mutation in read-only route smoke')
                path=urlparse(route.request.url).path
                if path.endswith('/candidates/'+backend_candidate_id): await route.fulfill(json=sample)
                elif path.endswith('/candidates/'+backend_candidate_id+'/inbox'):
                    requests.append(path);await route.fulfill(json=dict(firm_id=firm,candidate_id=backend_candidate_id,connection=connection,messages=[message(0),message(1)]))
                elif path=='/api/applications': await route.fulfill(json={'applications':[],'total':0})
                elif path=='/api/jobs': await route.fulfill(json={'candidate_id':backend_candidate_id,'jobs':[],'total':0,'favorite_job_ids':[]})
                elif path=='/api/companies': await route.fulfill(json=[])
                elif '/inbox/unmatched-reviews' in path: await route.fulfill(json={'total':0,'messages':[]})
                elif path.endswith('/read'): raise AssertionError('Read-only synthetic messages must not generate a read mutation')
                else:
                    url=urlparse(route.request.url)
                    upstream=await route.fetch(url=transport+url.path+('?' + url.query if url.query else ''))
                    await route.fulfill(response=upstream)
            await page.route(re.compile(r'^http://[^/]+/api/'),api)
            await page.goto(base+'/hyderabad-tech-staffing/candidates/'+candidate_id+'?tab=inbox',wait_until='networkidle')
            try:
                await page.get_by_role('list',name='Emails').wait_for(timeout=30000)
            except Exception:
                print('FAILED_STATE',json.dumps({'url':page.url,'body':(await page.locator('body').inner_text())[:1800],'errors':errors}),flush=True)
                raise
            await page.get_by_role('heading',name=candidate_name,exact=True).wait_for()
            await page.evaluate("window.originalInboxList=document.querySelector('ul[aria-label=Emails]')")
            before=len(requests);rsc_before=len(rsc)
            await page.locator('#mail-synthetic-next-mail-0').click()
            await page.locator('#mail-synthetic-next-mail-1').click()
            await page.get_by_role('heading',name='Synthetic Next email 1',exact=True).wait_for()
            assert 'message=synthetic-next-mail-1' in page.url
            await page.go_back()
            await page.get_by_role('heading',name='Synthetic Next email 0',exact=True).wait_for()
            await page.go_forward()
            await page.get_by_role('heading',name='Synthetic Next email 1',exact=True).wait_for()
            assert len(requests)==before
            assert len(rsc)==rsc_before
            assert await page.evaluate("window.originalInboxList===document.querySelector('ul[aria-label=Emails]')")
            assert not errors,errors
            print(json.dumps({'next_route':'passed','cached_selection_inbox_requests':len(requests)-before,'selection_rsc_requests':len(rsc)-rsc_before,'native_back_forward':'passed','list_identity_preserved':True,'page_errors':errors}))
        finally:
            await context.request.post(transport+'/api/auth/sign-out',headers={'Origin':'http://localhost:3000'})
        await browser.close()

asyncio.run(main())
