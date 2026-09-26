# Phân quyền người quản lý theo sự kiện — thiết kế

Ngày: 2026-09-25 · Dự án: `vpu-checkin` (VPU Điểm Danh)

## 1. Mục tiêu

Hiện nay mọi người quản lý (`manager`) đọc, sửa, xoá được mọi sự kiện, danh sách mời và kết quả điểm danh. Thay đổi:

1. Người quản lý **sửa được sự kiện do chính mình tạo**, và chỉ **trước giờ bắt đầu** sự kiện.
2. Với sự kiện do người quản lý khác tạo, người quản lý **chỉ thấy sự kiện và tự điểm danh** (nếu email có trong danh sách mời), **không xoá, không sửa, không xem danh sách mời / danh sách có mặt / mã QR**.
3. **Quản trị viên** (`admin`) có quyền cao nhất: thêm, sửa, xoá người quản lý; thêm, sửa, xoá mọi sự kiện điểm danh vào bất kỳ lúc nào.

Quyết định đã chốt với người dùng:

- Người quản lý **xoá được** sự kiện do mình tạo (giữ hành vi hiện tại; chỉ bỏ quyền xoá sự kiện của người khác).
- Sau giờ bắt đầu, người tạo **vẫn chỉnh được** hai nút nhanh "Nhận điểm danh trong…" (`window`) và "Sai số GPS" (`tolerance`). Mọi trường khác bị khoá.
- Sự kiện của người quản lý khác **chỉ hiện ở tab Điểm danh** (như người tham dự); tab Quản lý chỉ liệt kê sự kiện của mình.

Nguyên tắc nền: `server/authorize.js` là lớp bắt buộc thực thi quyền (đúng khi gọi API trực tiếp bằng curl hay client đã sửa); giao diện chỉ phản ánh lại.

## 2. Ma trận quyền

| Hành động | Quản trị viên | Quản lý – người tạo | Quản lý – sự kiện của người khác |
|---|---|---|---|
| Tạo sự kiện (`createdBy` = email mình) | ✓ | ✓ | – |
| Xem danh sách mời, có mặt, QR (tab Quản lý) | mọi sự kiện | sự kiện của mình | ✗ |
| Xem sự kiện và tự điểm danh (tab Điểm danh) | ✓ | ✓ | ✓ nếu email có trong danh sách mời |
| Sửa toàn bộ (tên, phòng, giờ, vị trí, danh sách mời) | mọi lúc | chỉ trước giờ bắt đầu | ✗ |
| Chỉnh `window` và `tolerance` | mọi lúc | mọi lúc | ✗ |
| Xoá sự kiện | mọi lúc | mọi lúc, sự kiện của mình | ✗ |
| Thêm, sửa, xoá người quản lý (`config/roles`) | ✓ | ✗ | ✗ |

Định nghĩa dùng chung:

- **Chủ sự kiện**: `normalizeEmail(event.createdBy) === normalizeEmail(session.email)`. Sự kiện cũ không có `createdBy` (null) thì không ai là chủ; chỉ Quản trị viên sửa hoặc xoá được.
- **Trước giờ bắt đầu**: `Date.now() < Date.parse(event.start)`, tính theo đồng hồ máy chủ, dùng `start` **đã lưu** trước lần sửa.

## 3. Máy chủ

### 3.1 `server/authorize.js`

Chữ ký mở rộng: `authorize({ method, path, session, rolesDoc, bootstrapAdminEmail, body, loadDoc, now = Date.now() })`.

- `body`: nội dung request (PUT/PATCH).
- `loadDoc(path)`: trả về `data` của tài liệu hoặc `null`, do `routes.js` truyền vào (bọc `getDoc`). Nhờ đó `authorize` kiểm thử được mà không cần DB.

Quy tắc theo đường dẫn:

**`events/<id>`** (đường dẫn sâu hơn `events/<id>/…`: chỉ Quản trị viên được ghi)
- GET: đã đăng nhập (giữ nguyên).
- PUT, tài liệu chưa tồn tại (tạo mới): phải là người quản lý; `normalizeEmail(body.createdBy) === email` của người gọi.
- PUT, tài liệu đã tồn tại: Quản trị viên được; người tạo được nếu trước giờ bắt đầu **và** `body.createdBy` bằng `createdBy` đã lưu.
- PATCH: Quản trị viên được. Người tạo: trước giờ bắt đầu thì được mọi khoá trừ `createdBy`; sau giờ bắt đầu chỉ được khi mọi khoá của `body` thuộc `{window, tolerance}`. Người khác: không.
- DELETE: Quản trị viên hoặc người tạo.

**`roster/<id>`** (danh sách mời dạng văn bản thường)
- Đọc: Quản trị viên hoặc chủ của `events/<id>`. Nếu sự kiện chưa tồn tại: chỉ Quản trị viên.
- Ghi (PUT/DELETE): Quản trị viên; chủ sự kiện nếu trước giờ bắt đầu; **nếu sự kiện chưa tồn tại thì mọi người quản lý được ghi**. Ngoại lệ này cần vì `EventForm` ghi roster trước rồi mới ghi `events`; id sự kiện là chuỗi ngẫu nhiên nên không đoán trước được, và người tạo sự kiện sau đó ghi đè roster của chính mình.

**`att`** (điểm danh; mỗi tài liệu là một người, `records` chứa nhiều sự kiện)
- `GET att` (danh sách): người quản lý; `routes.js` lọc kết quả (xem 3.2).
- `GET att/<key>`: chủ khoá (`att/${attKeyOf(hash(email))}`) hoặc Quản trị viên. Người quản lý thường đọc khoá của người khác: **403** (giao diện không bao giờ làm việc này).
- Ghi (PUT/PATCH/DELETE) `att/<key>`: chủ khoá hoặc Quản trị viên. Người quản lý thường không ghi được tài liệu của người khác.

**Đường dẫn trần** `events` và `att` (không có id): chỉ nhận GET; mọi thao tác ghi bị từ chối (hiện người quản lý ghi được vào đó).

**Không đổi**: `config/roles` (ghi: chỉ Quản trị viên), `config/app` (ghi: người quản lý), còn lại từ chối.

### 3.2 `server/routes.js`, `server/db.js`

- `guard` truyền thêm `body` và `loadDoc`.
- **Lọc `att` cho người quản lý thường** (không phải Quản trị viên): sau khi `GET att` được phép, lấy các sự kiện có `createdBy` là mình, giữ lại trong mỗi tài liệu chỉ các `records[<eventId>]` thuộc những sự kiện đó. Hàm lọc thuần `filterAttRecords(docs, ownedEventIds)` đặt trong `authorize.js` để kiểm thử được. Quản trị viên nhận nguyên bản.
- **Xoá dây chuyền phía máy chủ**: sau khi `DELETE events/<id>` được phép, máy chủ xoá `events/<id>`, `roster/<id>` và gỡ `records.<id>` khỏi mọi `att/*` trong **một transaction**. Thêm `deleteEventCascade(id)` vào `db.js`; phần gỡ record dùng `data #- '{records,<id>}'` với điều kiện `data->'records' ? <id>`.

Lý do chuyển xoá dây chuyền sang máy chủ: vòng lặp hiện ở client (`AdminView.remove`) ghi vào `att/<người khác>`, sẽ bị 403 với người quản lý thường theo quy tắc mới.

## 4. Giao diện

### 4.1 `src/lib/auth.ts`
Thêm các hàm thuần, là nguồn duy nhất cho giao diện (bản sao của quy tắc ở 3.1, giống cách `roles.js` phản chiếu `resolveSession`; giữ đồng bộ hai bên):
- `isEventOwner(ev, session)`
- `canEditEvent(ev, session, now)`: Quản trị viên, hoặc chủ sự kiện và `now < start`.
- ~~`canTweakEvent`, `canDeleteEvent`~~ **Không thêm** (đã điều chỉnh khi triển khai): tab Quản lý chỉ liệt kê sự kiện của mình (hoặc tất cả với quản trị viên), nên hai hàm này luôn đúng ở đó. Máy chủ vẫn chặn đủ.

### 4.2 `AdminView.tsx`
- Danh sách sự kiện: Quản trị viên thấy tất cả, người quản lý thường chỉ thấy sự kiện của mình. Bộ đếm "Sự kiện · N" đếm theo danh sách đã lọc.
- `EventDetail`: nút **Sửa sự kiện** (mở hộp thoại `EventForm` chế độ sửa) hiện khi `canEditEvent`. Khi bị khoá vì đã bắt đầu, hiện dòng giải thích: "Sự kiện đã bắt đầu nên không sửa được nội dung. Bạn vẫn chỉnh được thời gian nhận điểm danh và sai số GPS." Hai nút nhanh và nút Xoá luôn hiện cho mọi sự kiện có trong danh sách (xem ghi chú ở mục 4.1).
- Nút **Sửa sự kiện** vô hiệu hoá khi `roster === null` (chưa tải xong danh sách mời).
- `remove()`: chỉ gọi `events/<id>.delete()`; máy chủ lo phần dây chuyền. Vòng lặp dọn `att` phía client **bị bỏ hẳn**: nó chưa từng xoá được gì vì `update()` gộp sâu nên khoá bị xoá vẫn còn. Riêng việc xoá `roster/<id>` vẫn được giữ (không điều kiện) vì chế độ demo và môi trường claude.ai không có máy chủ để xoá dây chuyền; trên máy chủ thật lệnh này vô hại.

### 4.3 `EventForm.tsx`
Thêm prop tuỳ chọn `initial?: { event: EventRow; roster: RosterDoc }`.
- Có `initial`: điền sẵn mọi trường (danh sách email lấy từ `roster.emails`), tiêu đề nút "Lưu thay đổi", `onCreated` đổi tên thành `onSaved`.
- Kiểm tra "giờ bắt đầu không được sớm hơn thời điểm tạo" chỉ áp dụng khi giờ bắt đầu **bị đổi** so với giá trị đã lưu (nếu không, Quản trị viên sửa sự kiện đã bắt đầu sẽ luôn bị chặn).
- Khi lưu: tính lại `emailHashes`, `uids`, `unresolved`, `invited`; giữ nguyên `id`, `createdAt`, `createdBy`; ghi `roster/<id>` rồi `events/<id>` (PUT). Thông báo thành công nhắc: ảnh QR đã gửi trước đó vẫn ghi thông tin cũ nếu đổi giờ hoặc phòng, hãy xuất và gửi lại (liên kết QR không đổi vì `id` giữ nguyên).
- Chế độ tạo mới giữ nguyên hành vi và thứ tự ghi hiện tại.

### 4.4 `ManagersView.tsx`
- Mỗi dòng có nút **Sửa**: nạp dòng đó vào form (ô email khoá), cho đổi họ tên và vai trò; nút "Lưu thay đổi" và "Huỷ sửa". Khi lưu giữ nguyên `addedAt`, `addedBy`. Cho phép lưu khi chỉ đổi họ tên (hiện form từ chối vì "đã là …").
- Luồng thêm mới và "Thu hồi" giữ nguyên.

### 4.5 `CheckinView.tsx`
Không đổi. Người quản lý đã tự điểm danh như người tham dự (đối chiếu bằng băm email).

## 5. Xử lý lỗi

- Máy chủ trả **403** cho mọi vi phạm. Giao diện đã hiển thị lỗi ghi qua `Notice`; thêm thông điệp riêng cho các trường hợp thường gặp: sự kiện đã bắt đầu (sửa toàn bộ), không phải chủ sự kiện.
- Đồng hồ lệch giữa client và máy chủ: máy chủ quyết định. Nếu client thấy "chưa bắt đầu" nhưng máy chủ từ chối, giao diện hiện lỗi và danh sách tự đồng bộ ở lần thăm dò kế tiếp.
- Tạo sự kiện với `start` trong vòng phút hiện tại: `PUT events` là tạo mới nên không bị kiểm tra "trước giờ bắt đầu"; đây là lý do roster cần ngoại lệ ghi khi sự kiện chưa tồn tại (mục 3.1).

## 6. Kiểm thử và xác minh

1. `server/authorize.test.js` dùng `node:test` có sẵn (không thêm thư viện), thêm script `"test": "node --test server/"` vào `package.json`. Bao phủ:
   - Tạo: `createdBy` đúng/sai email; người tham dự không tạo được.
   - PUT/PATCH/DELETE `events`: chủ trước và sau giờ bắt đầu; `PATCH` chỉ `window`/`tolerance` sau giờ bắt đầu; người quản lý khác; Quản trị viên mọi lúc; sự kiện không có `createdBy`; không được đổi `createdBy`.
   - `roster`: chủ, người khác, Quản trị viên, sự kiện chưa tồn tại.
   - `att`: khoá của mình, khoá người khác, Quản trị viên; người quản lý ghi vào khoá người khác bị chặn.
   - `filterAttRecords`.
2. `npm run build` (gồm `tsc -b`) và `npm run lint` sạch.
3. Giao diện ở chế độ demo trong trình duyệt tích hợp: đăng nhập `lan.nt@tbd.edu.vn` (quản lý) và `son.pt@tbd.edu.vn` (quản trị) để kiểm tra danh sách lọc, nút Sửa, khoá sau giờ bắt đầu, xoá; đăng nhập quản trị để thử Sửa người quản lý.
4. Nếu máy có Docker: chạy Postgres và kiểm tra `deleteEventCascade` bằng SQL thật. Nếu không, ghi rõ phần này chưa được kiểm tra tích hợp.

## 7. Ngoài phạm vi (chỉ ghi nhận)

- Máy chủ chưa kiểm tra nội dung điểm danh (giờ, vị trí, có trong danh sách mời hay không); người dùng đã đăng nhập có thể gửi bản ghi giả cho chính khoá của mình qua API.
- `config/app` (URL gốc của mã QR) vẫn cho mọi người quản lý ghi, ảnh hưởng mọi sự kiện.
- Quản trị viên khởi tạo từ `BOOTSTRAP_ADMIN_EMAIL` luôn là admin ở máy chủ dù bị đổi vai trò trong `config/roles`, và giao diện không biết điều này.
- Người tạo có thể xoá rồi tạo lại sự kiện cùng id để đổi nội dung sau giờ bắt đầu. Điểm danh của sự kiện bị xoá theo (xoá dây chuyền) nên chấp nhận được.
- Sự kiện cũ không có `createdBy` (null) chỉ quản trị viên thấy trong tab Quản lý, sửa hoặc xoá được; người quản lý thường không còn thấy chúng ở tab đó. Trước khi triển khai nên kiểm tra: `SELECT path FROM documents WHERE path LIKE 'events/%' AND (data->>'createdBy') IS NULL;`
- **Dọn dữ liệu cũ khi triển khai (chạy một lần, sau khi sao lưu).** Vòng lặp xoá ở client trước đây không xoá được bản ghi điểm danh, nên có thể còn điểm danh và roster "mồ côi" của các sự kiện đã xoá. Người quản lý có thể tạo sự kiện mới trùng id cũ để xem lại chúng. Hai câu lệnh sau đã được chạy thử trên Postgres 15 với dữ liệu mẫu (kể cả bản ghi `records` dạng mảng, bản ghi lồng và roster vừa tạo):
  ```sql
  UPDATE documents a
  SET data = jsonb_set(a.data, '{records}', COALESCE((
        SELECT jsonb_object_agg(r.k, r.v) FROM jsonb_each(a.data->'records') AS r(k, v)
        WHERE EXISTS (SELECT 1 FROM documents e WHERE e.path = 'events/' || r.k)), '{}'::jsonb)),
      updated_at = now()
  WHERE a.path LIKE 'att/%' AND a.path NOT LIKE 'att/%/%'
    AND jsonb_typeof(a.data->'records') = 'object'
    AND EXISTS (SELECT 1 FROM jsonb_object_keys(a.data->'records') AS k
                WHERE NOT EXISTS (SELECT 1 FROM documents e WHERE e.path = 'events/' || k));

  DELETE FROM documents r
  WHERE r.path LIKE 'roster/%' AND r.path NOT LIKE 'roster/%/%'
    AND NOT EXISTS (SELECT 1 FROM documents e WHERE e.path = 'events/' || substr(r.path, 8))
    AND r.updated_at < now() - interval '1 hour';
  ```
- `window` và `tolerance` chưa được kiểm tra kiểu giá trị (một giá trị không phải số làm giờ đóng điểm danh không tính được). Đã có từ trước, chỉ áp dụng cho sự kiện của chính người gửi.
- Đã có từ trước: một lỗi trong handler async của Express 4 làm sập tiến trình Node (ví dụ `PUT /doc/att/<khoá của mình>` với thân là mảng JSON cấp cao nhất).
- Quản trị viên tự hạ vai trò của chính mình bằng nút Sửa không cần xác nhận (nút thu hồi của chính mình có nhãn riêng "Bỏ quyền của tôi").
- Form sửa lưu `roster` trước rồi mới lưu sự kiện; nếu giờ bắt đầu trôi qua đúng giữa hai lần ghi thì roster mới đi cùng sự kiện cũ (khoảng thời gian rất hẹp).
- Danh sách sự kiện làm mới ~3 giây một lần: mở lại form sửa ngay sau khi lưu có thể hiện dữ liệu cũ, và lưu tiếp sẽ ghi đè bằng dữ liệu cũ đó.
- Quản trị viên không đổi được giờ bắt đầu của sự kiện đã bắt đầu sang một giờ khác trong quá khứ (chỉ được giữ nguyên hoặc đặt sang tương lai).
- Form sửa gửi PUT đầy đủ chỉ với các trường của `EventDoc`. `server/reports.js` ghi thêm `reportSentAt` / `reportAttemptAt` vào sự kiện; nếu bộ lập lịch báo cáo được bật sau này, quản trị viên sửa một sự kiện đã kết thúc sẽ xoá các trường đó và báo cáo có thể bị gửi lại. Hiện `server/index.js` chưa khởi động bộ lập lịch nên chưa xảy ra; khi bật cần cho form giữ lại các trường lạ của `ev0`.
- Giới hạn quy mô: danh sách điểm danh của người quản lý được dựng từ tối đa 2000 bản ghi `att` và 2000 sự kiện đầu tiên theo thứ tự đường dẫn; vượt mức đó người quản lý thường sẽ thiếu bản ghi (trước đây client đã giới hạn 1000 cho mọi người, nên không tệ hơn).
- Các mục tab Quản lý của bản demo: `seedDemo` tạo mọi sự kiện mẫu dưới email quản trị, nên đăng nhập `lan.nt@…` sẽ thấy tab Quản lý trống cho tới khi tự tạo sự kiện (đúng theo quy tắc mới).
- Thư mục dự án đã trở thành git repo (gắn với `origin` trên GitHub) trong lúc thực hiện; các thay đổi của tính năng này chưa được commit.
