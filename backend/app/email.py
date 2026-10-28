"""Password reset email delivery (EMAIL_BACKEND = disabled | console | smtp)."""
import logging
import smtplib
import ssl
from email.message import EmailMessage
from urllib.parse import urlencode
from .config import settings

log = logging.getLogger("refmi.email")

def email_delivery_configured() -> bool:
    if settings.email_backend == "smtp":
        return bool(settings.smtp_host)
    return settings.email_backend == "console"

def build_reset_message(to: str, token: str) -> EmailMessage:
    minutes = settings.password_reset_minutes
    link = f"{settings.password_reset_url}?{urlencode({'token': token})}" if settings.password_reset_url else ""
    msg = EmailMessage()
    msg["Subject"] = "Mirabi – Đặt lại mật khẩu"
    msg["From"] = settings.email_from
    msg["To"] = to
    lines = [
        "Xin chào,",
        "",
        "Bạn (hoặc ai đó) vừa yêu cầu đặt lại mật khẩu tài khoản Mirabi.",
        "Mở ứng dụng Mirabi, chọn \"Quên mật khẩu?\" → \"Tôi đã có mã\" và dán mã sau:",
        "",
        token,
        "",
    ]
    if link:
        lines += ["Hoặc mở liên kết:", link, ""]
    lines += [f"Mã có hiệu lực trong {minutes} phút và chỉ dùng được một lần.",
              "Nếu bạn không yêu cầu, hãy bỏ qua email này — mật khẩu của bạn vẫn an toàn.", "", "Mirabi"]
    msg.set_content("\n".join(lines))
    return msg

def send_password_reset_email(to: str, token: str) -> None:
    """Runs as a background task so response timing doesn't reveal whether the account exists."""
    msg = build_reset_message(to, token)
    try:
        if settings.email_backend == "console":
            # Development only (rejected in production by config validation).
            log.warning("[EMAIL_BACKEND=console] Password reset email to %s (%s):\n%s", to, msg["Subject"], msg.get_content())
        elif settings.email_backend == "smtp" and settings.smtp_host:
            with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=15) as smtp:
                if settings.smtp_starttls:
                    smtp.starttls(context=ssl.create_default_context())
                if settings.smtp_username:
                    smtp.login(settings.smtp_username, settings.smtp_password)
                smtp.send_message(msg)
        else:
            log.error("Password reset requested but email delivery is not configured")
    except Exception:
        log.exception("Failed to send password reset email")
