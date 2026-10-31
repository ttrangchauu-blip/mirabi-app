/** Mirabi Life (Nhiệm vụ công việc, Góc thư giãn, Phiêu lưu cuộc sống, Vườn tài chính, Thị trấn Mirabi, Hành trình sự
 * nghiệp) is for ages 16 and over: the age given at registration or in "Độ tuổi & lớp học". The backend enforces the
 * same rule (backend/app/life_access.py); the app only hides what the backend would refuse. */
export const LIFE_MIN_AGE = 16;

export const lifeEligible = (user: { age?: number | null } | null | undefined) =>
  user?.age != null && user.age >= LIFE_MIN_AGE;
