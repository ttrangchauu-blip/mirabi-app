import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';
import App from '../App';
import { setSession } from '../src/api/client';
import { deferred, mockServer, networkDown, tokens, USER } from '../test/mockServer';
import { REGISTERED_MESSAGE } from '../src/screens/AuthFlow';
import { petById } from '../src/pets';

const store: Map<string, string> = (SecureStore as any).__store;
const SESSION_KEY = 'refmi.session.v1';
const storedSession = () => (store.get(SESSION_KEY) ? JSON.parse(store.get(SESSION_KEY)!) : null);
const LOGIN_BUTTON = { name: 'Bắt đầu hành trình ✨' };

beforeEach(() => {
  store.clear();
  setSession(null);
});
afterEach(() => (Alert.alert as jest.Mock).mockRestore?.());

async function renderSignedOut() {
  render(<App />);
  // First render also waits for the fonts to load, which can be slow on a cold Jest cache.
  await screen.findByText('Chào mừng bạn trở lại!', {}, { timeout: 5000 });
}

/** "Độ tuổi" is a number picker: open it and tap an age. */
function chooseAge(age: number) {
  fireEvent.press(screen.getByRole('button', { name: 'Độ tuổi' }));
  fireEvent.press(screen.getByRole('radio', { name: `${age} tuổi` }));
}

function fillLogin(email: string, password: string) {
  fireEvent.changeText(screen.getByLabelText('Email'), email);
  fireEvent.changeText(screen.getByLabelText('Mật khẩu'), password);
}

describe('login screen', () => {
  it('renders every element of the login form', async () => {
    mockServer({});
    await renderSignedOut();
    expect(screen.getByLabelText('Mirabi')).toBeTruthy();
    expect(screen.getByText('Mirabi đang chờ cùng bạn khám phá những điều mới mẻ.')).toBeTruthy();
    // Only the app logo on the login screen; no pet companion.
    expect(screen.queryByLabelText(/đồng hành của bạn/)).toBeNull();
    expect(screen.getByLabelText('Email')).toBeTruthy();
    expect(screen.getByLabelText('Mật khẩu')).toBeTruthy();
    expect(screen.getByText('Quên mật khẩu?')).toBeTruthy();
    expect(screen.getByRole('button', LOGIN_BUTTON)).toBeTruthy();
    expect(screen.getByLabelText('Chưa có tài khoản? Đăng ký ngay')).toBeTruthy();
  });

  it('validates empty fields without calling the API', async () => {
    const server = mockServer({});
    await renderSignedOut();
    fireEvent.press(screen.getByRole('button', LOGIN_BUTTON));
    expect(await screen.findByText('Vui lòng nhập email.')).toBeTruthy();
    expect(screen.getByText('Vui lòng nhập mật khẩu.')).toBeTruthy();
    expect(server.callsTo('POST /api/auth/login')).toHaveLength(0);
  });

  it('validates the email format', async () => {
    const server = mockServer({});
    await renderSignedOut();
    fillLogin('aqua@', 'Sparkle123');
    fireEvent.press(screen.getByRole('button', LOGIN_BUTTON));
    expect(await screen.findByText('Email không hợp lệ. Ví dụ: ban@example.com')).toBeTruthy();
    expect(server.callsTo('POST /api/auth/login')).toHaveLength(0);
  });

  it('toggles password visibility', async () => {
    mockServer({});
    await renderSignedOut();
    const input = screen.getByLabelText('Mật khẩu');
    expect(input.props.secureTextEntry).toBe(true);
    fireEvent.press(screen.getByLabelText('Hiện mật khẩu'));
    expect(screen.getByLabelText('Mật khẩu').props.secureTextEntry).toBe(false);
    fireEvent.press(screen.getByLabelText('Ẩn mật khẩu'));
    expect(screen.getByLabelText('Mật khẩu').props.secureTextEntry).toBe(true);
  });

  it('shows a loading state, sends one request for repeated taps, then navigates home', async () => {
    const pending = deferred<{ status: number; body: unknown }>();
    const server = mockServer({ 'POST /api/auth/login': () => pending.promise });
    await renderSignedOut();
    fillLogin(' Aqua@Example.com ', 'Sparkle123');
    const button = screen.getByRole('button', LOGIN_BUTTON);
    fireEvent.press(button);
    fireEvent.press(button);
    fireEvent.press(button);

    const loading = await screen.findByRole('button', { name: 'Đang đăng nhập…' });
    expect(loading.props.accessibilityState).toMatchObject({ busy: true, disabled: true });
    expect(server.callsTo('POST /api/auth/login')).toHaveLength(1);
    expect(server.callsTo('POST /api/auth/login')[0].body).toEqual({ email: 'aqua@example.com', password: 'Sparkle123' });

    pending.resolve({ status: 200, body: { ...tokens(1), login_streak: { current_streak: 1, longest_streak: 1, last_login_date: '2030-03-10',
      should_show_popup: true, daily_exp_awarded: 2, milestone_exp_awarded: 0, already_claimed: false } } });
    // Success is a toast that stays visible while the app opens; the streak itself is in the daily popup.
    expect(await screen.findByRole('alert', { name: 'Đăng nhập thành công!' })).toBeTruthy();
    expect(screen.queryByText('Đăng nhập thành công ✓')).toBeNull();
    // The first login of the day opens the streak popup over Home.
    fireEvent.press(await screen.findByRole('button', { name: 'Tiếp tục' }));
    expect(await screen.findByText(`Chào bạn, ${USER.display_name}!`)).toBeTruthy();
    expect(storedSession()).toEqual({ accessToken: 'access-1', refreshToken: tokens(1).refresh_token });
    // Authenticated requests carry the new access token.
    await waitFor(() => expect(server.callsTo('GET /api/dashboard')).toHaveLength(1));
    expect(server.callsTo('GET /api/dashboard')[0].headers.Authorization).toBe('Bearer access-1');
  });

  it('shows a generic error for wrong credentials, keeps the email, and allows retry', async () => {
    let attempt = 0;
    mockServer({
      'POST /api/auth/login': () => (++attempt === 1
        ? { status: 401, body: { detail: 'Email or password is incorrect', code: 'invalid_credentials' } }
        : { status: 200, body: tokens(1) }),
    });
    await renderSignedOut();
    fillLogin('aqua@example.com', 'Wrong12345');
    fireEvent.press(screen.getByRole('button', LOGIN_BUTTON));
    expect(await screen.findByText(/Email hoặc mật khẩu không đúng/)).toBeTruthy();
    expect(screen.getByLabelText('Email').props.value).toBe('aqua@example.com');
    expect(screen.getByLabelText('Mật khẩu').props.value).toBe('');
    expect(storedSession()).toBeNull();

    fireEvent.changeText(screen.getByLabelText('Mật khẩu'), 'Sparkle123');
    fireEvent.press(screen.getByRole('button', LOGIN_BUTTON));
    expect(await screen.findByText(`Chào bạn, ${USER.display_name}!`)).toBeTruthy();
  });

  it('reports network failures and succeeds on retry without retyping', async () => {
    let online = false;
    mockServer({ 'POST /api/auth/login': () => (online ? { status: 200, body: tokens(1) } : networkDown()) });
    await renderSignedOut();
    fillLogin('aqua@example.com', 'Sparkle123');
    fireEvent.press(screen.getByRole('button', LOGIN_BUTTON));
    expect(await screen.findByText(/Không thể kết nối tới máy chủ/)).toBeTruthy();
    expect(screen.getByLabelText('Mật khẩu').props.value).toBe('Sparkle123');

    online = true;
    fireEvent.press(screen.getByRole('button', LOGIN_BUTTON));
    expect(await screen.findByText(`Chào bạn, ${USER.display_name}!`)).toBeTruthy();
  });

  it('maps rate limiting to a friendly message', async () => {
    mockServer({ 'POST /api/auth/login': { status: 429, body: { detail: 'Too many attempts', code: 'rate_limited' } } });
    await renderSignedOut();
    fillLogin('aqua@example.com', 'Sparkle123');
    fireEvent.press(screen.getByRole('button', LOGIN_BUTTON));
    expect(await screen.findByText(/Bạn đã thử quá nhiều lần/)).toBeTruthy();
  });
});

describe('registration', () => {
  it('validates, registers, then returns to a pre-filled login screen', async () => {
    const server = mockServer({
      'POST /api/auth/register': { status: 201, body: USER },
      'POST /api/auth/login': { status: 200, body: tokens(1) },
    });
    await renderSignedOut();
    fireEvent.press(screen.getByLabelText('Chưa có tài khoản? Đăng ký ngay'));
    await screen.findByText('Tạo tài khoản mới');

    fireEvent.changeText(screen.getByLabelText('Email'), 'aqua@example.com');
    fireEvent.changeText(screen.getByLabelText('Mật khẩu'), 'onlyletters');
    fireEvent.changeText(screen.getByLabelText('Nhập lại mật khẩu'), 'different1');
    fireEvent.press(screen.getByRole('button', { name: 'Tạo tài khoản ✨' }));
    expect(await screen.findByText('Mật khẩu cần có cả chữ cái và chữ số.')).toBeTruthy();
    expect(screen.getByText('Mật khẩu nhập lại không khớp.')).toBeTruthy();
    // Age is required and nothing is chosen in advance; the suggested grade only appears once an age is picked.
    expect(screen.getByText('Vui lòng chọn độ tuổi.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Độ tuổi' }).props.accessibilityValue).toEqual({ text: 'Chưa chọn' });
    expect(screen.queryByText('Lớp học gợi ý')).toBeNull();
    expect(server.callsTo('POST /api/auth/register')).toHaveLength(0);

    chooseAge(11);
    expect(screen.queryByText('Vui lòng chọn độ tuổi.')).toBeNull();
    expect(screen.getByText('Lớp học gợi ý')).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Lớp 6, gợi ý theo tuổi' }).props.accessibilityState.checked).toBe(true);
    // Only grades plausible at 11 are offered, never grade 12 or "Sinh viên".
    expect(screen.queryByRole('radio', { name: 'Lớp 12' })).toBeNull();
    expect(screen.queryByRole('radio', { name: 'Sinh viên' })).toBeNull();
    fireEvent.press(screen.getByRole('radio', { name: 'Lớp 5' })); // the user is actually in grade 5
    expect(screen.getByRole('radio', { name: 'Lớp 5' }).props.accessibilityState.checked).toBe(true);

    fireEvent.changeText(screen.getByLabelText('Tên của bạn (không bắt buộc)'), 'Aqua');
    fireEvent.changeText(screen.getByLabelText('Mật khẩu'), 'Sparkle123');
    fireEvent.changeText(screen.getByLabelText('Nhập lại mật khẩu'), 'Sparkle123');
    fireEvent.press(screen.getByRole('button', { name: 'Tạo tài khoản ✨' }));
    expect(server.callsTo('POST /api/auth/register')[0].body).toEqual({ email: 'aqua@example.com', password: 'Sparkle123', display_name: 'Aqua',
      age: 11, school_grade: 'grade5' });

    // Registration doesn't sign in: back to login with everything filled in.
    expect(await screen.findByRole('alert', { name: REGISTERED_MESSAGE })).toBeTruthy();
    expect(screen.getByText('Chào mừng bạn trở lại!')).toBeTruthy();
    expect(screen.getByLabelText('Email').props.value).toBe('aqua@example.com');
    expect(screen.getByLabelText('Mật khẩu').props.value).toBe('Sparkle123');
    expect(storedSession()).toBeNull();

    fireEvent.press(screen.getByRole('button', LOGIN_BUTTON));
    expect(await screen.findByText(`Chào bạn, ${USER.display_name}!`)).toBeTruthy();
    expect(server.callsTo('POST /api/auth/login')[0].body).toEqual({ email: 'aqua@example.com', password: 'Sparkle123' });
  });

  it('explains a duplicate email', async () => {
    mockServer({ 'POST /api/auth/register': { status: 409, body: { detail: 'Email already registered', code: 'email_taken' } } });
    await renderSignedOut();
    fireEvent.press(screen.getByLabelText('Chưa có tài khoản? Đăng ký ngay'));
    await screen.findByText('Tạo tài khoản mới');
    fireEvent.changeText(screen.getByLabelText('Email'), 'aqua@example.com');
    fireEvent.changeText(screen.getByLabelText('Mật khẩu'), 'Sparkle123');
    fireEvent.changeText(screen.getByLabelText('Nhập lại mật khẩu'), 'Sparkle123');
    chooseAge(30);
    expect(screen.getByRole('radio', { name: 'Người đi làm/Học tự do, gợi ý theo tuổi' }).props.accessibilityState.checked).toBe(true);
    fireEvent.press(screen.getByRole('button', { name: 'Tạo tài khoản ✨' }));
    expect(await screen.findByText(/Email này đã được đăng ký/)).toBeTruthy();
  });
});

describe('first sign-in: adopt a pet, then the welcome tour', () => {
  const NEWBIE = { ...USER, pet: 'fox', pet_name: null, onboarded: false };

  /** Server whose user record changes as the client adopts the pet and finishes the tour. */
  function firstLoginServer() {
    let user: any = NEWBIE;
    const server = mockServer({
      'POST /api/auth/login': () => ({ status: 200, body: { ...tokens(1), user } }),
      'PUT /api/pet': (req) => { user = { ...user, pet: req.body.pet, pet_name: req.body.name }; return { status: 200, body: user }; },
      'POST /api/onboarding/complete': () => { user = { ...user, onboarded: true }; return { status: 200, body: user }; },
      'GET /api/dashboard': () => ({ status: 200, body: { user, study: { total_minutes: 0, today_sessions: 0, daily_goal: 3 } } }),
    });
    return server;
  }

  async function signIn() {
    await renderSignedOut();
    fillLogin('aqua@example.com', 'Sparkle123');
    fireEvent.press(screen.getByRole('button', LOGIN_BUTTON));
    await screen.findByText('Chọn và đặt tên thú cưng');
  }

  it('picks and names a pet on one screen, walks through the tour, and lands home with the pet', async () => {
    const server = firstLoginServer();
    await signIn();
    // Water dolphin is suggested first.
    expect(screen.getByRole('radio', { name: 'Sóng, cá heo nước, hệ Nước' }).props.accessibilityState).toMatchObject({ checked: true });
    expect(screen.getByLabelText('Tên cho bé cá heo nước').props.value).toBe('Sóng');

    fireEvent.press(screen.getByRole('radio', { name: 'Hỏa, cáo lửa, hệ Lửa' }));
    expect(screen.getByRole('radio', { name: 'Hỏa, cáo lửa, hệ Lửa' }).props.accessibilityState).toMatchObject({ checked: true });
    expect(screen.getByLabelText('Hỏa, cáo lửa hệ Lửa, đồng hành của bạn')).toBeTruthy();
    // The suggested name follows the chosen pet until the user types their own.
    expect(screen.getByLabelText('Tên cho bé cáo lửa').props.value).toBe('Hỏa');
    fireEvent.changeText(screen.getByLabelText('Tên cho bé cáo lửa'), '  Bé Hỏa ');
    fireEvent.press(screen.getByRole('button', { name: 'Đón bé về nhà ✨' }));

    expect(await screen.findByText('Chào mừng đến với Mirabi!')).toBeTruthy();
    expect(server.callsTo('PUT /api/pet')[0].body).toEqual({ pet: 'fox', name: 'Bé Hỏa' });
    expect(screen.getByText('Mình là Bé Hỏa, rất vui được gặp bạn!')).toBeTruthy();
    for (const title of ['Trang chủ & nhiệm vụ hằng ngày', 'Học tập: Pomodoro & khóa học', 'Phòng cá nhân của pet', 'Bạn bè', 'Tiện ích: phòng, cửa hàng & cài đặt']) {
      fireEvent.press(screen.getByRole('button', { name: 'Tiếp tục' }));
      expect(await screen.findByText(title)).toBeTruthy();
    }
    expect(server.callsTo('POST /api/onboarding/complete')).toHaveLength(0);
    fireEvent.press(screen.getByRole('button', { name: 'Bắt đầu thôi ✨' }));

    expect(await screen.findByText(`Chào bạn, ${USER.display_name}!`)).toBeTruthy();
    expect(server.callsTo('POST /api/onboarding/complete')).toHaveLength(1);
    expect(await screen.findByText('Bé Hỏa')).toBeTruthy();
    expect(screen.getByLabelText('Bé Hỏa, hệ Lửa')).toBeTruthy();
    expect(screen.getByText('Hệ Lửa')).toBeTruthy();
  });

  it('requires a pet name and keeps the user\'s own text when switching pets', async () => {
    const server = firstLoginServer();
    await signIn();
    fireEvent.changeText(screen.getByLabelText('Tên cho bé cá heo nước'), '   ');
    fireEvent.press(screen.getByRole('button', { name: 'Đón bé về nhà ✨' }));
    expect(await screen.findByText('Hãy đặt cho bé một cái tên nhé.')).toBeTruthy();
    expect(server.callsTo('PUT /api/pet')).toHaveLength(0);

    fireEvent.press(screen.getByRole('radio', { name: 'Tia, thỏ điện, hệ Điện' }));
    // The user's own (blank) text is kept rather than overwritten with a suggestion.
    expect(screen.getByLabelText('Tên cho bé thỏ điện').props.value).toBe('   ');
  });

  it('can skip the tour', async () => {
    const server = firstLoginServer();
    await signIn();
    fireEvent.press(screen.getByRole('button', { name: 'Đón bé về nhà ✨' }));
    fireEvent.press(await screen.findByLabelText('Bỏ qua hướng dẫn'));
    expect(await screen.findByText(`Chào bạn, ${USER.display_name}!`)).toBeTruthy();
    expect(server.callsTo('POST /api/onboarding/complete')).toHaveLength(1);
  });

  it('shows the pet picker again when a signed-in user has no pet yet', async () => {
    store.set(SESSION_KEY, JSON.stringify({ accessToken: 'access-1', refreshToken: tokens(1).refresh_token }));
    mockServer({ 'GET /api/auth/me': { status: 200, body: NEWBIE } });
    render(<App />);
    expect(await screen.findByText('Chọn và đặt tên thú cưng')).toBeTruthy();
  });
});

describe('password recovery', () => {
  it('requests a code, then resets and returns to login', async () => {
    const server = mockServer({
      'POST /api/auth/password/forgot': { status: 202, body: { message: 'sent' } },
      'POST /api/auth/password/reset': { status: 200, body: { message: 'done' } },
    });
    await renderSignedOut();
    fillLogin('aqua@example.com', '');
    fireEvent.press(screen.getByText('Quên mật khẩu?'));
    await screen.findByText('Gửi mã đặt lại');
    expect(screen.getByLabelText('Email').props.value).toBe('aqua@example.com');
    fireEvent.press(screen.getByRole('button', { name: 'Gửi mã đặt lại' }));
    expect(await screen.findByText(/Mirabi đã gửi mã đặt lại mật khẩu/)).toBeTruthy();

    fireEvent.press(screen.getByText('Tôi đã có mã'));
    fireEvent.changeText(screen.getByLabelText('Mã đặt lại'), ' reset-code-0123456789abcdef ');
    fireEvent.changeText(screen.getByLabelText('Mật khẩu mới'), 'NewSparkle456');
    fireEvent.changeText(screen.getByLabelText('Nhập lại mật khẩu mới'), 'NewSparkle456');
    fireEvent.press(screen.getByRole('button', { name: 'Đặt lại mật khẩu' }));
    expect(await screen.findByText(/Đã đặt lại mật khẩu/)).toBeTruthy();
    expect(screen.getByText('Chào mừng bạn trở lại!')).toBeTruthy();
    expect(server.callsTo('POST /api/auth/password/reset')[0].body).toEqual({ token: 'reset-code-0123456789abcdef', new_password: 'NewSparkle456' });
  });

  it('says so when email delivery is not configured', async () => {
    mockServer({ 'POST /api/auth/password/forgot': { status: 503, body: { detail: 'x', code: 'email_not_configured' } } });
    await renderSignedOut();
    fireEvent.press(screen.getByText('Quên mật khẩu?'));
    fireEvent.changeText(await screen.findByLabelText('Email'), 'aqua@example.com');
    fireEvent.press(screen.getByRole('button', { name: 'Gửi mã đặt lại' }));
    expect(await screen.findByText(/chưa sẵn sàng/)).toBeTruthy();
  });
});

describe('main app', () => {
  it('has the five main sections and Học tập opens on the subject screen; Học tự chọn is the focus space', async () => {
    store.set(SESSION_KEY, JSON.stringify({ accessToken: 'access-1', refreshToken: tokens(1).refresh_token }));
    mockServer({ 'GET /api/auth/me': { status: 200, body: USER },
      'GET /api/learning/catalog': { status: 200, body: { subjects: [], default_duration_minutes: 25 } },
      'GET /api/learning/sessions/current': { status: 200, body: { session: null } } });
    render(<App />);
    await screen.findByText(`Chào bạn, ${USER.display_name}!`);
    expect(screen.getAllByRole('tab', { name: /Trang chủ|Học tập|Phòng cá nhân|Bạn bè|Tiện ích/ })).toHaveLength(5);
    expect(screen.queryByRole('button', { name: /^Khóa học/ })).toBeNull();

    fireEvent.press(screen.getByRole('tab', { name: 'Học tập' }));
    expect(await screen.findByText('Chọn môn học')).toBeTruthy();
    expect(screen.queryByTestId('mirabi-focus-space')).toBeNull();
    fireEvent.press(screen.getByRole('button', { name: /^Học tự chọn\./ }));
    expect(await screen.findByTestId('mirabi-focus-space')).toBeTruthy();
    expect(screen.queryByRole('tab', { name: 'Tập trung' })).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Khóa học' })).toBeNull();

    // Back returns to the subjects; so does every visit to Học tập from the menu.
    fireEvent.press(screen.getByRole('button', { name: 'Quay lại' }));
    expect(await screen.findByText('Chọn môn học')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: /^Học tự chọn\./ }));
    await screen.findByTestId('mirabi-focus-space');
    fireEvent.press(screen.getByRole('tab', { name: 'Học tập' }));
    expect(await screen.findByText('Chọn môn học')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: /^Toán\./ }));
    expect(await screen.findByText('Chọn trò chơi')).toBeTruthy();
    fireEvent.press(screen.getByRole('tab', { name: 'Học tập' }));
    expect(await screen.findByText('Chọn môn học')).toBeTruthy();
  });

  it('opens the profile with personal info and the pet from the Home avatar', async () => {
    store.set(SESSION_KEY, JSON.stringify({ accessToken: 'access-1', refreshToken: tokens(1).refresh_token }));
    mockServer({ 'GET /api/auth/me': { status: 200, body: USER } });
    render(<App />);
    await screen.findByText(`Chào bạn, ${USER.display_name}!`);

    fireEvent.press(screen.getByRole('button', { name: 'Xem hồ sơ và thú cưng' }));
    expect(await screen.findByText('Hồ sơ của bạn')).toBeTruthy();
    expect(screen.getByText(USER.email)).toBeTruthy();
    // The profile shows the companion; its walk and room live on Home.
    const pet = petById(USER.pet);
    expect(screen.getByText(`${pet.species[0].toUpperCase()}${pet.species.slice(1)} · ${pet.tagline}`)).toBeTruthy();

    fireEvent.press(screen.getByRole('button', { name: 'Quay lại' }));
    expect(await screen.findByText(`Chào bạn, ${USER.display_name}!`)).toBeTruthy();
  });

  it('shows daily tasks as a progress card that expands to the task list', async () => {
    store.set(SESSION_KEY, JSON.stringify({ accessToken: 'access-1', refreshToken: tokens(1).refresh_token }));
    const daily_quests = [
      { id: 'learning', title: 'Học một điều mới trong 15 phút', progress: 1, target: 1 },
      { id: 'health', title: 'Vận động ít nhất 15 phút', progress: 0, target: 1 },
    ];
    const scheduled_tasks = [{ occurrence_id: 'o1', kind: 'custom', title: 'Đọc chương 3', category: 'study', completed: false, scheduled_date: '2030-01-01', all_day: true }];
    mockServer({
      'GET /api/auth/me': { status: 200, body: USER },
      'GET /api/dashboard': { status: 200, body: { user: USER, study: { total_minutes: 0, today_sessions: 0 }, daily_quests, scheduled_tasks } },
    });
    render(<App />);
    await screen.findByText(`Chào bạn, ${USER.display_name}!`);

    const summary = await screen.findByRole('button', { name: 'Nhiệm vụ hằng ngày: 1/3 nhiệm vụ hoàn thành' });
    expect(summary.props.accessibilityState).toMatchObject({ expanded: false });
    expect(screen.queryByText('Vận động ít nhất 15 phút')).toBeNull();

    fireEvent.press(summary);
    expect(screen.getByText('Vận động ít nhất 15 phút')).toBeTruthy();
    expect(screen.getByText('Đọc chương 3')).toBeTruthy();
    expect(screen.queryByText('Học một điều mới trong 15 phút')).toBeNull(); // done tasks only count toward progress
    expect(screen.getByRole('button', { name: 'Thêm nhiệm vụ mới' })).toBeTruthy();

    fireEvent.press(screen.getByRole('button', { name: 'Nhiệm vụ hằng ngày: 1/3 nhiệm vụ hoàn thành' }));
    expect(screen.queryByText('Vận động ít nhất 15 phút')).toBeNull();
  });

  it('changes the avatar to a preset from the profile', async () => {
    store.set(SESSION_KEY, JSON.stringify({ accessToken: 'access-1', refreshToken: tokens(1).refresh_token }));
    const server = mockServer({
      'GET /api/auth/me': { status: 200, body: USER },
      'PATCH /api/profile': (req) => ({ status: 200, body: { ...USER, ...req.body } }),
    });
    render(<App />);
    await screen.findByText(`Chào bạn, ${USER.display_name}!`);
    fireEvent.press(screen.getByRole('button', { name: 'Xem hồ sơ và thú cưng' }));
    fireEvent.press(await screen.findByRole('button', { name: 'Đổi ảnh đại diện' }));
    fireEvent.press(screen.getByRole('radio', { name: 'Cáo nhỏ' }));

    expect(await screen.findByText('Đã đổi ảnh đại diện')).toBeTruthy();
    expect(server.callsTo('PATCH /api/profile')[0].body).toEqual({ avatar_theme: 'fox' });
    expect(screen.queryByText('Chọn ảnh đại diện')).toBeNull();
  });

  it('shows the pet out on its walk on Home once the daily quests are done', async () => {
    store.set(SESSION_KEY, JSON.stringify({ accessToken: 'access-1', refreshToken: tokens(1).refresh_token }));
    const quests = [{ title: 'Hoàn thành một phiên tập trung', progress: 1, target: 1 }];
    const space = { walk_minutes: 30, quests, last_find: null, collection: [], total_finds: 8 };
    const server = mockServer({
      'GET /api/auth/me': { status: 200, body: USER },
      // The backend starts the walk by itself when the last daily quest is completed.
      'GET /api/pet/space': { status: 200, body: { ...space, status: 'walking', seconds_left: 1800 } },
    });
    render(<App />);
    await screen.findByText(`Chào bạn, ${USER.display_name}!`);

    expect(await screen.findByText('Pet đang đi dạo...')).toBeTruthy();
    expect(screen.getByText('00:30:00')).toBeTruthy();
    expect(server.callsTo('GET /api/pet/space').length).toBeGreaterThan(0);
  });
});

describe('session lifecycle', () => {
  it('restores a saved session when the app reopens', async () => {
    store.set(SESSION_KEY, JSON.stringify({ accessToken: 'access-1', refreshToken: tokens(1).refresh_token }));
    const server = mockServer({ 'GET /api/auth/me': { status: 200, body: USER } });
    render(<App />);
    expect(await screen.findByText(`Chào bạn, ${USER.display_name}!`)).toBeTruthy();
    expect(server.callsTo('GET /api/auth/me')[0].headers.Authorization).toBe('Bearer access-1');
    expect(server.callsTo('POST /api/auth/login')).toHaveLength(0);
  });

  it('refreshes an expired access token during restore and persists the rotated tokens', async () => {
    store.set(SESSION_KEY, JSON.stringify({ accessToken: 'access-1', refreshToken: tokens(1).refresh_token }));
    const server = mockServer({
      'GET /api/auth/me': (req) => (req.headers.Authorization === 'Bearer access-2'
        ? { status: 200, body: USER } : { status: 401, body: { detail: 'expired', code: 'token_expired' } }),
      'POST /api/auth/refresh': { status: 200, body: tokens(2) },
    });
    render(<App />);
    expect(await screen.findByText(`Chào bạn, ${USER.display_name}!`)).toBeTruthy();
    expect(server.callsTo('POST /api/auth/refresh')[0].body).toEqual({ refresh_token: tokens(1).refresh_token });
    expect(storedSession()).toEqual({ accessToken: 'access-2', refreshToken: tokens(2).refresh_token });
  });

  it('returns to login with a notice when the session can no longer be refreshed', async () => {
    store.set(SESSION_KEY, JSON.stringify({ accessToken: 'access-1', refreshToken: tokens(1).refresh_token }));
    mockServer({
      'GET /api/auth/me': { status: 401, body: { detail: 'expired', code: 'token_expired' } },
      'POST /api/auth/refresh': { status: 401, body: { detail: 'Invalid refresh token', code: 'invalid_refresh_token' } },
    });
    render(<App />);
    expect(await screen.findByText(/Phiên đăng nhập đã hết hạn/)).toBeTruthy();
    expect(screen.getByText('Chào mừng bạn trở lại!')).toBeTruthy();
    await waitFor(() => expect(storedSession()).toBeNull());
  });

  it('keeps the session and offers retry when offline at startup', async () => {
    store.set(SESSION_KEY, JSON.stringify({ accessToken: 'access-1', refreshToken: tokens(1).refresh_token }));
    let online = false;
    mockServer({ 'GET /api/auth/me': () => (online ? { status: 200, body: USER } : networkDown()) });
    render(<App />);
    expect(await screen.findByText('Không thể kết nối tới Mirabi')).toBeTruthy();
    expect(storedSession()).not.toBeNull();
    online = true;
    fireEvent.press(screen.getByText('Thử lại'));
    expect(await screen.findByText(`Chào bạn, ${USER.display_name}!`)).toBeTruthy();
  });

  it('asks for confirmation in an in-app dialog; cancelling keeps the user signed in', async () => {
    store.set(SESSION_KEY, JSON.stringify({ accessToken: 'access-1', refreshToken: tokens(1).refresh_token }));
    const server = mockServer({ 'GET /api/auth/me': { status: 200, body: USER }, 'POST /api/auth/logout': { status: 204 } });
    const nativeAlert = jest.spyOn(Alert, 'alert');
    render(<App />);
    await screen.findByText(`Chào bạn, ${USER.display_name}!`);
    fireEvent.press(screen.getByText('Tiện ích'));
    fireEvent.press(await screen.findByRole('button', { name: 'Đăng xuất' }));

    expect(await screen.findByText('Đăng xuất?')).toBeTruthy();
    expect(screen.getByText('Bạn có chắc muốn đăng xuất khỏi Mirabi? Aqua sẽ chờ bạn quay lại nhé!')).toBeTruthy();
    expect(nativeAlert).not.toHaveBeenCalled();
    const cancels = screen.getAllByRole('button', { name: 'Hủy' });
    fireEvent.press(cancels[cancels.length - 1]);
    await waitFor(() => expect(screen.queryByText('Đăng xuất?')).toBeNull());
    expect(server.callsTo('POST /api/auth/logout')).toHaveLength(0);
    expect(storedSession()).not.toBeNull();
  });

  it('logs out after confirmation: revokes the refresh token, clears storage, returns to login', async () => {
    store.set(SESSION_KEY, JSON.stringify({ accessToken: 'access-1', refreshToken: tokens(1).refresh_token }));
    const server = mockServer({ 'GET /api/auth/me': { status: 200, body: USER }, 'POST /api/auth/logout': { status: 204 } });
    render(<App />);
    await screen.findByText(`Chào bạn, ${USER.display_name}!`);
    fireEvent.press(screen.getByText('Tiện ích'));
    fireEvent.press(await screen.findByRole('button', { name: 'Đăng xuất' }));
    fireEvent.press(await screen.findByRole('button', { name: 'Xác nhận đăng xuất' }));

    expect(await screen.findByText('Chào mừng bạn trở lại!')).toBeTruthy();
    expect(server.callsTo('POST /api/auth/logout')[0].body).toEqual({ refresh_token: tokens(1).refresh_token });
    expect(storedSession()).toBeNull();
  });

  it('still logs out locally when the server is unreachable', async () => {
    store.set(SESSION_KEY, JSON.stringify({ accessToken: 'access-1', refreshToken: tokens(1).refresh_token }));
    mockServer({ 'GET /api/auth/me': { status: 200, body: USER }, 'POST /api/auth/logout': networkDown() });
    render(<App />);
    await screen.findByText(`Chào bạn, ${USER.display_name}!`);
    fireEvent.press(screen.getByText('Tiện ích'));
    fireEvent.press(await screen.findByRole('button', { name: 'Đăng xuất' }));
    fireEvent.press(await screen.findByRole('button', { name: 'Xác nhận đăng xuất' }));
    expect(await screen.findByText('Chào mừng bạn trở lại!')).toBeTruthy();
    expect(storedSession()).toBeNull();
  });
});
