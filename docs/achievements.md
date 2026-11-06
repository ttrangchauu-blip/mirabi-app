# Thành tựu

Mã: `backend/app/achievements.py`, `mobile/src/screens/achievements/AchievementsScreen.tsx`, `mobile/src/achievements/`.
Kiểm thử: `backend/tests/test_achievements.py`, `mobile/__tests__/achievements.test.tsx`.

## Nguyên tắc

- **Không có bộ đếm riêng.** Mỗi thành tựu đọc một chỉ số từ bản ghi mà tính năng đã tự ghi và xác nhận (màn chơi backend chấm, phiên Pomodoro server bấm giờ, chuyến đi dạo đã chốt, lượt hoàn thành nhiệm vụ…). Vì vậy một sự kiện không thể tính hai lần (bản ghi gốc đã duy nhất), app không thể gửi tiến độ (không endpoint nào nhận số), và lịch sử cũ được tính ngay lần kiểm tra đầu (`backfilled`).
- **Chỉ lưu cấp đã đạt**: `achievement_unlocks`, khóa duy nhất (user, thành tựu, cấp), không bao giờ xóa. Số đếm giảm (xóa nhiệm vụ, hủy kết bạn) không lấy lại cấp đã đạt.
- **Kiểm tra** (`evaluate`): khi mở màn hình, và khi app hỏi `/unseen` (45 giây một lần, khi quay lại app), tối đa 20 giây một lần (`achievement_checks`). Không cần gắn gì vào từng tính năng; kết quả ghi lúc app đóng được tìm thấy ở lần kiểm tra sau.
- **Phần thưởng**: xu qua `wallet.earn`, mỗi cấp một lần, chỉ khi người dùng bấm "Nhận". Đánh dấu nhận là cập nhật có điều kiện, khóa sự kiện xu `achievement:<id>:<cấp>` là duy nhất, cả hai trong một giao dịch dưới `progression.lock_user`. Đồng 10, Bạc 20, Vàng 40, Kim cương 80, Huyền thoại 150, cột mốc 20.
- **Không EXP.** Cấp và EXP của pet, giới hạn EXP hằng ngày giữ nguyên.
- **Cuộc sống** (16+) chỉ hiện với tài khoản dùng được Mirabi Life, và chỉ cho huy hiệu, không xu: đó là điều người dùng tự khai (tiền, cảm xúc, nhật ký, kỹ năng nghề). Không hiển thị hay so sánh số tiền.
- Nhiệm vụ: mỗi ngày tính tối đa 10 lượt (`DAILY_TASKS_COUNTED`), nhiệm vụ đã xóa không tính, để tạo rồi tick liên tục không lên cấp.

## Nguồn dữ liệu

| Nhóm | Thành tựu (id) | Đọc từ |
|---|---|---|
| Học tập | `lessons`, `subject_expert`, `chapters` | `lesson_api.game_progress` + `lesson_state` trên mọi năm học (không tính ôn Kho lưu trữ) |
| | `learning_days` | `learning_sessions` completed, ngày theo múi giờ của màn |
| Trò chơi | `stages` | `learning_sessions.status = completed` (thua, bỏ dở không tính) |
| | `correct_answers`, `perfect_stages` | `learning_session_items.outcome = first_try` của lượt chính (không tính lượt luyện lại, câu tự đánh giá) trong màn completed |
| | `game_subjects` | môn của các màn completed |
| Pet | `pet_hatched`, `pet_level` | `pet_evolutions.hatched_at`, `level` |
| | `walks`, `walk_finds` | `pet_walks.rewarded_at`, `walk_rewards` (+ `pet_walks.rewards` của chuyến cũ) |
| Nhiệm vụ | `tasks_done`, `habit`, `task_categories` | `user_task_completions` của nhiệm vụ chưa xóa, `activities` `quest_*` |
| Tập trung | `focus_sessions`, `focus_hours`, `focus_days` | `study_sessions.status = completed` (luồng PUT Pomodoro có giới hạn của server, và phiên nhóm). Bản ghi `POST /api/study/sessions` tự khai thời lượng không tính |
| Vườn nhà | `first_planting` | `inventory_events.kind = plant` |
| | `harvests`, `harvest_varieties`, `harvest_rarities` | `garden_harvests` (chỉ cây đã chín, mỗi lần trồng một lần) |
| Bạn bè | `friends` | `friendships.status = accepted` |
| | `group_sessions`, `team_quests` | `study_room_participants.cycles_completed > 0` của phiên đã chốt; `team_quest_members.contribution > 0` của nhiệm vụ completed |
| | `friend_pet_days`, `garden_helper` | ngày khác nhau trong `friend_pet_exp_grants`, `garden_care` (vườn người khác) |
| Cuộc sống | `mood_days`, `journal_days`, `money_days`, `savings_goals`, `career_badges` | `mood_entries`, `journal_entries`, `finance_transactions` (chưa xóa), `finance.goal_balance`, `user_career_achievements` |

"Hoàn thành mọi mục tiêu trong ngày" không có thành tựu riêng: ở Mirabi đó chính là điều kiện để pet đi dạo, nên `walks` đã ghi nhận nó (hai thành tựu sẽ trùng điều kiện).

## API

`GET /api/achievements` (kiểm tra rồi trả toàn bộ), `GET /api/achievements/unseen`, `POST /api/achievements/seen {ids}`, `POST /api/achievements/unlocks/{id}/claim`, `POST /api/achievements/claim-all`. Mọi endpoint chỉ đọc/ghi của người đang đăng nhập.

## Thêm một thành tựu

Thêm một `_a(...)` vào `ACHIEVEMENTS` và, nếu cần, một phương thức chỉ số trong `_Measure` đọc bản ghi đã xác nhận. Id và số cấp được lưu: chỉ thêm, không đổi số. `test_the_catalog_is_well_formed` kiểm tra ngưỡng tăng dần, nhóm, chỉ số có thật và không có hai thành tựu cùng điều kiện.

## Chưa làm (thiếu dữ liệu đáng tin)

- Album, Sổ tay, Bảng tin: chỉ là thao tác mở/viết, dễ spam, không đo được kết quả có ý nghĩa.
- Ghé phòng bạn (`visit_logs`, lời chào): chỉ là mở màn hình hoặc bấm; đã có `friend_pet_days` (chơi với pet, giới hạn một lần/bạn/ngày).
- Góc thư giãn (`relaxation_sessions`): thời lượng do app tự khai.
- Dự án Work Quest hoàn thành: người dùng tự đặt trạng thái; nhiệm vụ trong dự án đã được tính ở `tasks_done`.
- Phiên tập trung cũ ghi qua `POST /api/study/sessions`: thời lượng do app khai, không tính.
- Khung hồ sơ: hệ thống chưa có, nên không làm phần thưởng loại này.
