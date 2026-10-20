# AppFlow Explorer — Báo cáo Phase 6

20/10/2026

## Tổng quan & phạm vi

Phase 6 hoàn thành ngày 20/10/2026. Phase này có hai mục tiêu:

- Phân tích sâu hơn: các trạng thái UI và deep link.
- Làm cứng sản phẩm để dùng hằng ngày trên dự án thật: báo cáo độ phủ, export, phát hiện code thay đổi, lưu phiên, phím tắt, trợ năng, hiệu năng và rà soát bảo mật.

Mọi thứ vẫn chạy cục bộ. Không có cloud indexing và không có tính năng AI, vì chưa có nhu cầu rõ ràng.

**Trong phạm vi:**

- **Trạng thái UI trong code:** loading, empty, error, tải dữ liệu (API), xác thực, dialog, bottom sheet, tab.
- **Deep link:** Android app link và custom scheme, iOS URL type và associated domain. Một link được gắn với màn hình nó mở khi xác định được.
- **Re-analysis:** phát hiện file thêm, xoá hoặc sửa sau lần phân tích, rồi đề nghị phân tích lại.
- **Báo cáo:** độ phủ, các flow chưa resolve, màn hình không tới được, deep link.
- **Lưu phiên:** dự án gần nhất; selection, filter và viewport theo từng dự án.
- **Export bản đồ:** JSON, Markdown, Mermaid, SVG.
- **Phím tắt:** dùng chung một bảng, có màn hình trợ giúp. Minimap bật/tắt được.
- **Dự án lớn:** chỉ render phần tử trong khung nhìn khi bản đồ có trên 120 node.
- **Trợ năng:** focus trap trong dialog, landmark, aria-label, giảm chuyển động.
- **Bảo mật và kiểm thử:** rà soát bảo mật, test end-to-end qua HTTP.

**Ngoài phạm vi:**

- Cloud indexing và tính năng AI.
- Theo dõi file bằng watcher của hệ điều hành; app dùng polling, lý do ở bảng bên dưới.
- Chụp runtime tự động cho từng trạng thái UI. Trạng thái tìm thấy trong code vẫn là mẫu code, chưa phải màn hình đã quan sát.

## Quyết định kỹ thuật

| Quyết định | Lựa chọn | Lý do |
| --- | --- | --- |
| Tìm trạng thái UI | Mỗi adapter khai báo `uiStateRules` (regex kèm độ chắc chắn). Phần so khớp dùng chung nằm ở `core/uiStates.ts` và chỉ tìm trong code của màn hình: class/hàm của màn hình và class đi kèm như `State<HomeScreen>`. Bỏ qua comment và dòng khai báo class. Mỗi loại chỉ giữ lần khớp đầu tiên | Thêm React Native hay Android native chỉ cần thêm rule, không phải viết lại canvas hay mô hình đồ thị. Có test chứng minh: rule React Native chạy với cùng bộ so khớp |
| Không đếm hai lần | Dialog hoặc sheet đã vẽ thành edge từ cùng lời gọi thì không báo lại thành trạng thái | Bản đồ không bị lặp thông tin |
| Deep link | Thu thập ở tầng engine, từ AndroidManifest, Info.plist và entitlements. Chỉ gắn link với màn hình khi path khớp một route đã khai báo (`routeForPath`). Không khớp thì `screenId: null` kèm lý do | Không đoán màn hình đích |
| Phát hiện code thay đổi | Agent quét lại và so với snapshot (kích thước, mtime) lúc bắt đầu phân tích. Nếu mtime đổi mà kích thước giữ nguyên thì so thêm hash nội dung. Desktop hỏi mỗi 15 giây khi cửa sổ đang hiện, và hỏi thêm khi cửa sổ được focus | Không cần watcher: tránh giới hạn số file watch và hành vi khác nhau giữa các hệ điều hành. `touch` hay `git checkout` cùng nội dung không bị coi là sửa |
| Lưu phiên | `localStorage` (`appflow:session:v1`). Dữ liệu đọc vào được làm sạch, giữ tối đa 20 dự án. Selection không còn tồn tại thì bỏ đi | Dữ liệu hỏng hoặc cũ không làm vỡ app; không lưu gì ngoài máy |
| Export | Hàm thuần trong `@appflow/model`: `exportFlowMap(format, project, options)`. SVG vẽ đúng vị trí trên canvas. Tên file được gợi ý, người dùng chọn chỗ lưu trong save dialog gốc. Main process kiểm tra phần mở rộng (4 loại) và kích thước (≤ 64 MB) | Renderer không ghi file trực tiếp. Export không chứa `rootPath` hay nội dung file |
| Phím tắt | Một bảng duy nhất trong `lib/shortcuts.ts`, dùng cho cả xử lý phím lẫn màn hình trợ giúp. Phím đơn tắt khi đang gõ; phím có modifier và `Esc` vẫn hoạt động | Trợ giúp không bao giờ lệch so với hành vi thật |
| Báo cáo | Chỉ đếm thực thể thật (màn hình, edge, link). Mọi mục chưa resolve dẫn tới code của nó | Không có "điểm số" khó hiểu; người dùng biết chính xác thiếu gì |
| Hiệu năng | `onlyRenderVisibleElements` khi bản đồ có trên 120 node. Bật/tắt minimap không layout lại. Lưu viewport có debounce 400 ms | Dự án lớn vẫn mượt; không ghi storage liên tục |

## Đáp ứng yêu cầu

| Yêu cầu | Cách đáp ứng |
| --- | --- |
| Trạng thái xác thực, dữ liệu API, loading, empty/error, dialog, bottom sheet, tab | `screen.discoveredStates`, kèm file:dòng và độ chắc chắn. Hiện ở mục **UI states in code** trong panel và badge "◐ N" trên node |
| Deep link | `project.deepLinks`. Màn hình có mục **Opened by deep links**; báo cáo liệt kê mọi link, link chưa resolve có lý do |
| Re-analysis sau khi code đổi | Endpoint `GET /v1/projects/:id/changes`. Banner liệt kê file đổi (M/A/D), có nút **Re-analyze** (`Shift R`) và **Dismiss**. Layout và chỉnh sửa tay được giữ |
| Báo cáo độ phủ và flow chưa resolve | Panel **Report** (`C`): số màn hình, tới được, có trạng thái, đã chụp, edge theo trạng thái, deep link, file có kết quả; flow chưa resolve theo nhóm nguyên nhân; màn hình không tới được |
| Lưu phiên | Màn hình chào có thẻ **Last project** (Reopen and analyze / Forget). Mở lại dự án sẽ khôi phục selection, filter và viewport |
| Export bản đồ | Menu **Export** (`Ctrl/⌘ E`): JSON, Markdown, Mermaid, SVG |
| Phím tắt, minimap | 14 phím tắt, trợ giúp (`?`), minimap bật/tắt (`M`, nút trên toolbar) |
| Dự án lớn | Chỉ render phần tử trong khung nhìn khi có trên 120 node; các phép tính báo cáo chỉ chạy khi panel mở |
| Trợ năng | Xem bảng bên dưới |
| Rà soát bảo mật | Xem bảng bên dưới |
| Test end-to-end | `packages/agent/src/e2e.test.ts`: phân tích → báo cáo → export → sửa file → `/changes` → phân tích lại, tất cả qua HTTP thật |
| Adapter mở rộng được | Rule trạng thái UI và nguồn deep link tách khỏi canvas và mô hình; cả 4 adapter đều khai báo năng lực `ui-states` |

### Trợ năng

- Dialog (Report, Shortcuts, Confirm) có `role="dialog"` và `aria-modal`. Focus được giữ trong dialog, `Esc` để đóng, và focus trở lại chỗ cũ khi đóng.
- Landmark: `header role="banner"`, `nav` (cây file), `main` (canvas), `aside` (panel chi tiết). Toolbar canvas có `role="toolbar"`.
- Mọi nút chỉ có icon đều có `aria-label`. Banner thay đổi code là vùng `role="status"`. Menu export dùng `role="menu"` và điều hướng được bằng phím mũi tên.
- Khi hệ điều hành bật `prefers-reduced-motion`, animation của canvas (`motion()`) và transition CSS được tắt.

### Rà soát bảo mật

| Mục | Kết quả |
| --- | --- |
| Agent chỉ nghe loopback | Đúng: host khác `127.0.0.1`/`localhost`/`::1` bị từ chối lúc khởi động |
| Xác thực | Token ngẫu nhiên, so sánh constant-time. Renderer không thấy token (main process giữ) |
| DNS rebinding | Header `Host` phải là loopback:port, nếu không trả `421`. Request có `Origin` lạ bị từ chối |
| File nhạy cảm | `.env*`, keystore, provisioning profile, `local.properties`… không bao giờ được đọc. `/changes` dùng cùng bộ quét nên không liệt kê chúng |
| `/changes` | Chỉ trả đường dẫn tương đối, tối đa 50 mỗi loại, không có nội dung. Test e2e kiểm tra response không chứa đường dẫn tuyệt đối |
| Export | Không chứa `rootPath` hay nội dung file; text trong SVG được escape XML. Test e2e kiểm tra cả 4 định dạng không chứa đường dẫn tuyệt đối hay một dòng code thật |
| Ghi file | Chỉ qua IPC `export:save` từ chính cửa sổ của app. Người dùng chọn vị trí trong dialog gốc. Phần mở rộng thuộc danh sách cố định (dùng `Object.hasOwn`), tên file gợi ý chỉ giữ basename (chặn `../`), kích thước ≤ 64 MB |
| Electron | `contextIsolation`, `sandbox`, không `nodeIntegration`; chặn `will-navigate`; link ngoài đi qua `setWindowOpenHandler`; renderer có CSP |
| Lưu phiên | Chỉ trong `localStorage` của máy. Dữ liệu đọc vào được làm sạch theo kiểu, nên dữ liệu hỏng không gây lỗi hay chèn giá trị lạ |
| Mạng | Không có kết nối nào ra ngoài máy. Không thêm dịch vụ cloud hay AI |

Rà soát không tìm thấy lỗ hổng cần sửa ngoài những gì đã làm trong phase này: chặn path traversal trong tên file export, và `Object.hasOwn` cho phần mở rộng.

## Kiểm thử & xác minh

Cả 294 test đều pass (trước Phase 6 là 248). Typecheck sạch, build production thành công.

| Bộ test | Số test | Thêm trong Phase 6 |
| --- | --- | --- |
| `packages/model` | 48 (+8) | Báo cáo độ phủ, flow chưa resolve, deep link chưa resolve; export JSON/Markdown/Mermaid/SVG (escape, không có `rootPath`, bỏ node chưa có vị trí) |
| `packages/analyzer` | 111 (+8) | Fixture `flutter_states`: trạng thái trong màn hình và class `State`, đăng nhập, dialog inline, bỏ comment; deep link Android/iOS; `routeForPath`; rule React Native dùng chung bộ so khớp; mọi adapter khai báo `ui-states` |
| `packages/agent` | 51 (+8) | `/changes`: 409 trước khi phân tích, `touch` không tính là sửa, thêm/xoá/sửa, sạch lại sau khi phân tích lại. **E2E qua HTTP:** token sai bị từ chối; trạng thái UI và deep link; báo cáo khớp dữ liệu; 4 định dạng export không lộ đường dẫn hay code; sửa file → `/changes` → phân tích lại thấy trạng thái mới |
| `apps/desktop` | 84 (+22) | Phím tắt (modifier, đang gõ, Shift); IPC lưu file (phần mở rộng, tên file, kích thước); store (khôi phục phiên, phiên hỏng, source changes, export, export bị huỷ, minimap không layout lại); Report panel (liệt kê và đi tới flow chưa resolve, `Esc`); trợ giúp phím tắt liệt kê đủ bảng; banner thay đổi code; panel chi tiết hiện trạng thái trong code và deep link |

**Kiểm tra trên app thật.** App Electron (bản build production) được điều khiển bằng Playwright, mở một bản copy của fixture `flutter_states`:

- Phân tích xong, 3 màn hình có badge "◐".
- `C` mở Report với số liệu đúng: 4 màn hình, 3/4 tới được, 1 flow chưa resolve ở `feed_screen.dart:28`, 4 deep link trong đó 1 đã resolve. `Esc` đóng Report.
- `?` mở trợ giúp phím tắt. `M` ẩn và hiện minimap.
- Export → SVG ghi ra file 4,4 KB, không chứa đường dẫn dự án.
- Sửa `settings_screen.dart` → banner "1 file changed since this analysis (1 edited)" → **Re-analyze** → banner biến mất.

Lần chạy này phát hiện và sửa 2 lỗi giao diện:

- Nút Minimap ở toolbar dưới bị pill "What this map does not know" che. Nút đã được chuyển lên cạnh cụm zoom.
- Thông báo export chứa đường dẫn đầy đủ, che nút của banner. Giờ thông báo chỉ hiện tên file; đường dẫn đầy đủ xem khi hover.

Chưa thử bằng tay: điều hướng bằng Tab, chế độ Reduce motion của hệ điều hành, khôi phục phiên sau khi khởi động lại app.

## Hạn chế đã biết & bước tiếp theo

- Trạng thái UI dựa trên mẫu code (regex trong phạm vi màn hình). Trạng thái nằm trong widget con ở file khác hoặc trong state management (Bloc, Riverpod…) có thể bị bỏ sót.
- Mỗi loại trạng thái chỉ ghi lần khớp đầu tiên trong màn hình.
- Deep link chỉ resolve khi path khớp route đã khai báo. Link xử lý trong code (ví dụ `MainActivity` đọc intent) vẫn là chưa resolve.
- Phát hiện thay đổi dùng polling 15 giây, nên banner có thể xuất hiện trễ tới 15 giây. Với dự án rất lớn, mỗi lần quét lại đi qua cả cây thư mục.
- SVG export chỉ vẽ node đã có vị trí, không có ảnh chụp màn hình.
- Lần chạy Playwright ở trên là script tạm, chưa nằm trong repo hay CI.

**Bước tiếp theo đề xuất:**

- Theo dõi trạng thái qua widget con và state management phổ biến.
- Gắn trạng thái UI với ảnh chụp runtime tương ứng.
- Thêm test Playwright cho Electron.
- Cân nhắc dùng watcher khi số file nhỏ để banner xuất hiện nhanh hơn.
