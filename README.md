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
M06–M07 API được chuyển tiếp tới NestJS. Các trang server cũng gọi NestJS để đọc phiên.
M08 tạm thời vẫn chạy trong Next.js qua `lib/next-api-bridge.ts`; bridge lấy
phiên đã xác minh từ NestJS, đồng bộ cookie refresh rồi tạo client theo token đó.
Khi chạy frontend ngoài Compose, truyền cấu hình Supabase, telephony và cron từ
`backend/.env` vào môi trường server của frontend cho đến khi M08 được chuyển.
Compose truyền cấu hình này lúc chạy; không đưa khóa vào `NEXT_PUBLIC_*`.

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
