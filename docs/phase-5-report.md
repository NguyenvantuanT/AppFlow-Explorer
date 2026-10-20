# AppFlow Explorer — Báo cáo Phase 5

20/10/2026

## Tổng quan & phạm vi

Phase 5 hoàn thành ngày 20/10/2026. Mỗi màn hình và mỗi điều hướng trên bản đồ giờ dẫn về đúng chỗ trong code. Có thể mở chỗ đó ngay trong app hoặc trong VS Code/Cursor, và đi ngược từ một dòng code về bản đồ. Vị trí trong code luôn là đường dẫn và số dòng thật mà phân tích ghi lại. Khi không biết vị trí, hoặc file đã bị sửa sau lần phân tích, app nói rõ điều đó thay vì chỉ sai chỗ.

**Trong phạm vi:**

- **Màn hình → code:** file, route, widget chính, trạng thái ảnh chụp, các điều hướng liên quan.
- **Edge → code:** event handler, khai báo route, màn hình đích, kèm mức độ chắc chắn.
- **Viewer tích hợp:** tô sáng đúng đoạn code.
- **Mở trong editor ngoài:** có kiểm tra phạm vi workspace.
- **Code → bản đồ:** đi ngược từ một dòng code về phần tử trên bản đồ.
- **Số dòng lệch:** xử lý khi code thay đổi sau lần phân tích.
- Test và tài liệu.

**Ngoài phạm vi:**

- Tính năng AI. App không gửi code ra ngoài; nếu sau này có AI thì phải là tuỳ chọn bật rõ ràng.
- Editor khác ngoài VS Code và Cursor (JetBrains, Xcode).

## Quyết định kỹ thuật

| Quyết định | Lựa chọn | Lý do |
| --- | --- | --- |
| Phát hiện số dòng lệch | Lúc phân tích, ghi lại `anchor` (nội dung dòng đã trim) cho mọi vị trí và `contentHash` (SHA-1) cho mọi file có vị trí trỏ tới. Agent trả cùng hash khi đọc file | Biết chắc file có đổi hay không, và tìm lại được dòng đã dịch mà không cần phân tích lại |
| Dò lại dòng | Còn đúng ở dòng cũ → **exact**; tìm thấy ở dòng khác → **moved** (lấy dòng gần nhất, giữ nguyên độ dài đoạn); không còn → **stale** (vẫn tô dòng cũ nhưng màu vàng, kèm cảnh báo) | Không bao giờ âm thầm chỉ sang code khác |
| Vị trí tốt nhất của edge | Event handler → lời gọi điều hướng → khai báo route → màn hình đích → các bằng chứng khác | Đúng thứ tự người dùng cần: cái gì kích hoạt, rồi đích được xác định ra sao |
| Độ chắc chắn | Mục nào không chắc có nhãn **Uncertain** kèm lý do; mục không có vị trí ghi "No source location" | Đáp ứng yêu cầu thể hiện sự không chắc chắn, không bịa vị trí |
| Code → bản đồ | Marker trong gutter (`▣` màn hình, `→` điều hướng, `#` route); bấm số dòng để chọn điều hướng trên dòng đó, hoặc màn hình bao quanh dòng | Đi hai chiều mà không phải tìm thủ công |
| Mở editor ngoài | Renderer → main (validate) → agent `files/reveal` (cùng quy tắc như đọc file) → `vscode://file/…:dòng` hoặc `cursor://…` | Không mở file bằng ứng dụng mặc định của hệ điều hành, vì cách đó có thể chạy script. Đường dẫn được kiểm tra ở agent, không tin renderer |
| Quyền riêng tư | Mọi kết nối mạng đều qua loopback (agent `127.0.0.1`, VM service của app debug); đã kiểm tra trong code | Đáp ứng yêu cầu không gửi source ra dịch vụ bên ngoài |

## Đáp ứng yêu cầu

| Yêu cầu | Cách đáp ứng |
| --- | --- |
| Chọn màn hình: file, route, widget chính, ảnh chụp, quan hệ điều hướng | Screen details có mục **Source** (file:dòng, nút mở editor, route), **UI states** (ảnh runtime mới nhất trước, kèm thiết bị, thời gian, build; ảnh minh hoạ ghi rõ là minh hoạ), Navigation from/to, Key widgets |
| Chọn edge: vị trí handler và vị trí resolve đích | Mục **Source** liệt kê theo thứ tự ưu tiên, mục đầu tiên có nhãn **Best match**; **Open in Code Editor** mở đúng mục đó |
| Mở file và tô sáng đoạn code | Viewer tích hợp tô sáng đoạn code, mở trong VS Code/Cursor tại đúng dòng |
| Đường dẫn và số dòng thật | Test analyzer chạy trên 5 fixture: mọi vị trí đều là file có thật, dòng nằm trong file, anchor khớp nội dung, hash khớp |
| Màn hình → code và code → bản đồ | Nút mở code ở panel; marker và số dòng trong viewer chọn phần tử trên bản đồ và đưa nó vào giữa màn hình |
| Thể hiện sự không chắc chắn | Handler không xác định được thì hiện "Navigation call" (Uncertain); đích không rõ hiện kèm lý do; edge chỉ quan sát lúc chạy hoặc thêm bằng tay ghi rõ không có vị trí |
| Số dòng lệch sau khi sửa code | Banner "moved from line 44 to line 46" hoặc "no longer there", có nút Re-analyze và Reload; marker đi theo code |
| Phạm vi workspace và quyền file | Đọc và mở file đều qua agent: trong project, đã resolve symlink, không phải file nhạy cảm, phải là file thường; lỗi 403/404 hiện lý do cùng nút Retry |
| Không gửi code ra AI bên ngoài | Không có tính năng AI hay cloud; nội dung file chỉ đi từ agent loopback tới renderer |

## Kiểm thử & xác minh

Cả 248 test đều pass (trước Phase 5 là 200), typecheck sạch, build production thành công.

| Bộ test | Số test | Thêm trong Phase 5 |
| --- | --- | --- |
| `packages/model` | 40 (+12) | `relocate` (không đổi, dịch dòng, chọn dòng gần nhất, stale, clamp, CRLF, không có anchor); vị trí code của edge (handler, navigation call, route, route chưa khai báo, đích không rõ, edge chỉ quan sát lúc chạy, edge thêm bằng tay, đích chọn tay, màn hình không tồn tại); marker; dòng → bản đồ |
| `packages/analyzer` | 103 (+6) | Vị trí thật trên 5 fixture (file, dòng, anchor, hash); không vị trí nào trỏ vào file nhạy cảm |
| `packages/agent` | 43 (+8) | Hash nội dung; reveal trả real path; từ chối traversal, đường dẫn tuyệt đối, `.env`, keystore, thư mục, file không tồn tại |
| `apps/desktop` | 62 (+22) | URL editor và validate request; CodePanel (exact, moved, stale kèm banner, marker đi theo code, marker và số dòng chọn trên bản đồ, file ngoài project, file không đọc được); store (vị trí tốt nhất, fallback, code → bản đồ, editor, từ chối, demo, reload); panel hiện mục Uncertain và UI states |

**Kiểm tra trên app thật** (Electron, bản copy của app mẫu `capture_demo`):

1. Mở dự án và để phân tích xong.
2. Chèn thêm 2 dòng vào đầu `lib/main.dart`.
3. Chọn edge Home → Details và mở code.

Kết quả:

- Banner báo "The highlighted code moved from line 44 to line 46".
- Dòng 46 `onPressed: () => Navigator.pushNamed(context, '/details')` được tô sáng.
- Marker dịch theo đúng 2 dòng: route ở 16 và 17, `HomeScreen` ở 23.
- Mục Source liệt kê `FilledButton.onPressed` (Best match), khai báo route `/details`, màn hình đích `DetailsScreen` và lời gọi `pushNamed`.

Nút "Open in VS Code" chưa được bấm thử trên app thật, vì nó sẽ mở một tab trong VS Code bạn đang dùng. Phần kiểm tra đường dẫn ở agent và URL đã có test riêng.

## Hạn chế đã biết & bước tiếp theo

- Mục Source trong panel hiển thị số dòng lúc phân tích. Số dòng đã dò lại chỉ hiện trong viewer và khi mở editor từ viewer.
- Dò dòng dựa trên nội dung dòng. Nếu dòng bị sửa nội dung (không chỉ dịch chỗ) thì vị trí bị đánh dấu stale cho tới khi phân tích lại.
- Nhiều adapter chưa ghi dòng kết thúc của class màn hình, nên phần lớn chỉ tô sáng dòng khai báo.
- Chỉ hỗ trợ VS Code và Cursor. JetBrains, Android Studio và Xcode cần URL scheme riêng.

**Bước tiếp theo đề xuất:** ghi dòng kết thúc của class màn hình trong các adapter; thêm Android Studio/Xcode; hiển thị số dòng đã dò lại ngay trong panel khi file đã được tải.
