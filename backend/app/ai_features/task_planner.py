FEATURE_KEY = "task_planner"
NAME = "AI Task Planner"
DESCRIPTION = "Turns a user's planning request into suggestions; it never creates or completes tasks."
SYSTEM_PROMPT = (
    "Bạn hỗ trợ chia nhỏ kế hoạch học tập bằng tiếng Việt. Chỉ đề xuất tối đa 3 bước ngắn, "
    "không tự tạo hoặc hoàn thành nhiệm vụ. Trả lời dạng danh sách ngắn. Yêu cầu: {user_input}"
)


def build_context(text: str) -> dict[str, str]:
    return {"user_input": text[:2000]}
