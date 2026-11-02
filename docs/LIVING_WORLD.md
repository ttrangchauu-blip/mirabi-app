# Living World: Cuộc sống Mirabi và Tiện ích

Cuộc sống Mirabi là một thế giới 2D/2.5D gồm bốn nơi của pet. Tiện ích gom những gì không phải là một nơi. Việc tái cấu trúc
này chỉ đổi cách hiển thị và điều hướng: mọi quy tắc khám phá, thời gian, tiến hóa, EXP, kho đồ và vườn vẫn nằm nguyên ở
backend. Tài liệu này mô tả điều hướng mới, Design System, Living World Animation System, thời tiết, dữ liệu và cách kiểm thử.

## 1. Kết quả audit

| Vấn đề trước đây | Cách xử lý |
|---|---|
| "Vườn nhà" có ba lối vào (Tiện ích, Cài đặt phòng, Kho đồ) và là màn hình đè lên tab | Một nơi trong Cuộc sống; Kho đồ dẫn thẳng tới đó |
| "Bạn bè" vừa là tab, vừa có nút trong phòng, vừa có tab "Vườn bạn bè" trong vườn | Một nơi trong Cuộc sống; nút trong phòng và tab "Vườn bạn bè" được gỡ, thăm vườn nằm trong menu của từng bạn |
| "Bảng tin" nằm ở Tiện ích, xa Bạn bè | Chuyển vào nơi Bạn bè |
| Sáu "thế giới" 16+ xếp thành sáu thẻ trong Tiện ích | Mỗi thế giới về đúng chỗ (bảng dưới); vẫn chỉ dành cho người từ 16 tuổi |
| Góc thư giãn có hai lối vào | Chỉ còn nút lá trong Nhà của pet |
| Album có lối vào trong Cài đặt phòng | Giữ lối ở Trang chủ (lối tắt) và Tiện ích |
| 11 nút giả chỉ hiện thông báo "đang phát triển" hoặc "sẽ được bổ sung" | Giữ cả 11 mục, mỗi mục chuyển sang dạng có thật (bảng ngay dưới). Không còn nút nào bấm vào mà không dẫn tới đâu |
| Thanh menu biến mất khi mở Album | Thanh menu luôn hiện. Ngoại lệ có chủ đích duy nhất: khi đang chơi một game toàn màn hình |
| Thanh trên của phòng cao 96 điểm | Một hàng 48 điểm; dòng trạng thái chỉ hiện khi có điều đáng nói |

Mười một mục đó hiện ở đâu và làm gì:

| Mục cũ | Dạng mới | Nằm ở |
|---|---|---|
| Thành tựu | Mở Kho đồ ở tab Kỷ vật, nơi có huy hiệu địa điểm. Huy hiệu nghề vẫn ở Hành trình sự nghiệp | Tiện ích → Kỷ niệm và thành tựu |
| Bảng xếp hạng | Đổi tên thành "Cùng bạn tiến bộ", mở Nhiệm vụ nhóm. Nhiệm vụ nhóm cố ý không xếp hạng (`backend/app/team_quests.py`) | Tiện ích → Học tập và tập trung |
| Nhật ký phản tư | Mở Nhà trong Góc thư giãn, sổ nhật ký hiện sẵn. Chỉ từ 16 tuổi, như Góc thư giãn | Tiện ích → Kỷ niệm và thành tựu |
| Mời bạn bè | Màn hình mã kết bạn và QR, có nút chia sẻ. Bỏ lời hứa "nhận thêm pha lê" vì không có phần thưởng nào phía sau | Tiện ích → Cá nhân hóa |
| Cửa hàng | Dòng "Sắp có" kèm số xu và pha lê, không bấm được. Chưa có gì để mua: xu hiện chỉ dùng để góp xây Thị trấn | Tiện ích → Cá nhân hóa |
| Tài khoản | Hồ sơ và Đổi mật khẩu (dùng lại luồng mã qua email, đổi xong đăng nhập lại) | Cài đặt và trợ giúp |
| Thông báo | Mở hộp thư thông báo. Chưa có thông báo đẩy: backend chưa có nơi lưu device token | Cài đặt và trợ giúp |
| Quyền riêng tư | Năm công tắc của `/api/social/me`, ghi chú về vị trí, danh sách người đã chặn và nút bỏ chặn (trước đây chặn rồi không bỏ được) | Cài đặt và trợ giúp |
| Ngôn ngữ | Dòng thông tin "Tiếng Việt", không bấm được | Cài đặt và trợ giúp |
| Chế độ tối | Dòng "Sắp có", không bấm được. Màu của app còn cố định trong `StyleSheet`, nên chế độ tối là một đợt việc riêng | Cài đặt và trợ giúp |
| Trợ giúp | Xem lại giới thiệu, Bảng tin, câu hỏi thường gặp. Chưa có kênh liên hệ hỗ trợ | Cài đặt và trợ giúp |

## 2. Điều hướng

```
Trang chủ   Học tập   Cuộc sống   Tiện ích          ← thanh menu cố định
                         │
       ┌───────────┬─────┴─────┬───────────┐
      Nhà         Vườn      Khám phá     Bạn bè      ← SpaceSwitcher, luôn ở cùng một chỗ
       │           │           │           │
  Trang trí     Trồng       Chuyến đi    Con phố của bạn bè
  Chăm pet      Tưới        Quà          Ghé phòng, Thăm vườn
  Góc thư giãn* Chăm sóc    Kho đồ       Kết bạn, lời mời
  Chụp ảnh      Kho đồ      Phiêu lưu*   Bảng tin
                                         Thị trấn*

Tiện ích
  Học tập và tập trung   Pomodoro, Sổ tay kiến thức, Nhiệm vụ công việc*, Hành trình sự nghiệp*, Vườn tài chính*
  Kỷ niệm và thành tựu   Album kỷ niệm, Hành trình đăng nhập, Thống kê tập trung, Lịch sử học tập
  Cá nhân hóa            Độ tuổi & lớp học, Quản trị lớp học (admin), Âm thanh, Hiệu ứng, Giảm chuyển động, Thời tiết

* Từ 16 tuổi (life/access.ts), backend vẫn kiểm tra lại.
```

Quy ước: mỗi nơi chỉ có một lối vào từ menu. Trang chủ giữ lối tắt, vì đó là mục đích của nó. Kho đồ có ở hai nơi vì
có lý do UX: trong phòng để đặt đồ, trong vườn để lấy hạt.

Bản đồ code: `screens/life/LifeHub.tsx` (switcher và chuyển cảnh), `screens/life/spaces.ts`, `screens/life/ExploreSpace.tsx`,
`screens/life/FriendsSpace.tsx`, `screens/garden/GardenWorld.tsx`, `screens/room/RoomTab.tsx`, `screens/main/MoreTab.tsx`.
Một nơi không được hiển thị thì không được mount: nó không giữ timer, loop hay texture.

## 3. Design System (`mobile/src/ui/design.ts`)

| Token | Dùng cho |
|---|---|
| `radius` (`sm 12`, `md 16`, `lg 22`, `xl 28`, `pill`) | Card luôn `lg`, nút trong card `md`, huy hiệu `sm` |
| `space`, `touch` | Khoảng cách; vùng chạm tối thiểu 44 và 48 |
| `type` (`display`, `title`, `label`, `body`, `caption`, `micro`) | Một thang chữ, line-height đủ chỗ cho dấu tiếng Việt |
| `elevation` (`card`, `raised`, `floating`) | Chiều sâu, từ thẻ nằm trên trang tới panel nổi trên cảnh |
| `glass` | Panel trên cảnh, đọc được cả ban ngày và ban đêm |
| `tones` (`sky`, `leaf`, `sun`, `rose`, `lilac`, `sea`) | Mọi huy hiệu icon; chữ đậm trên nền pastel, độ tương phản >= 4.5:1 |

`ui/kit.tsx` đọc token từ đây, nên mọi màn hình dùng kit đều theo Design System. Màu của app vẫn ở `theme.ts`. Icon của
bốn nơi được vẽ chung một phong cách (`SpaceIcon`); icon tính năng là Ionicons bản đặc trên huy hiệu gradient pastel.

Chưa làm: các màn hình cũ tự đặt màu và cỡ riêng trong `StyleSheet` (trò chơi, Work Quest, Thị trấn…) chưa được chuyển sang token.

## 4. Living World Animation System (`mobile/src/world/`)

| File | Vai trò |
|---|---|
| `motion.ts` | Thời lượng, easing theo loại vật thể (`pet`, `cloth`, `leaf`, `water`, `light`, `ui`), và `PET_ACTS`: mỗi động tác là chuỗi beat anticipation, primary, secondary, followThrough, settle |
| `petMachine.ts` | State machine dùng chung: `idle`, `walk`, `interact`, `celebrate`, `study`, `rest`, `away`. Chỉ các chuyển trạng thái đã khai báo mới xảy ra |
| `budget.ts` | Mức chuyển động (`full`, `lite`, `still`), tạm dừng khi app chạy nền, `useSwing`, `useTravel`, `useEased`, đo khung hình |
| `atmosphere.ts` | Đổi số đọc thời tiết thành `Mood`, phủ màu lên ánh sáng của giờ, chuyển dần khi có số đọc mới |
| `sky.tsx` | Trời, mặt trời, mặt trăng, sao dùng chung cho mọi cảnh ngoài trời |
| `living.tsx` | `LivingPet`, `Sway`, `GrassField`, `Pond`, `Rain`, `Snow`, `Fog`, `CloudDeck`, `Fireflies`, `WeatherChip`, `WorldPanel` |

Nguyên tắc đã được áp dụng trong code:

- **Theo thời gian thực, không theo khung hình.** Mọi loop dùng mili giây trên native driver (chỉ transform và opacity), nên
  máy 60 Hz và 120 Hz cho cùng một chuyển động.
- **Baseline cố định.** Mọi phép scale lấy gốc ở chân pet (`transformOrigin: '50% 100%'`), và mọi act kết thúc ở trạng thái nghỉ,
  nên pet không đổi vị trí chân hay kích thước sau khi diễn.
- **Chân không trượt.** Khi đi trên đường, cùng một giá trị điều khiển cả con đường lẫn frame sprite. Mỗi vòng lặp đường là số
  nguyên lần bước, nên không có bước nhảy tại điểm nối. Trong phòng, frame đi theo quãng đường đã đi, kể cả khi pet tăng tốc đầu đường và giảm tốc cuối đường.
- **Có nhịp nghỉ.** Lá, cỏ, nước và rèm có thời lượng khác nhau ở mỗi lần lắc và có thể dừng ở cuối nhịp. Idle sprite nghỉ ở frame
  đầu trong khoảng ngẫu nhiên 0,3–2,6 giây, nên nhịp chớp mắt không đều đặn như đồng hồ.
- **Không đổi cơ thể pet.** Chỉ dùng sprite gốc và transform của cả hình; hạt nguyên tố bay bên cạnh, không nằm trên thân.

### Giới hạn do asset

Pet chỉ có các sheet `idle` (32 frame), `walk`, `study`, `move`, `hatch` (8 frame). **Không có** `jump`, `run`, `sit`, `sleep`, `celebrate`,
`interact`, nên:

- Nhảy và ăn mừng là transform toàn thân trên sheet đang chạy. Biểu cảm khuôn mặt chỉ có trong các frame idle sẵn có, không đổi theo hành động.
- Tai, đuôi, lông chỉ chuyển động trong những gì sheet đã vẽ; không tách được từng phần vì sprite là một ảnh phẳng.
- Pet nghỉ vẫn dùng ảnh tĩnh.

Muốn đạt đúng yêu cầu cần vẽ thêm các sheet theo đặc tả ở `docs/MIRABI_LIFE.md` mục 7. Code đã sẵn đường cho việc này: thêm sheet vào `petSprites.ts`
rồi map trạng thái trong `artFor`. Skeletal animation (Rive, Spine) sẽ cần rig lại toàn bộ 42 hình của 6 hệ × 7 cấp, nên chưa làm.

### Cảnh

- **Nhà:** rèm của cửa sổ lay từ dải buộc (`Curtains`, tự dừng lại ở đồ vật đứng trước rèm), ánh sáng theo giờ phủ lên phòng ở dưới lớp pet nên pet giữ nguyên
  màu, đèn tự sáng lúc chiều tối và khi trời tối, chạm đèn để bật tắt có nhấp nháy như bóng thật, chạm đồ vật thì đồ vật nảy nhẹ, cửa sổ có mây bay hoặc mưa theo thời tiết thật.
- **Vườn:** lá và hoa lay từ gốc theo sức gió, cỏ lay không đồng bộ, ao có gợn, đất sẫm lại khi đã tưới (theo dữ liệu server), cây bật lên khi đổi giai đoạn. Tưới có bình nghiêng,
  giọt rơi và vòng nước, chỉ chạy sau khi server xác nhận. Pet đi tới cạnh luống rồi nhảy, sau đó quay về.
- **Khám phá:** sáu lớp parallax. Có cảnh lên đường, đang đi, trở về (đi về từ bên phải, ăn mừng, gói quà rơi xuống) và nghỉ. Không có API mới và không có logic mới: màn hình chỉ đọc `/api/pet/space`.
- **Bạn bè:** con phố với mỗi bạn một căn nhà; chạm để ghé thăm. Sau chiều tối đèn trong nhà sáng.

## 5. Thời tiết và ngày đêm

```
Thiết bị (quyền vị trí) → làm tròn 0,1° (~11 km) → GET /api/world/weather → weather_cache (mỗi ô một bản đọc) → Open-Meteo
```

- Không có nút chọn thời tiết. Số đọc đến từ vị trí tương đối, nếu người dùng cho phép. Quyền chỉ được hỏi ở lần đầu vào Cuộc sống, và không hỏi lại sau khi bị từ chối hẳn.
- Vị trí được làm tròn trên thiết bị trước khi gửi. `weather_cache` không có `user_id`. Log chỉ ghi loại lỗi.
- Thời hạn: một số đọc dùng được 30 phút; nhà cung cấp lỗi thì giữ số cũ tối đa 6 giờ và đánh dấu `stale`, sau đó trả `{"available": false}`. Sau khi lỗi, 5 phút mới hỏi lại.
- **Không giả vờ:** không có số đọc thì `WeatherChip` không hiện, cảnh chỉ theo giờ, và mục Cá nhân hóa nói rõ điều đó. Số đọc cũ ghi kèm giờ cập nhật.
- Chuyển cảnh: màu trời nội suy liên tục theo giờ (`daylight.ts`). Số đọc mới chuyển dần trong 6 giây. Đổi thời tiết không chạm vào state machine của pet và không remount cảnh.

Thời tiết hiển thị được: quang, nhiều mây, mưa, giông, sương mù, tuyết, gió. Ban đêm có trăng, sao, đom đóm (tắt khi mưa), đèn phòng sáng.

**Cần xác nhận trước khi ra mắt thương mại:** gói miễn phí của Open-Meteo chỉ dành cho mục đích phi thương mại và yêu cầu ghi nguồn (đã ghi ở Tiện ích → Cá nhân hóa). `WEATHER_API_URL` đổi được qua cấu hình; `WEATHER_ENABLED=false` tắt hoàn toàn.

## 6. Backend

Bảng mới, do `create_all` tạo: `weather_cache`, `world_preferences`. Không đổi bảng cũ. Rollback an toàn: xóa hai bảng này không ảnh hưởng tính năng nào.

| Endpoint | Ghi chú |
|---|---|
| `GET /api/world/weather?lat&lon` | Cần đăng nhập, giới hạn 30 lần/phút. Không trả lỗi khi nhà cung cấp lỗi |
| `GET /api/world/preferences` | `{version, settings}`; `version: 0` khi chưa lưu |
| `PUT /api/world/preferences` | `{version, settings}`; sai version trả 409 `preferences_version_conflict`, không đổi gì |

Yêu cầu lưu trữ và nơi đáp ứng (không có frame animation nào được lưu):

| Yêu cầu | Nơi lưu | Bảo vệ khi retry hoặc phản hồi sai thứ tự |
|---|---|---|
| Vị trí đồ vật | `pet_rooms.items_json` | `version`; app bỏ qua bản đọc cũ hơn |
| Trạng thái đèn | `world_preferences.lamps` | `version` |
| Vườn và tiến độ | `garden_plots`, `garden_care` | `client_request_id`; app bỏ qua trả lời có `server_now` cũ hơn (**mới**) |
| Trạng thái pet | `users`, `pet_evolutions` | `lock_daily_goals`, chỉ nở một lần |
| Khám phá, vật phẩm | `pet_walks`, `walk_rewards`, kho đồ | `rewarded_at`, `event_key`; app chỉ nhận lần đọc mới nhất |
| Cá nhân hóa | `world_preferences` (**mới**) | `version`; offline giữ cờ `dirty` và gửi ở lần mở sau |

## 7. Kiểm thử

```bash
cd backend && .venv/Scripts/python -m pytest tests/test_world.py
cd mobile && npx jest __tests__/living-world.test.tsx
```

### Phải kiểm tra trên thiết bị thật (chưa làm)

Toàn bộ kiểm tra tới nay chạy trên Jest và Chrome giả lập di động, chưa từng chạy trên Android hay iPhone thật. Mọi con số dưới đây chưa được đo.

| Hạng mục | Cách đo | Mục tiêu |
|---|---|---|
| FPS | Perf Monitor của React Native trên từng nơi; `EXPO_PUBLIC_WORLD_PERF=1` ghi FPS luồng JS | UI 60 FPS khi đủ khả năng, trời mưa ở Vườn là cảnh nặng nhất |
| Android yếu | Máy Android 8–9, RAM 2–3 GB | Tự xuống `lite`, không giật khi đổi nơi |
| RAM, rò bộ nhớ | Android Studio Profiler hoặc Xcode Instruments; đổi nơi 50 lần | Không tăng dần |
| Pin, nhiệt | Mở Vườn 30 phút khi trời mưa | Không nóng bất thường |
| Quyền vị trí | Cho phép, từ chối, từ chối hẳn, tắt định vị | Không kẹt; không có số đọc thì không hiện thời tiết |
| Safe area | Máy có tai thỏ, Dynamic Island, thanh điều hướng 3 nút | Switcher và thanh menu không bị che |
| Ổn định khi mở lại app | Đưa xuống nền trong khi pet đi, rồi mở lại | Không nhảy vị trí, loop chạy tiếp |
| Rèm động | Đối chiếu từng biến thể cửa sổ | Mép rèm khớp tranh, không lộ khi đứng yên |

Hướng dọc là hướng duy nhất của app (`app.json`), nên không thử xoay ngang. `expo-location` là native module mới: dùng Expo Go thì chạy ngay, dùng dev client hoặc store build thì phải build lại.
