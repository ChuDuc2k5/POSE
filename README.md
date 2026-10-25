# Development-of-an-AI-Sales-Automation-Platform-for-Lead-Qualification-and-Customer-Management

## Chạy dự án

Cần Node.js 24. Cài thư viện bằng `npm ci` trong `backend/` và `frontend/`.
Sao chép `backend/.env.example` thành `backend/.env`, điền URL và khóa Supabase.
`SUPABASE_SECRET_KEY` dành cho tác vụ hệ thống; `SUPABASE_STORAGE_SECRET_KEY`
dành cho tải tệp đã được kiểm tra quyền. Không đưa khóa vào biến `NEXT_PUBLIC_*`.
Backend đọc `.env`; khi thiếu cấu hình Supabase trong máy phát triển, có thể đọc
`frontend/.env.local` để tương thích cấu hình cũ.

Sao chép `frontend/.env.example` thành `frontend/.env.local`. `BACKEND_URL` mặc định
là `http://127.0.0.1:3001`; cấu hình giá trị này lúc khởi động frontend. Proxy đọc
địa chỉ backend cho mỗi yêu cầu, không cần build lại khi đổi địa chỉ. M01–M03 và
M06–M08 API đều được chuyển tiếp tới NestJS. Các trang server cũng gọi NestJS để đọc phiên.
Frontend chỉ cần BACKEND_URL; cấu hình LLM, Supabase, telephony và cron nằm trong môi trường backend.

M06 được triển khai trong `backend/src/modules/ai/` với các URL `/api/ai/chat`,
`/api/ai/sessions/:id`, `/api/ai/handoff`, `/api/ai/workspace`. Đặt `AI_API_URL`,
`AI_MODEL`, `AI_API_KEY`, `AI_TIMEOUT_MS` trong môi trường backend. LM Studio dùng
`http://localhost:1234/v1`, model `qwen3-4b-instruct-2507`, có thể để khóa trống
trên localhost. Adapter dùng `json_schema`, tối đa 600 token và một lần thử lại
khi JSON sai. Sau `npx nest build` trong backend, chạy live check từ frontend:
`node scripts/check-llm-live.mjs` với các biến LLM đã đặt; script dùng NestJS LLM
service và guard với dữ liệu BĐS giả lập công khai, không ghi dữ liệu khách hàng.
M07 APIs run in `backend/src/modules/campaigns/` at `/api/admin/campaigns/**`
and `POST /api/system/campaigns/tick` (Bearer `CRON_SECRET`). Apply
`supabase/campaign-scheduler.sql` after `campaign-management.sql`. Tick adds
internal change metadata; the HTTP response stays `{item:{jobs_created}}`.
BullMQ queue `campaigns` uses fixed scheduler ID `campaign-tick` every 60 seconds.
`CAMPAIGNS_QUEUE_NAME` optionally isolates queues in test/development environments.
Redis is optional; manual ticks keep working without it. The Admin endpoint
`GET /api/admin/campaigns/scheduler` returns `{redis,repeatEvery,lastRunAt,lastResult,lastError}`
for the current process. Operations displays scheduler status; Monitoring uses
`campaign.progress` over the authenticated gateway and polls every 60 seconds.
Admin authorization is rechecked before each socket notification. Telephony
readiness is shared at `backend/src/common/telephony.ts`; configure TELEPHONY
variables and CRON_SECRET in the backend environment.

Socket.IO dùng cùng origin qua rewrite; chỉ đặt `NEXT_PUBLIC_API_URL` nếu cần
endpoint realtime riêng.

Mở hai terminal:

```sh
cd backend
npm run start:dev
```

```sh
cd frontend
npm run dev
```

Truy cập `http://localhost:3000`. Backend mặc định cổng 3001, có thể đổi qua
`BACKEND_PORT` hoặc `PORT`. `FRONTEND_URL` là danh sách origin web phân cách bằng
dấu phẩy, dùng kiểm tra yêu cầu thay đổi dữ liệu. `TRUSTED_PROXY_IPS` chỉ chứa
địa chỉ IP nguồn của proxy tin cậy; backend lấy IP cuối cùng trong
`X-Forwarded-For` khi proxy nằm trong danh sách này. Cookie luôn HttpOnly,
SameSite=Lax và dùng Secure trong môi trường production.

Redis là tùy chọn (`REDIS_HOST`, `REDIS_PORT`). Nếu Redis không hoạt động khi khởi
động, ứng dụng cảnh báo một lần, tắt hàng đợi và vẫn phục vụ API.
`GET /api/health` trả `{ok, supabase, redis}`; `supabase` cho biết cấu hình đã sẵn
sàng, `redis` cho biết hàng đợi đã bật. Khởi động lại backend sau khi bật Redis.

Có thể chạy `docker compose up --build` ở thư mục gốc sau khi tạo `backend/.env`.
Compose chạy Redis, backend và frontend; chỉ công bố cổng web 3000. Cấu hình
`FRONTEND_URL` nếu dùng tên miền khác. Các image chạy bằng người dùng không phải
root, khóa chỉ truyền vào lúc chạy qua env. Dùng HTTPS trong môi trường production.

Kiểm thử HTTP: trong `frontend/`, chạy lần lượt `node scripts/test-auth.mjs`,
`node scripts/test-catalog.mjs`, `node scripts/test-discovery.mjs`. Mỗi suite build
NestJS và Next.js, chạy provider giả cùng hai server rồi dừng trong `finally`.
Không chạy đồng thời vì các suite sử dụng chung thư mục build.

Chạy thêm `node scripts/test-proxy-runtime.mjs` để kiểm tra một bản build có thể
chạy với địa chỉ backend khác lúc build, dùng cả `next start` và server standalone.

M08 runs in `backend/src/modules/calling/`. All `/api/calls/**`,
`/api/admin/calls/**`, `/api/contacts/opt-out`, `/api/system/calls/**` and
`/api/webhooks/telephony` requests go to NestJS. Webhook HMAC verification uses
unparsed request bytes. The local simulator remains at
`node frontend/scripts/telephony-simulator.mjs`; it never places a real call.
Apply `supabase/browser-voice.sql` after `automated-calling.sql`.
BullMQ queue `calls` registers `calls-dispatch` every 10 seconds and
`calls-reconcile` every 60 seconds. `CALLS_QUEUE_NAME` isolates environments;
concurrency defaults to 2 and is capped at 2 by both the worker and database.
SQL plus the M07 tick schedule retries. Redis is optional; HTTP dispatch and
reconcile remain manual triggers authenticated by `CRON_SECRET`.
`GET /api/admin/calls/worker` exposes process worker status to Admin.
`call.status` rechecks current call RLS and sends to Admin or assigned Sales.

On `/admin/calls/playground`, choose Giọng nói and a Published script to open
an authenticated `/voice` Socket.IO session. Browser SpeechRecognition uses
vi-VN and speechSynthesis speaks server replies. Interim speech cancels output
immediately; silence after 10 seconds reprompts twice, then ends. Browser
simulations persist as MOCK_CALL with simulator provider and no dialled phone:
they count as active, have no contact cap attempts or provider costs, and store
transcript only after independent consent. Consent answers are simulation
evidence in call_events; they never alter a real contact's consent or suppression.
Microphone permission failures and unsupported browsers return to text mode.
Audio is not uploaded; recording availability stays NotConsented.

Additional checks from frontend with PGLITE_PATH set:
`node scripts/test-browser-voice.mjs`, `node scripts/test-browser-voice-ui.mjs`,
and optional `node scripts/test-browser-voice.mjs --live` with AI_API_URL and
AI_MODEL for LM Studio. The live mode runs through the namespace and prints
turn latency. Backend vitest covers raw signatures, calling permissions,
realtime isolation, voice turns and disposable real Redis queues.
