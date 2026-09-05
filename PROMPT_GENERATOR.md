# Promt Generator

Mở `index.html`, chọn **Promt Generator** dưới nút **AI Remove BG** đã tạm tắt.
Điền thông tin, mở phần tùy chỉnh để sửa màu, slogan, tỷ lệ rồi bấm **GENERATE PROMT**.
Hai ô slogan và mô tả phụ để trống mặc định. Nếu người dùng không nhập, prompt giữ
`[INSERT MAIN SLOGAN IN ENGLISH]` và `[INSERT SUB-DESCRIPTION IN ENGLISH]` để công
cụ tạo ảnh tự đề xuất nội dung phù hợp; nếu có nhập thì dùng nguyên nội dung đó.
Bảng kết quả cho phép sửa trực tiếp và copy toàn bộ nội dung. Các trường của từng mẫu
được lưu trên trình duyệt khi localStorage khả dụng.

## Thêm master prompt

Thêm một phần tử vào `window.PROMPT_TEMPLATES` trong `js/prompt-templates.js`:

- `id`: mã duy nhất, dùng chữ thường và dấu gạch ngang.
- `title`, `cardTitle`, `caption`: tên và mô tả mẫu.
- `thumbnail`, `thumbnailAlt`: đường dẫn ảnh trong dự án và mô tả ảnh.
- `fields`: các trường gồm `key`, `label`, `value`; thêm `advanced: true` để thu gọn,
  hoặc `options` để dùng danh sách lựa chọn.
- `master`: nội dung đầy đủ, dùng `{{key}}` tại mọi vị trí cần thay thế.

Giao diện tự tạo thêm thẻ từ danh sách này. Script được nạp trực tiếp, không fetch
file mẫu, để phù hợp với cả trang tĩnh và cách mở file HTML trên máy.

Mẫu đầu tiên lưu nguyên bản tại `assets/prompts/juice-splash-original.txt`.
Bản template giữ 21 phần và negative prompt, đồng bộ những đoạn cố định về cam
với trường trái cây, liên kết slogan ở hai phần và cho phép chọn tỷ lệ.
Giá trị mặc định là xoài để tương ứng thumbnail; có thể thay bằng thông tin khác.

Mẫu thứ hai **Premium Dark Splash** lưu nguyên bản tại
`assets/prompts/premium-dark-splash-original.txt`. Mẫu có 22 phần, dùng thumbnail
Tamarind và cung cấp 12 trường chỉnh sửa cho sản phẩm, nguyên liệu, botanical,
màu sắc, mood, slogan, mô tả và tỷ lệ. Slogan cùng mô tả phụ cũng để trống mặc định
và dùng hai placeholder tương ứng khi người dùng không nhập.

Mẫu thứ ba **Frozen Fruit Macro** lưu nguyên bản tại
`assets/prompts/frozen-fruit-macro-original.txt`. Mẫu dùng thumbnail Ayola táo và
cung cấp 7 trường chỉnh sửa cho sản phẩm, hương vị, trái cây trong đá, màu thương
hiệu, màu phản chiếu, màu nền và tỷ lệ. Mặc định sử dụng tỷ lệ 9:16 theo thumbnail.

Mẫu thứ tư **Dynamic Ingredient Splash** lưu nguyên bản tại
`assets/prompts/dynamic-ingredient-splash-original.txt`. Mẫu dùng thumbnail ELD
Tamarind và cung cấp 13 trường chỉnh sửa cho sản phẩm, thương hiệu, hương vị,
nguyên liệu, màu sắc, mức hiệu ứng nước, phong cách, tỷ lệ, khoảng trống và nội
dung loại trừ. Mẫu giữ yêu cầu không tạo slogan hoặc chữ quảng cáo.

Mẫu thứ năm **Natural Basket Lifestyle** lưu nguyên bản tại
`assets/prompts/natural-basket-lifestyle-original.txt`. Mẫu dùng thumbnail Aloe
Vera ngoài trời và có một trường chỉnh sửa vật thể trong giỏ. Giá trị này được
đồng bộ ở cả năm vị trí xuất hiện trong master prompt.

Mẫu thứ sáu **Bright Fruit Platform** thuộc tab Juice, lưu nguyên bản tại
`assets/prompts/bright-orange-platform-original.txt`. Mẫu dùng thumbnail poster
nước cam trên platform acrylic và có các trường màu nền, trái cây, slogan, mô tả
phụ và tỷ lệ. Slogan cùng mô tả phụ để trống mặc định để AI tự tạo theo sản phẩm.

Mẫu thứ bảy **Orange Power Splash** thuộc tab Juice, lưu nguyên bản tại
`assets/prompts/premium-fruit-beverage-hero-original.txt`. Mẫu dùng thumbnail
lon nước cam giữa splash, đá viên và lát cam; có các trường màu nền, trái cây,
slogan, mô tả phụ và tỷ lệ 4:5. Slogan cùng mô tả phụ để trống mặc định để AI tự
tạo theo sản phẩm.

Mẫu thứ tám **Frozen Coconut Strawberry** thuộc tab Juice, lưu nguyên bản tại
`assets/prompts/frozen-coconut-strawberry-original.txt`. Mẫu dùng thumbnail lon
sữa dừa dâu tây giữa đá lạnh và chỉ cho phép thay đổi tông màu nền cùng trái cây
chính để giữ series hình ảnh đồng nhất.

## Gemini và Dola

**Use on Gemini** copy nội dung và mở `https://gemini.google.com/app`.
**Use on Dola** copy nội dung và mở thẳng `https://www.dola.com/chat/create-image`.
Người dùng dán bằng Ctrl+V / Cmd+V và đính kèm ảnh sản phẩm. Nếu copy hoặc popup
bị chặn, giao diện có hướng dẫn copy thủ công và liên kết mở trang.

Các nút dùng phiên đăng nhập của người đang sử dụng trình duyệt. Không có cơ chế
chia sẻ phiên Gemini Pro của chủ website với khách bằng đường link.
Chưa xác nhận được giao diện liên kết công khai hỗ trợ điền sẵn prompt hay ép chọn
Seedream 5.0 Pro; vì vậy không thêm tham số URL suy đoán. Người dùng chọn model trên
Dola nếu tài khoản của họ có lựa chọn đó. Không cam kết model hoặc hạn mức miễn phí.

Tham khảo: [Đăng nhập Gemini](https://support.google.com/gemini/answer/13278668?hl=en),
[Same-origin policy](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Same-origin_policy).
