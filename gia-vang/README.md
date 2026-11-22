# Giá Vàng 999

App cho iPhone theo dõi giá vàng 999.9 thế giới và trong nước: biểu đồ, lý do tăng giảm kèm nguồn tin, thông báo khi giá biến động.

## Vì sao là web app (PWA) chứ không phải app App Store

| | PWA (đang dùng) | App iOS gốc (Swift) |
|---|---|---|
| Cài lên iPhone | Safari → Chia sẻ → Thêm vào MH chính | Cần máy Mac, Xcode, tài khoản Apple Developer 99 USD/năm |
| Cập nhật | Tự động | Phải build và cài lại |
| Thông báo | Qua app **ntfy** (miễn phí) | Push gốc của Apple |
| Chi phí | 0 đồng (GitHub Actions + Pages) | 99 USD/năm + máy chủ |

## Cách hoạt động

```
GitHub Actions (mỗi 30 phút)
  ├─ Lấy giá: gold-api.com, Vietcombank, SJC, BTMC, DOJI, Mi Hồng
  ├─ Lấy chỉ số liên quan: USD (DXY), lợi suất Mỹ 10 năm, dầu, S&P 500 (Yahoo Finance)
  ├─ Lấy tin: Google News, chỉ giữ báo uy tín
  ├─ Phân tích lý do: Claude (nếu có khoá API) hoặc quy tắc cố định
  ├─ Gửi thông báo qua ntfy khi vượt ngưỡng + bản tin mỗi sáng 8h
  ├─ Lưu lịch sử vào nhánh gia-vang-data
  └─ Đăng app lên GitHub Pages
```

## Cài đặt (làm 1 lần)

1. Gộp nhánh này vào nhánh mặc định của repo. Lịch chạy 30 phút của GitHub chỉ hoạt động trên nhánh mặc định.
2. **Settings → Pages → Source: GitHub Actions.** Nếu repo private, GitHub Pages cần gói trả phí; nếu không, để repo public.
3. **Settings → Secrets and variables → Actions → New repository secret**:
   - `NTFY_TOPIC`: tên kênh khó đoán, ví dụ `giavang-a7f3k9q2`. Ai biết tên kênh đều đọc được thông báo, nên đừng đặt dễ đoán.
   - `ANTHROPIC_API_KEY` (tuỳ chọn): để Claude viết phần "Vì sao tăng giảm" dễ hiểu, có trích nguồn. Không có thì app dùng phân tích theo quy tắc.
4. Vào tab **Actions → Giá vàng → Run workflow** để chạy lần đầu.
5. Trên iPhone, cài app bằng 1 trong 2 cách:
   - **File cài:** mở `https://<tên-github>.github.io/<tên-repo>/GiaVang.mobileconfig` bằng Safari → Cho phép → Cài đặt → Đã tải về hồ sơ → Cài đặt. Biểu tượng Giá Vàng hiện trên màn hình chính.
   - **Thủ công:** mở `https://<tên-github>.github.io/<tên-repo>/` bằng Safari → Chia sẻ → Thêm vào MH chính.
6. Cài app **ntfy** trên App Store → bấm + → nhập đúng tên kênh ở bước 3.

## Nguồn dữ liệu và độ tin cậy

| Thương hiệu | Cách lấy | Ghi chú |
|---|---|---|
| SJC | API của sjc.com.vn | Có nạp lịch sử 6 tháng |
| Bảo Tín Minh Châu | API công khai btmc.vn | Lịch sử tích luỹ từ ngày chạy |
| DOJI | API công khai giavang.doji.vn | Lịch sử tích luỹ từ ngày chạy |
| Mi Hồng | Đọc bảng giá trên mihong.vn | Trang web đổi giao diện thì có thể hỏng |
| Huy Thanh | Nhập tay trong app | Chưa có trang giá công khai |
| Hanno Jewels | Nhập tay trong app | Chưa có trang giá công khai |

Nếu tìm được trang có bảng giá của Huy Thanh hoặc Hanno, sửa `scripts/sources.json`: đổi `"mode": "manual"` thành `"html"` và điền `url`.

Khi một nguồn lỗi tạm thời, app giữ giá lần trước và gắn nhãn "giá cũ".

## Chỉnh ngưỡng thông báo

`scripts/sources.json` → `notify`:
- `worldPct`: báo khi vàng thế giới chạy quá bao nhiêu % kể từ lần báo trước (mặc định 0,8).
- `vndPerLuong`: báo khi giá bán SJC đổi quá bao nhiêu đồng/lượng (mặc định 500.000).
- `dailySummaryHourVN`: giờ gửi bản tin sáng (mặc định 8).

## Chạy thử trên máy

```bash
cd gia-vang
npm install
npm test
node scripts/fetch.mjs   # tạo web/data/*.json
npm run serve            # mở http://localhost:4173
```
