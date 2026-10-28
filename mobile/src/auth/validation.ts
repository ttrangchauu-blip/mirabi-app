// Mirrors backend/app/schemas.py so users get instant feedback; the server still validates everything.
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const normalizeEmail = (value: string) => value.trim().toLowerCase();

export function validateEmail(value: string): string | undefined {
  const email = value.trim();
  if (!email) return 'Vui lòng nhập email.';
  if (email.length > 254 || !EMAIL_RE.test(email)) return 'Email không hợp lệ. Ví dụ: ban@example.com';
}

export function validateLoginPassword(value: string): string | undefined {
  if (!value) return 'Vui lòng nhập mật khẩu.';
  if (value.length > PASSWORD_MAX) return `Mật khẩu tối đa ${PASSWORD_MAX} ký tự.`;
}

export function validateNewPassword(value: string): string | undefined {
  if (!value) return 'Vui lòng nhập mật khẩu.';
  if (value.length < PASSWORD_MIN) return `Mật khẩu cần ít nhất ${PASSWORD_MIN} ký tự.`;
  if (value.length > PASSWORD_MAX) return `Mật khẩu tối đa ${PASSWORD_MAX} ký tự.`;
  if (!/[A-Za-z]/.test(value) || !/\d/.test(value)) return 'Mật khẩu cần có cả chữ cái và chữ số.';
  if (value.trim() !== value) return 'Mật khẩu không được bắt đầu hoặc kết thúc bằng khoảng trắng.';
}

export function validatePasswordConfirmation(password: string, confirmation: string): string | undefined {
  if (!confirmation) return 'Vui lòng nhập lại mật khẩu.';
  if (password !== confirmation) return 'Mật khẩu nhập lại không khớp.';
}

export function validateDisplayName(value: string): string | undefined {
  if (value.trim().length > 80) return 'Tên của bạn tối đa 80 ký tự.';
}

export const PET_NAME_MAX = 30;

export function validatePetName(value: string): string | undefined {
  const name = value.trim();
  if (!name) return 'Hãy đặt cho bé một cái tên nhé.';
  if (name.length > PET_NAME_MAX) return `Tên thú cưng tối đa ${PET_NAME_MAX} ký tự.`;
  if (/[\u0000-\u001F\u007F]/.test(name)) return 'Tên thú cưng chứa ký tự không hợp lệ.';
}
