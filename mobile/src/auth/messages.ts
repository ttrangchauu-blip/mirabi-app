import { ApiError, NetworkError } from '../api/client';

const BY_CODE: Record<string, string> = {
  invalid_credentials: 'Email hoặc mật khẩu không đúng. Vui lòng thử lại.',
  account_disabled: 'Tài khoản này đã bị tạm khóa. Vui lòng liên hệ hỗ trợ.',
  email_taken: 'Email này đã được đăng ký. Hãy đăng nhập hoặc dùng email khác.',
  rate_limited: 'Bạn đã thử quá nhiều lần. Vui lòng đợi vài phút rồi thử lại.',
  email_not_configured: 'Tính năng khôi phục mật khẩu hiện chưa sẵn sàng. Vui lòng liên hệ hỗ trợ.',
  invalid_reset_token: 'Mã đặt lại không hợp lệ hoặc đã hết hạn. Hãy yêu cầu mã mới.',
  session_expired: 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.',
  validation_error: 'Thông tin chưa hợp lệ. Vui lòng kiểm tra lại.',
  pet_not_adopted: 'Hãy chọn và đặt tên cho thú cưng trước nhé.',
  quests_incomplete: 'Hãy hoàn thành mọi nhiệm vụ hằng ngày trước nhé.',
  walk_in_progress: 'Bạn đồng hành đang đi dạo rồi.',
  walk_not_returned: 'Bạn đồng hành chưa về đâu, đợi thêm chút nhé.',
  already_walked: 'Hôm nay bạn đồng hành đã đi dạo rồi. Hẹn bạn ngày mai!',
  nothing_to_collect: 'Chưa có món quà nào đang chờ bạn.',
  // Study Together
  user_not_found: 'Không tìm thấy người dùng này.',
  cannot_friend_self: 'Bạn không thể tự kết bạn với chính mình.',
  user_blocked: 'Bạn đang chặn người này. Hãy bỏ chặn trước khi gửi lời mời.',
  already_friends: 'Hai bạn đã là bạn bè rồi.',
  friend_request_exists: 'Bạn đã gửi lời mời kết bạn cho người này rồi.',
  friend_request_cooldown: 'Hãy đợi một thời gian trước khi gửi lại lời mời kết bạn.',
  friend_request_not_found: 'Lời mời kết bạn không còn tồn tại.',
  friend_request_not_pending: 'Lời mời này đã được xử lý.',
  not_request_recipient: 'Chỉ người nhận mới có thể chấp nhận lời mời.',
  not_friends: 'Hai bạn hiện không phải là bạn bè.',
  query_too_short: 'Hãy nhập ít nhất 2 ký tự để tìm kiếm.',
  room_not_found: 'Không tìm thấy phòng học. Hãy kiểm tra lại mã phòng.',
  room_full: 'Phòng học đã đủ thành viên.',
  room_closed: 'Phòng học này đã đóng.',
  room_invite_only: 'Đây là phòng riêng tư, bạn cần được mời để tham gia.',
  room_unavailable: 'Bạn không thể tham gia phòng học này.',
  already_in_another_room: 'Bạn đang ở trong một phòng học khác. Hãy rời phòng đó trước nhé.',
  not_room_host: 'Chỉ chủ phòng mới có thể thực hiện thao tác này.',
  not_room_member: 'Hãy tham gia phòng học trước nhé.',
  message_not_found: 'Tin nhắn này không còn tồn tại.',
  not_message_owner: 'Bạn chỉ có thể thu hồi tin nhắn của mình.',
  session_in_progress: 'Không thể đổi thời lượng khi phiên học đang diễn ra.',
  max_members_too_low: 'Phòng đang có nhiều thành viên hơn con số này.',
  no_active_session: 'Hiện không có phiên học nào đang diễn ra.',
  session_not_running: 'Phiên học không ở trạng thái đang chạy.',
  session_not_paused: 'Phiên học không ở trạng thái tạm dừng.',
  session_not_found: 'Không tìm thấy phiên học này.',
  invitation_not_found: 'Lời mời không còn tồn tại.',
  invitation_not_pending: 'Lời mời này không còn hiệu lực.',
  invitation_expired: 'Lời mời đã hết hạn.',
  quest_not_found: 'Không tìm thấy nhiệm vụ nhóm.',
  quest_already_active: 'Nhiệm vụ này đang diễn ra trong phòng rồi.',
  quest_not_active: 'Nhiệm vụ nhóm này đã kết thúc.',
  cannot_report_self: 'Bạn không thể báo cáo chính mình.',
  // Friend room visits
  room_visits_disabled: 'Bạn ấy đang tắt chế độ cho ghé thăm phòng.',
  study_invites_disabled: 'Bạn ấy đang tắt nhận lời mời học.',
  greeting_cooldown: 'Bạn vừa gửi rồi, lát nữa thử lại nhé.',
  visit_daily_limit: 'Hôm nay bạn đã gửi đủ lời chào rồi. Hẹn mai nhé!',
  already_member: 'Bạn ấy đã ở trong phòng học của bạn rồi.',
  try_again: 'Có lỗi tạm thời, bạn hãy thử lại nhé.',
  // Learning games (Anh & Toán)
  lesson_not_found: 'Không tìm thấy bài học này.',
  topic_not_found: 'Không tìm thấy chủ đề này.',
  open_session_exists: 'Bạn đang có một chặng chưa xong. Hãy tiếp tục hoặc kết thúc chặng đó trước.',
  session_paused: 'Chặng học đang tạm dừng.',
  session_ended: 'Chặng học này đã kết thúc.',
  session_incomplete: 'Hãy hoàn thành mọi lượt (và luyện lại câu đã xem đáp án) trước nhé.',
  session_not_finished: 'Chặng học vẫn đang diễn ra.',
  turn_not_found: 'Lượt chơi không còn tồn tại.',
  turn_not_open: 'Lượt chơi này đã xong.',
  invalid_answer_format: 'Hãy nhập đáp án hợp lệ. Câu này chưa bị tính sai.',
  too_many_attempts: 'Bạn đã thử quá nhiều lần cho câu này. Hãy xem đáp án nhé.',
  no_more_hints: 'Đã hết gợi ý cho câu này.',
  miss_not_allowed: 'Mục tiêu đang đứng chờ bạn.',
  miss_too_early: 'Mục tiêu chưa tới nơi.',
  idempotency_conflict: 'Thao tác bị trùng, hãy thử lại.',
  concurrent_update: 'Chặng học vừa thay đổi ở nơi khác, hãy thử lại.',
  nothing_to_review: 'Chủ đề này không còn gì cần ôn. Giỏi lắm!',
  no_words_to_practice: 'Không còn từ nào cần ôn để luyện. Giỏi lắm!',
  word_not_found: 'Không tìm thấy từ này trong lịch sử học của bạn.',
  duration_limit: 'Không thể kéo dài chặng học thêm nữa.',
  variant_not_supported: 'Bài học này không có trò chơi đó.',
  invalid_transition: 'Không thể thực hiện thao tác này lúc này.',
  invalid_timezone: 'Múi giờ của thiết bị không hợp lệ.',
};

export const SESSION_EXPIRED_MESSAGE = BY_CODE.session_expired;

/** Map any thrown error to a user-facing Vietnamese message. Never surfaces raw server text. */
export function errorMessage(error: unknown): string {
  if (error instanceof NetworkError) {
    if (error.reason === 'timeout') return 'Máy chủ phản hồi quá lâu. Vui lòng thử lại.';
    if (error.reason === 'config') return 'Ứng dụng chưa được cấu hình kết nối an toàn tới máy chủ.';
    return 'Không thể kết nối tới máy chủ. Hãy kiểm tra mạng rồi thử lại.';
  }
  if (error instanceof ApiError) {
    if (BY_CODE[error.code]) return BY_CODE[error.code];
    if (error.status >= 500) return 'Máy chủ đang gặp sự cố. Vui lòng thử lại sau.';
  }
  return 'Đã có lỗi xảy ra. Vui lòng thử lại.';
}

export const isSessionExpired = (error: unknown) => error instanceof ApiError && error.code === 'session_expired';
