# Laila Motion Studio

App macOS để dựng video motion graphic bằng Claude: anh đưa brand elements vào (logo, màu, font, text, ghi chú tone), Claude viết từng clip motion graphic, app render ra MP4, rồi anh cắt/ghép trên timeline kiểu CapCut và xuất ra một video tổng.

## Luồng làm việc

| Bước | Ở đâu | Làm gì |
|---|---|---|
| 1. Brand kit | Cột trái, tab **Brand elements** | Thêm Text, Màu, Ảnh/Logo, Font (font đã cài trên Mac), Ghi chú brand. Claude gọi element theo **tên**, nên đặt tên ngắn: `logo`, `headline`, `primary`. |
| 2. Storyboard | Giữa, ô **Storyboard với Claude** | Viết brief cho video tổng, chọn số scene + tổng thời lượng, bấm **Chia thành scene**. Claude tạo sẵn các scene card với prompt riêng. Hoặc tự thêm **Scene trống**. |
| 3. Generate | Scene card | **Generate** từng card hoặc **Generate tất cả** (chạy song song 3 request). Mỗi card chọn được element nào được dùng. |
| 4. Sửa | Scene card | Ô **Sửa nhanh** (vd "chữ to hơn, nền trắng") gửi code hiện tại + yêu cầu cho Claude. Nút **Code** mở trình sửa có preview trực tiếp, sửa tay rồi **Render lại**. Mỗi lần ra một phiên bản mới (v1, v2…), bản cũ vẫn nằm trong Media. |
| 5. Ghép | Timeline dưới cùng | **Đưa lên timeline** theo thứ tự board, hoặc kéo từ Media. Import thêm video quay thật và nhạc nền. |
| 6. Xuất | **Xuất video** góc phải trên | MP4 H.264 + AAC, chọn Chất lượng cao hoặc Nháp. |

### Timeline (giống CapCut)

| Thao tác | Cách làm |
|---|---|
| Phát / dừng | `Space` |
| Cắt clip tại playhead | `S` hoặc `⌘B`, nút ✂ Cắt |
| Trim | Kéo mép trái/phải của clip |
| Đổi thứ tự | Kéo clip thả vào vị trí mới |
| Xoá / nhân bản | `Delete` / `⌘D` |
| Undo / Redo | `⌘Z` / `⇧⌘Z` |
| Tua từng frame | `←` `→` (giữ `Shift` để nhảy 1s) |
| Âm lượng clip / nhạc | Thanh vol khi chọn clip, thanh trên track nhạc |

Generate lại một scene đang nằm trên timeline thì clip trên timeline tự đổi sang bản mới.

## Cài và chạy trên Mac

Cần Node.js 20+ (`brew install node`).

```bash
git clone <repo> laila && cd laila
npm install
npm run dev          # chạy thử ở chế độ dev
npm run dist:mac     # đóng gói ra release/Laila Motion Studio-<version>.dmg
```

Mở file `.dmg`, kéo app vào Applications. Bản build chưa ký Apple Developer ID, nên lần đầu mở: chuột phải vào app → **Open** → **Open**.

Lần đầu mở app sẽ hiện Settings để nhập **Claude API key** (lấy ở console.anthropic.com). Key được mã hoá bằng macOS Keychain qua `safeStorage`, không lưu dạng chữ thường. Có thể dùng biến môi trường `ANTHROPIC_API_KEY` thay thế.

Lưu ý build: `ffmpeg-static` tải ffmpeg đúng kiến trúc của máy chạy `npm install`. Build trên Mac Apple Silicon ra bản arm64, trên Mac Intel ra bản x64.

## Kiến trúc

```
electron/main.ts      Main process: cửa sổ, IPC, giao thức media:// (hỗ trợ tua video), lưu settings/project
electron/claude.ts    Gọi Claude API (@anthropic-ai/sdk), structured output JSON, system prompt hợp đồng code
electron/ffmpeg.ts    Encode frame PNG -> MP4, probe file, dựng lệnh xuất video tổng (trim, scale, concat, trộn nhạc)
electron/preload.ts   API an toàn cho renderer (contextIsolation)
src/public/sandbox.html  Iframe sandbox chạy code Claude viết: không mạng, không Node, không Math.random/Date
src/lib/pipeline.ts   Claude -> chạy thử -> tự sửa lỗi (tối đa 2 lần) -> render -> media bin
src/lib/timeline.ts   Logic cắt/trim/đổi thứ tự (có unit test)
src/components/       Giao diện React
```

**Vì sao Claude viết code thay vì sinh video trực tiếp:** Claude không sinh pixel video, nhưng viết code animation rất tốt. Mỗi scene là một hàm `render(ctx, t, api)` vẽ lên canvas theo thời gian. App vẽ từng frame trong sandbox rồi đẩy vào ffmpeg. Cách này cho ra motion sắc nét ở mọi độ phân giải, sửa được bằng lời hoặc bằng tay, và render lại không tốn thêm token.

Model mặc định là Claude Opus 5.5, đổi được trong Settings (Fable 5.1, Sonnet 5.5, Haiku 5.5). Request bật `fallbacks: "default"`, nên nếu bộ lọc an toàn từ chối nhầm thì API tự chạy lại trên model dự phòng.

## Test

```bash
npm test          # unit test logic timeline
npm run test:e2e  # chạy app thật, giả lập Claude API bằng server cục bộ:
                  # storyboard -> generate (gồm 1 vòng tự sửa lỗi) -> render -> cắt -> xuất
```

## Giới hạn hiện tại và hướng làm tiếp

| Hiện tại | Hướng tiếp |
|---|---|
| Một track video chính (kiểu magnetic) + một track nhạc | Thêm track overlay (text, sticker, logo đè lên video quay) |
| Chuyển cảnh là cut thẳng | Crossfade/transition giữa clip (ffmpeg `xfade`) |
| Font: dùng font đã cài trên Mac | Nạp file font .otf/.ttf vào brand kit |
| Preview timeline đổi `src` video khi qua clip, có thể chớp nhẹ ở điểm cắt | Dùng 2 thẻ video luân phiên, preload clip kế tiếp |
| Không có thumbnail filmstrip trên timeline | Sinh thumbnail bằng ffmpeg |
| Chưa ký/notarize app | Ký bằng Apple Developer ID để mở không cần cảnh báo |
