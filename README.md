# CC Motion Editor

Phát triển bởi **Chợ Chời Creative Studio**.

App macOS để dựng motion graphic bằng Claude: anh đưa brand elements vào (logo, màu, font, text, ghi chú tone), Claude dựng từng clip thành các layer có keyframe, anh chỉnh tiếp trong Motion Editor kiểu After Effects, rồi cắt ghép trên timeline kiểu CapCut và xuất ra một video tổng.

## Luồng làm việc

| Bước | Ở đâu | Làm gì |
|---|---|---|
| 1. Brand kit | Cột trái, tab **Brand kit** | Thêm Chữ, Màu, Ảnh/Logo, Font (font đã cài trên Mac), Ghi chú về tone. Claude gọi element theo **tên**, nên đặt tên ngắn: `logo`, `headline`, `primary`. |
| 2. Kịch bản | Giữa, ô **Lên kịch bản với Claude** | Viết brief cho video tổng, chọn số scene và tổng thời lượng, bấm **Chia thành scene**. Hoặc bấm **Scene mới** để tự viết prompt. |
| 3. Generate | Scene card | **Generate** từng card hoặc **Generate tất cả** (3 request song song). Claude dựng scene thành các **layer có keyframe**, không phải video "đóng hộp". |
| 4. Chỉnh kiểu After Effects | Nút **Chỉnh sửa** trên card | Mở **Motion Editor** (xem bảng dưới). Chỉnh tay, hoặc gõ yêu cầu vào ô **Nhờ Claude sửa**. Thay đổi của Claude cũng hoàn tác được. |
| 5. Render | **Xong & Render** | Ra bản clip mới (v2, v3…). Clip trên timeline tự đổi sang bản mới. |
| 6. Ghép kiểu CapCut | Timeline dưới cùng | Tách, cắt trái/phải, trim, tốc độ, chuyển cảnh, âm lượng, nhạc nền, nhập video quay thật. |
| 7. Xuất | **Xuất video** | MP4 H.264 + AAC; chọn kích thước (50% / gốc / 200%), fps, chất lượng. |

## Motion Editor (lấy cảm hứng từ After Effects)

Em chọn các cửa sổ mà dân làm motion trên After Effects dùng nhiều nhất cho việc làm chữ và hình xuất hiện: text animator với range selector, Easy Ease, Graph Editor, và kiểu chỉnh đường cong preset như plugin Flow.

| Cửa sổ | Tương đương trong AE | Làm được gì |
|---|---|---|
| Khung hình (Viewer) | Composition panel | Bấm chọn layer, kéo để di chuyển, kéo góc để scale, kéo chấm tròn phía trên để xoay (giữ Shift: bước 15°). Hít vào tâm/mép khung, lưới 1/3, vùng an toàn Title/Action safe. |
| Thanh công cụ | Tools | Chọn (V), Chữ (T), Hình chữ nhật / elip / đường (Q), thêm ảnh từ brand kit, layer code. |
| Timeline layer | Timeline panel | Thanh layer (kéo để dời, kéo mép để đổi in/out), mở từng thuộc tính, keyframe (kéo để dời, Shift để chọn nhiều), U để chỉ hiện thuộc tính có keyframe, kéo hàng để đổi thứ tự layer. |
| Properties | Properties / Effect Controls | Vị trí, tỉ lệ, xoay, độ mờ, blur, mỗi thuộc tính có stopwatch, nút keyframe trước/sau, wiggle. Ô số kéo ngang để chỉnh nhanh (Shift nhanh, Option chậm). Điểm neo 9 ô (giữ nguyên vị trí). Parent, chế độ hoà trộn. |
| Chữ | Character + Paragraph | Font, cỡ, độ đậm, màu, căn lề, giãn dòng, giãn chữ (tracking, keyframe được), khung xuống dòng. |
| Text Animator | Text animator + range selector | Vào/Ra theo ký tự, từ hoặc dòng: mask (trồi lên từ vạch), trượt, fade, blur, phóng, xoay, đánh máy. Chỉnh thời lượng, độ trễ, khoảng cách giữa các phần, thứ tự (đầu, cuối, giữa ra, ngẫu nhiên), ease. |
| Đường cong chuyển động | Graph Editor / plugin Flow | Chọn keyframe để hiện đồ thị cubic-bezier, kéo 2 tay nắm, hoặc chọn preset (Easy Ease, Out Expo, Back, Elastic, Bounce, Hold…). F9 = Easy Ease. |
| Hiệu ứng chuyển động | Effects & Presets | In: Fade, Trượt lên, Pop, Zoom + blur, Blur, Xoay vào, Vẽ nét (Trim Paths). Out: Fade, Trượt xuống, Thu nhỏ, Blur. Loop: Wiggle, Lơ lửng, Nhịp đập. Hiệu ứng tạo keyframe thật, chỉnh tiếp được. |
| Căn chỉnh | Align panel | Căn trái / giữa / phải / trên / giữa dọc / dưới so với khung. |
| Hình | Shape layer + Trim Paths | Chữ nhật bo góc, elip, đường; fill, viền, Trim Paths để vẽ nét. |

Phím tắt trong editor: `Space` phát, `J`/`K` keyframe trước/sau, `F9` Easy Ease, `U` thuộc tính có keyframe, `⌘D` nhân bản layer, `⇧⌘D` tách layer tại playhead, `⌥[` / `⌥]` cắt đầu/cuối layer về playhead, `↑↓` (hoặc `⌘←→`) dịch layer 1px (Shift: 10px), `←→` lùi/tiến 1 frame, `Delete` xoá keyframe đang chọn hoặc layer, `⌘Z` / `⇧⌘Z` hoàn tác / làm lại.

## Timeline (giống CapCut)

| Thao tác | Cách làm |
|---|---|
| Phát / dừng | `Space` |
| Tách clip tại playhead | `S` hoặc `⌘B` |
| Xoá phần bên trái / phải playhead | `Q` / `W` (giống CapCut) |
| Trim | Kéo mép trái/phải của clip |
| Đổi thứ tự | Kéo clip thả vào vị trí mới |
| Tốc độ | Chọn clip → 0.25× đến 4× |
| Chuyển cảnh | Bấm ô nhỏ ở điểm nối giữa 2 clip: mờ dần, hoà tan, qua đen/trắng, đẩy, quét, mở tròn, phóng to; chỉnh thời lượng, áp cho tất cả |
| Âm lượng, fade âm thanh | Chọn clip → thanh âm lượng, ô Fade vào / ra |
| Nhạc nền | Kéo file audio xuống track nhạc, chỉnh âm lượng trên track |
| Xoá / nhân bản | `Delete` / `⌘D` |
| Undo / Redo | `⌘Z` / `⇧⌘Z` |
| Tua từng frame | `←` `→` (Shift: 1 giây) |
| Zoom timeline | `⌘` + cuộn chuột, thanh zoom, nút **Vừa khung** |

Preview dùng 2 trình phát luân phiên nên không bị chớp ở điểm cắt, và xem trước được chuyển cảnh. Chuyển cảnh chồng lên 2 clip giống CapCut, nên thời lượng tổng ngắn lại đúng bằng phần chồng lấn.

## Giao diện

Phong cách macOS: phẳng, không trong suốt, font hệ thống, màu nhấn xanh của Apple. Sáng/tối theo cài đặt của máy, hoặc chọn cố định trong **Cài đặt → Giao diện**. Khung xem video luôn để nền tối để nhìn màu cho chuẩn (giống Final Cut).

## Cài đặt (macOS 12 trở lên, đã kiểm tra cấu trúc gói cho Sequoia 15)

1. Chọn đúng file theo chip máy (menu  → **Giới thiệu về máy Mac này**):
   - Chip **Apple M1/M2/M3/M4…** → `CC-Motion-Editor-<version>-arm64.dmg`
   - Bộ xử lý **Intel** → `CC-Motion-Editor-<version>-x64.dmg`
2. Mở file DMG, kéo **CC Motion Editor** vào thư mục **Applications**.
3. Mở app lần đầu. App chưa ký bằng Apple Developer ID nên macOS báo *"Apple không thể xác minh…"* → bấm **Xong**.
4. Vào **Cài đặt hệ thống → Quyền riêng tư & Bảo mật**, kéo xuống mục Bảo mật, bấm **Vẫn mở** cạnh dòng "CC Motion Editor đã bị chặn…", xác nhận bằng mật khẩu / Touch ID. Từ lần sau mở bình thường.

   Cách nhanh bằng Terminal (thay cho bước 3–4):
   ```bash
   xattr -dr com.apple.quarantine "/Applications/CC Motion Editor.app"
   ```
5. Lần đầu mở, app hiện Cài đặt để nhập **Claude API key** (lấy ở console.anthropic.com). Key được mã hoá bằng Keychain.

## Build từ mã nguồn

Cần Node.js 20+.

```bash
npm install
npm run dev                 # chạy thử chế độ dev
bash scripts/build-mac.sh   # ra release/CC-Motion-Editor-<version>-{arm64,x64}.dmg
```

- Trên **Mac**: electron-builder tự làm DMG và ký ad-hoc.
- Trên **Linux**: cần `xorriso` và `rcodesign` (`cargo install apple-codesign --bin rcodesign`). Script tự tải ffmpeg đúng chip, ký ad-hoc toàn bộ app bằng rcodesign, rồi `scripts/make-dmg.py` dựng ổ HFS+ và nén thành DMG chuẩn UDIF (zlib).
- Icon: `python3 scripts/make-icon.py` vẽ `build/icon.png`.

## Kiến trúc

```
electron/main.ts        Main process: cửa sổ, IPC, giao thức media:// (hỗ trợ tua video), filmstrip, lưu settings/project
electron/claude.ts      Gọi Claude API (@anthropic-ai/sdk); prompt mô tả định dạng scene layer/keyframe
electron/ffmpeg.ts      Encode frame -> MP4, đọc thông tin file bằng ffmpeg (không cần ffprobe), filmstrip, lệnh xuất tổng (trim, tốc độ, xfade, fade âm thanh, nhạc)
src/engine/             Engine motion: kiểu dữ liệu, easing/bezier, chuẩn hoá dữ liệu Claude, vẽ canvas, thao tác keyframe/preset
src/editor/             Motion Editor kiểu After Effects (viewer, timeline layer, properties, graph editor, presets)
src/public/sandbox.html Iframe sandbox cho layer code: không mạng, không Node, không Math.random/Date
src/lib/pipeline.ts     Claude -> chuẩn hoá -> chạy thử -> tự sửa lỗi (tối đa 2 lần) -> render -> media bin
src/lib/timeline.ts     Logic timeline: tốc độ, chuyển cảnh, tách, Q/W, trim (có unit test)
src/components/         Màn hình chính: brand kit, studio, preview, timeline, xuất video
```

**Vì sao scene là layer + keyframe:** Claude không sinh pixel video nhưng thiết kế bố cục và chuyển động rất tốt. Thay vì để Claude viết một khối code khó sửa, app yêu cầu Claude trả về scene dạng dữ liệu (layer chữ/hình/ảnh, keyframe, easing, text animator), giống một composition After Effects. Nhờ vậy anh chỉnh tay được từng chi tiết, và Claude cũng sửa tiếp được trên chính bản anh đã chỉnh. Hiệu ứng mà layer thường không làm được (hạt, nền động) thì Claude viết thành **layer code** chạy trong sandbox.

Model mặc định là Claude Opus 5.5, đổi được trong Cài đặt. Request bật `fallbacks: "default"` để nếu bộ lọc an toàn từ chối nhầm thì API tự chạy lại trên model dự phòng.

## Test

```bash
npm test          # unit test: easing, keyframe, chuẩn hoá dữ liệu, preset, timeline (tốc độ, chuyển cảnh, Q/W)
npm run test:e2e  # chạy app thật, Claude được giả lập bằng server cục bộ, bấm qua 35 chức năng:
                  # kịch bản, generate + tự sửa lỗi, Motion Editor (chọn/kéo/undo/stopwatch/preset/keyframe/ease/
                  # text animator/công cụ chữ/vẽ hình/align/nhờ Claude sửa), render lại, timeline (tốc độ,
                  # chuyển cảnh, tách, W, undo, phát), xuất video (kiểm tra thời lượng + có tiếng)
```
Trên Linux chạy e2e cần `xvfb-run`.

## Giới hạn hiện tại và hướng làm tiếp

| Hiện tại | Hướng tiếp |
|---|---|
| Mask chỉ có dạng "trồi lên từ vạch" trong text animator | Track matte / mask tự vẽ cho mọi layer |
| Một track video chính + một track nhạc | Track overlay (chữ, logo đè lên video quay thật) |
| Graph editor chỉnh ease từng đoạn (kiểu Flow), chưa có value graph | Speed/value graph đầy đủ như AE |
| Chưa có motion blur | Motion blur khi render (lấy mẫu nhiều frame) |
| Font: dùng font đã cài trên Mac | Nạp file .otf/.ttf vào brand kit |
| Ký ad-hoc, chưa notarize | Ký bằng Apple Developer ID + notarize để mở không cần bước "Vẫn mở" |
