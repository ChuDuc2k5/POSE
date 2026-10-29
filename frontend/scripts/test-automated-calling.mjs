import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import * as f from './calling-test-process.mjs';
let checks = 0;
const check = (value, label) => {
  assert.ok(value, label);
  checks++;
};
const event = (call, type, extra = {}) => ({
  event_id: randomUUID(),
  provider_call_id: call.id,
  type,
  occurred_at: new Date().toISOString(),
  ...extra,
});
async function json(response, status = 200) {
  const body = await response.json();
  check(response.status === status, `expected ${status}, got ${response.status}: ${JSON.stringify(body)}`);
  return body;
}
const row = async (id) => (await f.owner('select * from calls where id=$1', [id])).rows[0];
const campaign = 'f8900000-0000-4000-8000-000000000001';
async function resetJobs() {
  await f.owner("update call_jobs set status='Cancelled' where status='Pending'");
}
async function prepare(n) {
  await f.owner(
    "update call_jobs set status='Pending' where membership_id=(select id from campaign_customers where lead_id=$1 and campaign_id=$2)",
    [f.id('40', n), campaign],
  );
  await f.owner("update campaigns set status='RUNNING' where id=$1", [campaign]);
}
async function terminal(call, type = 'completed', extra = {}) {
  await json(await f.postEvent(event(call, type, extra)));
}
try {
  await f.startCallingFixture();
  if (process.argv.includes('--preview-only')) {
    await f.cronCall('dispatch');
    await f.seedCallingUi();
    console.log('PREVIEW READY: ' + f.origin);
    await new Promise((resolve) => {
      process.once('message', resolve);
      process.once('SIGINT', resolve);
      process.once('SIGTERM', resolve);
    });
  } else {
    // Catalogue transport must bind filters and expose the current listing terms.
    const catalog = async (filters) =>
      json(
        await fetch('http://127.0.0.1:3501/rest/v1/property_public_catalog?' + new URLSearchParams(filters), {
          headers: { Authorization: 'Bearer fixture-public' },
        }),
      );
    let listings = await catalog({ id: 'eq.' + f.productId });
    check(
      listings.length === 1 &&
        listings[0].id === f.productId &&
        listings[0].transaction_type === 'Sale' &&
        listings[0].price_period === 'Total',
      'UUID equality and sale listing columns',
    );
    check((await catalog({ id: 'eq.' + f.id('60', 2) })).length === 0, 'draft excluded by public catalogue');
    await f.owner(
      "update property_products set transaction_type='Rent',price_period='Month',price=12000000 where id=$1",
      [f.productId],
    );
    listings = await catalog({
      transaction_type: 'eq.Rent',
      property_type: 'eq.Apartment',
      location: 'ilike.%Chí Minh%',
      price: 'gte.10000000',
    });
    check(
      listings.length === 1 && listings[0].id === f.productId && listings[0].price_period === 'Month',
      'combined rental text and numeric filters',
    );
    check(
      (await catalog({ transaction_type: 'eq.Sale' })).length === 0,
      'transaction type excludes mismatched listings',
    );
    check((await catalog({ price: 'lte.10000000' })).length === 0, 'numeric upper bound excludes higher rent');
    check(
      (await catalog({ id: 'in.(' + f.productId + ',' + f.id('60', 2) + ')' })).length === 1,
      'UUID set filter preserves public visibility',
    );
    await f.owner("update property_products set transaction_type='Sale',price_period='Total',price=null where id=$1", [
      f.productId,
    ]);
    check((await f.call('/api/calls', 'GET', undefined, null)).status === 401, 'Guest denied');
    check((await f.call('/api/calls', 'GET', undefined, 'user')).status === 403, 'User denied');
    check((await fetch(f.origin + '/api/system/calls/dispatch', { method: 'POST' })).status === 401, 'cron protected');
    check(
      (
        await f.call(
          '/api/contacts/opt-out',
          'POST',
          { phone: '+84901230001', reason: 'fixture' },
          'admin',
          'https://other.test',
        )
      ).status === 403,
      'origin protected',
    );
    // Five workers contend on the real PostgreSQL admission and reservation transaction.
    const parallel = await Promise.all(Array.from({ length: 5 }, () => f.cronCall('dispatch')));
    for (const response of parallel) await json(response);
    check(
      (await f.scalar("select count(*)::integer from calls where status='CALLING'")) === 2,
      'parallel global capacity two',
    );
    check(
      Number(await f.scalar('select budget_reserved_vnd from campaigns where id=$1', [campaign])) === 200,
      'parallel reserve exactly two',
    );
    check((await f.stats()).received === 2, 'simulator dispatch exactly twice');
    await json(await f.cronCall('dispatch'));
    check((await f.stats()).received === 2, 'repeated dispatch idempotent');
    const calls = (await f.owner('select * from calls order by created_at,id')).rows,
      a = calls[0],
      b = calls[1];
    // Invalid callbacks have no event/Lead effects.
    const before = await f.scalar('select sum(version)::integer from leads');
    check((await f.postEvent(event(a, 'completed'), { bad: true })).status === 401, 'bad HMAC');
    check((await f.postEvent(event(a, 'completed'), { stale: true })).status === 401, 'stale HMAC');
    check(
      (await f.scalar('select sum(version)::integer from leads')) === before &&
        (await f.scalar('select count(*)::integer from call_events')) === 0,
      'invalid callbacks have no effects',
    );
    const done = event(a, 'completed', {
      cost: { amount: 0.01, currency: 'USD', fx_rate: 25000, fx_source: 'fixture' },
    });
    for (let n = 0; n < 3; n++) await json(await f.postEvent(done));
    await json(await f.postEvent(event(a, 'ringing')));
    check((await row(a.id)).status === 'COMPLETED', 'terminal cannot regress');
    check(
      (await f.scalar('select count(*)::integer from call_events where provider_event_id=$1', [done.event_id])) === 1,
      'triple callback one event',
    );
    check(
      Number(await f.scalar('select budget_spent_vnd from campaigns where id=$1', [campaign])) === 250,
      'USD converted using fx once',
    );
    await terminal(b, 'busy');
    const member = (await f.owner('select * from campaign_customers where id=$1', [b.membership_id])).rows[0];
    check(
      member.status === 'RETRYING' &&
        member.retry_count === 1 &&
        Date.parse(member.next_attempt_at) >= Date.now() + 24 * 3600000 - 2000,
      'busy retry spacing',
    );
    await resetJobs();
    await prepare(3);
    const sent = (await f.stats()).received;
    await json(await f.cronCall('dispatch'));
    check((await f.stats()).received === sent, 'missing Call consent never reaches provider');
    check(
      (await f.scalar('select status from campaign_customers where lead_id=$1', [f.id('40', 3)])) === 'OPTED_OUT',
      'missing consent membership blocked',
    );
    // Ambiguous dispatch must reconcile before another attempt.
    await prepare(9);
    f.setScenario('+84901230009', 'ambiguous');
    await json(await f.cronCall('dispatch'));
    const ambiguous = (await f.owner("select * from calls where phone_e164='+84901230009'")).rows[0];
    check(ambiguous.status === 'UNKNOWN', 'timeout becomes UNKNOWN');
    const count = (await f.stats()).received;
    await json(await f.cronCall('dispatch'));
    check((await f.stats()).received === count, 'UNKNOWN never redispatched');
    await json(await f.cronCall('reconcile'));
    check((await row(ambiguous.id)).status === 'COMPLETED', 'UNKNOWN reconciled from provider');
    // Held call demonstrates Ending is a request, not a final status.
    await prepare(10);
    f.setScenario('+84901230010', 'slow_hangup');
    await json(await f.cronCall('dispatch'));
    const stopped = (await f.owner("select * from calls where phone_e164='+84901230010'")).rows[0];
    await json(await f.call(`/api/calls/${stopped.id}/stop`, 'POST', { reason: 'Customer requested stop' }));
    check((await row(stopped.id)).status === 'ENDING', 'stop remains ENDING until confirmation');
    await terminal(stopped, 'canceled');
    check((await row(stopped.id)).status === 'CANCELED', 'provider confirms stop');
    // Opt-out cancels every campaign membership and queued job for the phone.
    await f.owner(
      "insert into campaign_customers(campaign_id,customer_id,lead_id,phone_e164) select 'f8900000-0000-4000-8000-000000000002',customer_id,lead_id,phone_e164 from campaign_customers where lead_id=$1",
      [f.id('40', 11)],
    );
    await f.owner(
      "insert into call_jobs(campaign_id,membership_id,attempt_no,scheduled_at,idempotency_key) select campaign_id,id,1,now(),'other:'||id from campaign_customers where campaign_id='f8900000-0000-4000-8000-000000000002'",
    );
    await json(
      await f.call('/api/contacts/opt-out', 'POST', { phone: '+84901230011', reason: 'Customer requests no contact' }),
    );
    check(
      (await f.scalar(
        "select count(*)::integer from campaign_customers where phone_e164='+84901230011' and status='OPTED_OUT'",
      )) === 2,
      'opt-out across campaigns',
    );
    check(
      (await f.scalar(
        "select count(*)::integer from call_jobs j join campaign_customers m on m.id=j.membership_id where m.phone_e164='+84901230011' and j.status in ('Pending','Claimed')",
      )) === 0,
      'all queued jobs canceled',
    );
    // Budget pause is audited before provider dispatch.
    await prepare(12);
    await f.owner('update campaigns set budget_limit_vnd=budget_spent_vnd+50 where id=$1', [campaign]);
    await json(await f.cronCall('dispatch'));
    check(
      (await f.scalar('select status_reason from campaigns where id=$1', [campaign])) === 'BUDGET_EXHAUSTED',
      'budget exhausted pauses',
    );
    check(
      (await f.scalar("select count(*)::integer from campaign_events where action='budget_alert'")) === 1,
      'budget alert persisted',
    );
    await f.owner('update campaigns set budget_limit_vnd=10000 where id=$1', [campaign]);
    await prepare(12);
    await json(await f.cronCall('dispatch'));
    const consented = (await f.owner("select * from calls where phone_e164='+84901230012'")).rows[0];
    await json(await f.postEvent(event(consented, 'answered')));
    await f.owner('select set_config(\'request.jwt.claims\',\'{"role":"service_role"}\',false)');
    const callContext = (await f.owner('select public.pose_system_call_context($1) as context', [consented.id])).rows[0]
      .context;
    check(
      Array.isArray(callContext.lead?.products_of_interest) &&
        callContext.lead?.products_of_interest.includes('DIRECT_INTEREST') &&
        callContext.lead?.campaign_snapshot?.match?.rule_version === 'MATCH.v1' &&
        !('transcript' in (callContext.lead || {})),
      'call context exposes frozen audience reasons without transcript text',
    );
    await f.owner(
      "update property_products set transaction_type='Rent',price_period='Month',price=12000000 where id=$1",
      [f.productId],
    );
    const say = async (text) =>
      json(
        await f.postEvent(
          event(consented, 'answered', { utterance: { speaker: 'Customer', text, at: new Date().toISOString() } }),
        ),
      );
    for (let n = 0; n < 3; n++) await say('\u0111\u1ed3ng \u00fd');
    await say('Toi muon mua can ho.');
    check(
      f
        .modelInput()
        .listing_terms.some((p) => p.code === 'M07-1' && p.transaction_type === 'Rent' && p.price_period === 'Month'),
      'phone conversation model receives rental terms',
    );
    await f.owner("update property_products set transaction_type='Sale',price_period='Total',price=null where id=$1", [
      f.productId,
    ]);
    check(
      (await f.scalar('select count(*)::integer from call_turns where call_id=$1', [consented.id])) > 0,
      'transcript stored after independent grant',
    );
    check(
      (await f.scalar('select count(*)::integer from contact_consents where evidence like $1', [
        `%${consented.id}%`,
      ])) === 3,
      'three independent exact consent evidence rows',
    );
    const bytes = Buffer.from('simulated audio bytes'),
      checksum = createHash('sha256').update(bytes).digest('hex');
    const completed = event(consented, 'completed', {
      cost: { amount: 0.01, currency: 'USD' },
      recording: { bytes: bytes.toString('base64'), checksum, mime: 'audio/wav' },
    });
    for (let n = 0; n < 3; n++) await json(await f.postEvent(completed));
    check((await row(consented.id)).cost_unknown, 'USD without fx flagged and estimate retained');
    check((await row(consented.id)).recording_status === 'Available', 'recording available only after storage upload');
    check(
      (await f.scalar('select count(*)::integer from call_transcripts where call_id=$1', [consented.id])) === 1,
      'transcript finalization once',
    );
    check(
      (await f.scalar('select count(*)::integer from ai_analyses where call_id=$1', [consented.id])) === 1,
      'M06 extraction/scoring exactly once',
    );
    const signed = await json(await f.call(`/api/calls/${consented.id}/recording`));
    check(signed.expires_in === 300, 'signed URL maximum five minutes');
    check((await fetch(signed.url)).ok, 'signed recording accessible');
    f.expireSigned();
    check((await fetch(signed.url)).status === 403, 'expired signed URL denied');
    check(
      (await f.call(`/api/calls/${consented.id}/transcript`, 'GET', undefined, 'user')).status === 403,
      'transcript private',
    );
    // Separate calls exercise storage failure, withdrawal, max duration and assignment.
    async function fixtureCall(n) {
      const c = (
        await f.owner(
          "insert into calls(lead_id,customer_id,phone_e164,script_version_id,provider,call_type,status,started_at) select l.id,c.id,c.phone,$2,'simulator','MOCK_CALL','CALLING',now() from leads l join customers c on c.id=l.customer_id where l.id=$1 returning *",
          [f.id('40', n), f.publishedId],
        )
      ).rows[0];
      await f.owner('update calls set provider_call_id=id::text where id=$1', [c.id]);
      return c;
    }
    async function permit(call, record = true, transcript = true) {
      await json(await f.postEvent(event(call, 'answered')));
      for (const value of [
        '\u0111\u1ed3ng \u00fd',
        record ? '\u0111\u1ed3ng \u00fd' : 'khong',
        transcript ? '\u0111\u1ed3ng \u00fd' : 'khong',
      ])
        await json(
          await f.postEvent(
            event(call, 'answered', { utterance: { speaker: 'Customer', text: value, at: new Date().toISOString() } }),
          ),
        );
    }
    const failedRecording = await fixtureCall(4);
    await permit(failedRecording);
    f.setUploadFailure(true);
    await terminal(failedRecording, 'canceled', {
      recording: { bytes: bytes.toString('base64'), checksum, mime: 'audio/wav' },
    });
    f.setUploadFailure(false);
    check((await row(failedRecording.id)).recording_status === 'Failed', 'storage outage never becomes Available');
    check(
      (await f.scalar('select count(*)::integer from ai_analyses where call_id=$1', [failedRecording.id])) === 1,
      'consented confirmed hangup is processed once through M06',
    );
    const notConsented = await fixtureCall(5);
    await permit(notConsented, false, false);
    const modelPrior = f.modelCount();
    await terminal(notConsented, 'completed', {
      recording: { bytes: bytes.toString('base64'), checksum, mime: 'audio/wav' },
    });
    check(
      (await row(notConsented.id)).recording_status === 'NotConsented' &&
        (await f.scalar('select count(*)::integer from call_recordings where call_id=$1', [notConsented.id])) === 0,
      'no recording without call-specific consent',
    );
    check(
      (await f.scalar('select count(*)::integer from call_turns where call_id=$1', [notConsented.id])) === 0 &&
        f.modelCount() === modelPrior,
      'no transcript or extraction without consent',
    );
    const withdrawn = await fixtureCall(6);
    await permit(withdrawn);
    const turns = await f.scalar('select count(*)::integer from call_turns where call_id=$1', [withdrawn.id]);
    await json(
      await f.postEvent(
        event(withdrawn, 'answered', {
          utterance: { speaker: 'Customer', text: 'dung luu hoi thoai', at: new Date().toISOString() },
        }),
      ),
    );
    check(
      (await row(withdrawn.id)).conversation.consents.Transcript === false,
      'withdrawal disables future transcript storage',
    );
    check(
      (await f.scalar('select count(*)::integer from call_turns where call_id=$1', [withdrawn.id])) === turns,
      'withdrawal does not store further speech',
    );
    check(
      (await f.scalar('select count(*)::integer from lead_tasks where idempotency_key=$1', [
        'call-withdraw:' + withdrawn.id + ':Transcript',
      ])) === 1,
      'withdrawal creates data review item',
    );
    await terminal(withdrawn);
    const watchdog = await fixtureCall(7);
    await f.owner(
      "update calls set status='ANSWERED',answered_at=now()-interval '10 minutes',updated_at=now()-interval '3 minutes' where id=$1",
      [watchdog.id],
    );
    await json(await f.cronCall('reconcile'));
    check(
      (await row(watchdog.id)).status === 'ENDING' && (await row(watchdog.id)).end_reason === 'MAX_DURATION',
      'watchdog requests hangup without claiming completion',
    );
    await terminal(watchdog, 'canceled');
    await f.owner(
      "insert into users(full_name,email,auth_user_id,role,account_status,email_verified) values('Sales','m07-2@example.test',$1,'Sales','active',true)",
      [f.id('10', 2)],
    );
    await f.owner('insert into lead_assignments(lead_id,sales_id) select $1,id from users where auth_user_id=$2', [
      consented.lead_id,
      f.id('10', 2),
    ]);
    const own = await json(await f.call('/api/calls', 'GET', undefined, 'sales'));
    check(
      own.items.every((c) => c.lead_id === consented.lead_id),
      'Sales list scoped to current assignments',
    );
    await json(await f.call(`/api/calls/${consented.id}/transcript`, 'GET', undefined, 'sales'));
    const salesRecording = await json(await f.call(`/api/calls/${consented.id}/recording`, 'GET', undefined, 'sales'));
    check(!!salesRecording.url, 'assigned Sales can sign a consented recording');
    check(
      (await f.call(`/api/calls/${notConsented.id}/recording`, 'GET', undefined, 'sales')).status === 403,
      'unassigned Sales recording denied',
    );
    // Retry uses the job attempt number and never schedules attempt four.
    const exhausted = await fixtureCall(8);
    await f.owner(
      'update call_jobs set attempt_no=3 where membership_id=(select id from campaign_customers where lead_id=$1 and campaign_id=$2)',
      [exhausted.lead_id, campaign],
    );
    await f.owner(
      'update calls set membership_id=m.id,job_id=j.id,campaign_id=m.campaign_id from campaign_customers m join call_jobs j on j.membership_id=m.id where calls.id=$1 and m.lead_id=calls.lead_id and m.campaign_id=$2',
      [exhausted.id, campaign],
    );
    await terminal(exhausted, 'no_answer');
    check(
      (await f.scalar('select status from campaign_customers where lead_id=$1', [exhausted.lead_id])) === 'EXHAUSTED',
      'maximum three attempts',
    );
    const missing = await fixtureCall(5);
    await fetch('http://127.0.0.1:3509/dispatch', {
      method: 'POST',
      headers: { Authorization: 'Bearer fixture-telephony', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: missing.phone_e164,
        from: 'simulator',
        callbackUrl: f.origin + '/api/webhooks/telephony',
        maxSeconds: 30,
        record: false,
        idempotencyKey: missing.id,
        metadata: { call_id: missing.id, scenario: 'missing_final' },
      }),
    });
    let reported;
    for (let n = 0; n < 60; n++) {
      reported = (await f.stats()).calls.find((c) => c.id === missing.id);
      if (reported?.latest?.type === 'completed') break;
      await delay(100);
    }
    check(
      reported?.latest?.type === 'completed' && (await row(missing.id)).status === 'ANSWERED',
      'simulator omits final callback',
    );
    await f.owner("update calls set updated_at=now()-interval '3 minutes' where id=$1", [missing.id]);
    await json(await f.cronCall('reconcile'));
    check((await row(missing.id)).status === 'COMPLETED', 'missing terminal event reconciled');
    const test = await json(
      await f.call('/api/admin/calls/test', 'POST', { lead_id: f.id('40', 5), script_version_id: f.publishedId }),
    );
    check(
      test.item.call_type === 'MOCK_CALL' && test.item.provider === 'simulator',
      'admin test call explicitly simulated',
    );
    await terminal(test.item, 'canceled');
    // Admin playground uses the same engine, without persisting a fake phone call.
    const playground = async (state, text = '', extra = {}) =>
      json(
        await f.call('/api/admin/calls/playground', 'POST', {
          script_version_id: f.publishedId,
          state,
          text,
          ...extra,
        }),
      );
    let p = await playground();
    check(p.state.phase === 'AIVoice', 'disclosure before permission');
    p = await playground(p.state, 'khong');
    check(p.state.end_reason === 'NO_AI_VOICE_CONSENT', 'AI voice refusal ends');
    p = await playground();
    for (let n = 0; n < 3; n++) p = await playground(p.state, '\u0111\u1ed3ng \u00fd');
    await f.owner(
      "update property_products set transaction_type='Rent',price_period='Month',price=12000000 where id=$1",
      [f.productId],
    );
    p = await playground(p.state, 'Tôi cần tư vấn thuê căn hộ.', { property_id: f.productId });
    check(
      f
        .modelInput()
        .listing_terms.some((p) => p.code === 'M07-1' && p.transaction_type === 'Rent' && p.price_period === 'Month'),
      'playground model receives rental terms',
    );
    await f.owner("update property_products set transaction_type='Sale',price_period='Total',price=null where id=$1", [
      f.productId,
    ]);
    const modelBefore = f.modelCount();
    p = await playground(p.state, 'kh\u00f4ng quan t\u00e2m');
    check(p.state.end_reason === 'DECLINED' && f.modelCount() === modelBefore, 'decline stops advice');
    p = await playground();
    p = await playground(p.state, 'yes', { speaking: true });
    check(p.interrupted, 'barge-in stops current output');
    p = await playground();
    for (let n = 0; n < 3; n++) p = await playground(p.state, '');
    check(p.state.end_reason === 'SILENCE', 'two re-prompts then end');
    p = await playground();
    p = await playground(p.state, '\u0111\u1eebng g\u1ecdi n\u1eefa');
    check(p.optOut && p.state.end_reason === 'OPT_OUT', 'phrase opt-out');
    check(
      (
        await f.call(
          '/api/admin/calls/test',
          'POST',
          { lead_id: f.id('40'), script_version_id: f.publishedId },
          'sales',
        )
      ).status === 403,
      'Sales denied admin test call',
    );
    const progress = await json(await f.call(`/api/admin/campaigns/${campaign}/progress`));
    check(
      progress.item.cost_log.some((c) => c.currency === 'USD' && c.fx_rate),
      'M07 progress adds separate estimate actual and fx log',
    );
    p = await playground();
    p = await playground(p.state, '', { mediaFailure: true });
    check(p.state.end_reason === 'AI_ERROR', 'media failure closes honestly');
    check(
      (await f.scalar(
        "select count(*)::integer from call_events where payload?'utterance' or payload?'recording' or payload?'transcript_turns'",
      )) === 0,
      'immutable event logs never retain unconsented media',
    );
    console.log(`PASS: ${checks} M08 HTTP/provider/conversation checks`);
  }
} finally {
  await f.closeCallingFixture();
}
