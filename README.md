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
địa chỉ backend cho mỗi yêu cầu, không cần build lại khi đổi địa chỉ. Frontend chỉ
phục vụ giao diện, API và xác minh cookie được chuyển tiếp tới NestJS. Các trang
server cũng gọi NestJS để đọc phiên.
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
