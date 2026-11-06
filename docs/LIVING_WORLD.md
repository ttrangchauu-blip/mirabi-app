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
| Thành tựu | Màn hình Thành tựu (docs/achievements.md): huy hiệu đọc từ kết quả thật của từng tính năng. Từ đó "Kỷ vật pet mang về" vẫn mở Kho đồ ở tab Kỷ vật; huy hiệu nghề vẫn ở Hành trình sự nghiệp và được đếm trong nhóm Cuộc sống | Tiện ích → Kỷ niệm và thành tựu |
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
`screens/life/FriendsSpace.tsx`, `streetArt.ts`, `screens/garden/GardenWorld.tsx`, `screens/room/RoomTab.tsx`, `screens/main/MoreTab.tsx`.
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
- **Vườn:** một cảnh render 3D (`assets/world/yard/`): núi xa, hàng rào trắng, ao viền đá, đường lát đá và 9 ô đất viền đá. Mây 3D trôi trên bầu trời thật; cây và khóm hoa là lớp riêng lay từ gốc theo sức gió, không đồng bộ. Đất sẫm lại khi đã tưới (theo dữ liệu server), cây bật lên khi đổi giai đoạn. Gieo hạt, tưới (bình nghiêng, giọt rơi, vòng nước) và chăm sóc (lấp lánh) chỉ chạy sau khi server xác nhận. Pet đi tới cạnh ô rồi nhảy, sau đó quay về.
  Mỗi ô có vùng chạm riêng (`yardLayout`: `pitch` × `h`, tối thiểu 44 điểm), giáp nhưng không chồng lên ô bên cạnh; cây cao vẽ vượt lên trên không nhận chạm, nên chạm vào đâu trên ô là đúng ô đó.
- **Khám phá:** một thung lũng thoáng, ít cây, render 3D (`assets/world/wild/`, cảnh `scene-wild.js`), nhìn từ xa bằng một camera thật. Mọi thứ lặp theo cột của ảnh nên đoạn nào cũng nối được với đoạn nào: ba đoạn đường và đồng cỏ, hai dải đồi (một có suối), hai dải hoa gần. Đang khám phá, pet đi liên tục, không dừng và không quay đầu: pet giữ chỗ trên màn hình, đường và dải bước của pet chạy theo cùng một giá trị nên chân không trượt, các lớp khác trượt theo độ xa (`RATE` trong `exploreArt.ts`). Vị trí trên đường tính từ lúc chuyến đi bắt đầu, nên thoát app rồi mở lại pet đã đi tiếp. Bầu trời do app vẽ. Hết giờ pet dừng ngay chỗ đang đứng, ăn mừng và gói quà rơi xuống; mở màn hình sau đó thì pet đi về từ bên phải. Không có API mới và không có logic mới: màn hình chỉ đọc `/api/pet/space`.
- **Chế độ chụp ảnh của Khám phá:** nút toàn màn hình hoặc "Ẩn giao diện" chỉ ẩn các thanh và thẻ. Cảnh, pet và đồng hồ vẫn chạy, không có gì bị tháo ra (`display: none` cho phần giao diện), nên hết giờ giữa lúc đang bật cũng đúng. Ảnh chụp đúng khung cảnh (`explore-scene`), các nút nằm ngoài khung đó. Điện thoại lưu vào thư viện ảnh (`exploreShot.ts`), web tải xuống (`exploreCapture.web.ts`; html2canvas không vẽ được phần SVG có gradient như mặt trời).
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

## 8. Năm không gian học tập và tập trung

Sổ tay kiến thức, Cùng bạn tiến bộ, Nhiệm vụ công việc, Hành trình sự nghiệp và Vườn tài chính là năm nơi trong một thế giới, không còn là các trang thẻ trắng. Pomodoro giữ giao diện phòng tập trung có sẵn. Đợt này chỉ đổi cách hiển thị và tương tác: **không thêm API, trường dữ liệu hay quy tắc nào ở backend**. Ảnh chụp ở `docs/living-spaces-previews/`.

### Bộ dùng chung: `mobile/src/world/diorama.tsx`

| Thành phần | Dùng cho |
|---|---|
| `BEAT` | Thời lượng: nhấn 130 ms, mở 280 ms, chuyển cảnh 420 ms, thành tựu 1200 ms |
| `Hit` | Vật bấm được: lún xuống khi nhấn, chỉ đổi `transform` nên đồ xung quanh không xê dịch |
| `ContactShadow` | Bóng mềm nơi vật chạm đất, nhạt dần ra mép |
| `Wood`, `LightFall` | Mặt gỗ có vân và khe ván; ánh sáng từ trên bên trái |
| `SceneHeader`, `Knob` | Nút quay lại và biển tên nổi trên cảnh, không phải thanh ngang |
| `Paper`, `Tag`, `Carved` | Chữ cần đọc nằm trên giấy; tên một khu khắc trên gỗ |
| `SceneIn`, `Triumph` | Cảnh hiện ra; thành tựu mỗi lần số `play` đổi |

Ánh sáng luôn từ trên bên trái. Mọi vòng lặp đi qua `world/budget.ts`: đứng yên khi bật giảm chuyển động, vẽ ít hơn trên máy yếu, dừng khi app xuống nền. Cảnh được tách khỏi logic: file art chỉ vẽ, màn hình giữ nguyên lời gọi API.

### Từng không gian

| Nơi | File | Cảnh | Tương tác và dữ liệu |
|---|---|---|---|
| Sổ tay kiến thức | `screens/learning/KnowledgeLibrary.tsx`, `ArchiveScreens.tsx` | Tường kệ sách, mỗi môn một kệ, mỗi bài và nhóm ghi chú một cuốn quay bìa ra ngoài, tên nằm ngang trên nhãn | Mở, lật, đóng sách; tìm không dấu; lọc theo môn và dấu trang. Đồ trên nóc kệ xuất hiện khi đủ 4 và 10 cuốn thật. Ghi chú vẫn sửa ở "Ghi chú của tôi", logic `NotesPanel` không đổi |
| Cùng bạn tiến bộ | `screens/together/TeamQuestsScreen.tsx`, `StudyHall.tsx` | Phòng chung: bảng phấn ghi mục tiêu, bàn dài, pet của từng thành viên | Pet nhảy khi đóng góp thật tăng giữa hai lần tải, cả phòng ăn mừng khi nhiệm vụ hoàn thành. Tải lại mỗi 30 giây khi đang mở một nhiệm vụ |
| Nhiệm vụ công việc | `screens/work/WorkQuestScreen.tsx`, `WorkDesk.tsx` | Bàn dưới cửa sổ thật, nhiệm vụ là giấy note theo màu ưu tiên, kèm chữ. Bản đồ dự án là các đảo render theo chủ đề và `build_stage` của server (`workArt.tsx`), rương render theo trạng thái | Kéo ngang hoặc giữ 220 ms để nhấc note; thả vào khay Xong hay bốn cặp ưu tiên. Nút cũ vẫn còn cho người không kéo. Sửa tên, thời lượng, hạn qua `PATCH /api/tasks/{id}` đã có |
| Hành trình sự nghiệp | `screens/career/CareerJourneyScreen.tsx`, `JourneyMap.tsx` | Con đường qua các vùng đất, mỗi nhóm kỹ năng một vùng, mỗi kỹ năng một cột mốc | Đường chỉ vàng đến chỗ đã làm thật. Pet đứng ở cột mốc kế tiếp và đi tới khi có cột mới. "Nhìn lại hành trình" liệt kê kỹ năng đã xong và huy hiệu |
| Vườn tài chính | `screens/money/MoneyGardenScreen.tsx`, `GardenScene.tsx`, `GardenArt.tsx` | Thung lũng render 3D (`assets/world/money/`) trượt chậm hơn bãi cỏ, dưới trời và thời tiết thật; bãi cỏ cuộn theo hàng cây; sáu loài cây, sáu giai đoạn theo `stage` của server, mỗi cây có bệ đá và bóng đổ, cả bản ngày lẫn đêm; cánh quạt cối xay, ánh sông, bướm và cánh hoa chuyển động; pet của chính người dùng | Chạm cây chỉ chọn cây và làm lá rung; bình tưới "cho vui" chỉ là hoạt ảnh. Tiền chỉ đổi khi ghi khoản tiết kiệm. Bảng gỗ ghi tổng thật; thẻ có Mục tiêu, Đã tiết kiệm, Còn thiếu, các mốc, và thu gọn được |
| Thị trấn Mirabi | `screens/town/TownScreen.tsx`, `townArt.ts` | Một con phố render liền một camera (`assets/world/town/`): đài phun nước và Vườn Cộng đồng theo giai đoạn `stage` của server là các miếng của cùng bức ảnh, sân sự kiện, tiệm quà, sảnh thành tựu, mỗi người bạn một nhà (tối đa 12 trên phố) với pet trước nhà; đèn lồng treo trên cột đèn theo `stage`; trời thật theo giờ và thời tiết (`world/liveSky.tsx`); bản ngày và bản đêm sáng đèn | Dữ liệu và thao tác không đổi: góp xu, gửi quà, báo cáo, ghé thăm |
| Phố bạn bè (Cuộc sống → Bạn bè) | `screens/life/FriendsSpace.tsx`, `streetArt.ts` | Một cảnh render liền có phối cảnh và bóng nắng thật, sáu lô đất dọc con phố. Mỗi người bạn một nhà (ảnh của nhà gồm cả sân và bóng đổ), Pet của họ đứng trước cửa; lô chưa có bạn vẫn là bãi cỏ. Trời và thời tiết là thật | Chạm nhà để vào thăm. Bạn tắt ghé thăm thì nhà có khóa nhỏ và không bấm được |
| Học tập | `screens/learning/SchoolYard.tsx`, `JourneyMap.tsx`, `learnArt.ts` | Sân trường render ở màn chọn môn, có Pet của người học. Bản đồ môn là triền đồi render lặp theo chiều dài bản đồ (`assets/world/learn/`), mỗi bài một bệ đá theo trạng thái thật, giữa hai bài có đá lát | Bấm và mở khoá không đổi, dữ liệu vẫn từ API bài học |
| Trò chơi trong môn học | `games/art/rendered.tsx` và các file `games/art/*` | Thế giới của trò chơi render theo lớp (`assets/world/games/`): rừng, hang, lâu đài, trùm, vũ trụ, bốn thời đại, bản đồ kho báu, phòng thí nghiệm, cánh đồng đêm, con suối của Ghép chữ. Trời và mọi thứ người chơi tương tác vẫn do trò chơi vẽ | Luật chơi và điểm không đổi. Các bảng tự vẽ trong `games/subject/*` và trò chơi dạng thẻ chưa có ảnh render. Số thời đại là `required_count / 3` làm tròn lên (`tripEras`); bài lịch sử dài nhất hiện có 7 câu nên Thời hiện đại chưa xuất hiện trong ván thật, cần bài từ 10 câu |

### Không tạo dữ liệu giả

- **Trạng thái trực tuyến:** nhiệm vụ nhóm không trả về presence. Chấm chỉ hiện với bạn bè có chia sẻ, lấy từ `GET /api/friends`. Thành viên khác không có chấm, không hiện "ngoại tuyến" thay.
- **Đóng góp ẩn:** người tắt chia sẻ vẫn hiện "Ẩn".
- **Dấu trang:** backend chưa có trường này, nên lưu trong `AsyncStorage` theo tài khoản (`mirabi.library.bookmarks:<id>`), chỉ trên thiết bị đó, và màn hình có ghi rõ.
- **Thời tiết:** không có dữ liệu thì chỉ theo giờ, không hiện thời tiết giả.

### Tài sản hình ảnh

Cảnh của năm không gian và Thị trấn Mirabi là **ảnh render 3D thật** kiểu đất sét mềm (path tracing), dựng hoàn toàn bằng code nên không có tài sản bên thứ ba: `mobile/assets/world/`, cách làm ở `mobile/scripts/render-scenes/README.md`, tổng khoảng 1 MB. Màu cảnh theo bảng màu của app (`theme.ts`): tường xanh nhạt, viền trắng, gỗ bạch dương sáng. Những gì sống vẫn do app vẽ đè lên: bầu trời, kính cửa sổ, màn hình laptop, tên sách, biểu tượng cột mốc, nội dung bảng phấn. Pet vẫn là tranh vẽ gốc theo hệ và level.

### Pet

Chỉ dùng tranh và strip có sẵn theo hệ và level, không thêm bộ phận. Study, idle và walk là strip vẽ sẵn. Rest là tranh tĩnh kèm mặt trăng nhỏ vì chưa có strip ngủ. Celebrate là strip vẽ sẵn với hệ Sương và hệ Lửa; các hệ khác chưa nhập strip này nên ăn mừng bằng chuyển động cả thân (`PET_ACTS.celebrate`).

### Kiểm thử

`mobile/__tests__/living-spaces.test.tsx` kiểm tra quy tắc mới (xếp kệ, tìm không dấu, đường vàng, ô thả, không có presence giả, không chuyển tiền khi chạm cây). Chưa chạy trên Android, iOS hay thiết bị tầm trung thật: máy phát triển không có `adb` hay simulator. Trước khi phát hành, cần đi qua bảng ở mục 7 và thêm: kéo note khi đang cuộn, cử chỉ lật trang trên máy thật, FPS của vườn khi trời mưa (`EXPO_PUBLIC_WORLD_PERF=1`).

## Phòng tập trung 3D

`screens/main/FocusRoomArt.tsx` draws the focus room from rendered pictures (`assets/world/focusroom`, `focusPlates.ts`) through `RoomScene`'s `drawing` prop; the personal room, which shares `RoomScene`, does not pass one and is drawn as before. Decorating still works on the same layout and the same rules: walls and floors have a picture in every colour of the catalog, each thing of the starting layout has a picture that moves, mirrors and tilts with it, and anything else (another colour of those, anything found later) keeps its catalog drawing in the room. A room nobody has saved yet (`version` 1 with the old starting colours) is shown in the colours the room was made for; that is display only until the owner saves.

The pet follows the session and nothing else: `idle` with no session running or paused, `study` while focusing, `rest` on a break, and one celebration when a session is finished (`world/useCelebration.ts`). The panel redraws every tick and `FocusRoom` is memoized on those few props, so the timer and the pictures never slow each other. A weak phone keeps the room still; "reduce motion" stops every loop.
