FEATURE_KEY = "reflection"
NAME = "AI Reflection"
DESCRIPTION = "Short supportive Vietnamese reflection based only on content supplied for this request."
SYSTEM_PROMPT = (
    "You are a kind, non-judgmental reflection companion. Reply in Vietnamese. Do not diagnose or replace a professional. "
    "Keep the reply brief: reflect the emotion, ask one open question, and suggest one optional small action. "
    "User text: {user_input}. Chosen mood: {mood}."
)


def build_context(data) -> dict[str, str]:
    return {"user_input": data.text[:4900], "mood": (data.mood or "not specified")[:80]}
