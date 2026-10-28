# API examples

Register (password: 8–128 chars, at least one letter and one digit; `display_name` optional) → `201`.
Registration does not sign in; log in afterwards:
```bash
curl -X POST http://localhost:8000/api/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"hello@example.com","password":"Passw0rd!","display_name":"Lunaria"}'
# {"id":1,"email":"hello@example.com","display_name":"Lunaria",...,"pet":"fox","pet_name":null,"onboarded":false}
```

Adopt and name a pet (first sign-in; `pet` is one of fox, cat, bunny, penguin, dolphin, turtle; `name` 1–30 chars) → `200` user:
```bash
curl -X PUT http://localhost:8000/api/pet -H 'Authorization: Bearer YOUR_ACCESS_TOKEN' \
  -H 'Content-Type: application/json' -d '{"pet":"dolphin","name":"Nami"}'
```

Finish the welcome tour → `200` user with `"onboarded": true` (`409 pet_not_adopted` before adopting):
```bash
curl -X POST http://localhost:8000/api/onboarding/complete -H 'Authorization: Bearer YOUR_ACCESS_TOKEN'
```

Log in → `200`, or `401 {"detail":"Email or password is incorrect","code":"invalid_credentials"}`:
```bash
curl -X POST http://localhost:8000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"hello@example.com","password":"Passw0rd!"}'
```

Current user:
```bash
curl http://localhost:8000/api/auth/me -H 'Authorization: Bearer YOUR_ACCESS_TOKEN'
```

Rotate tokens (the refresh token you send is revoked; store the new pair):
```bash
curl -X POST http://localhost:8000/api/auth/refresh \
  -H 'Content-Type: application/json' \
  -d '{"refresh_token":"YOUR_REFRESH_TOKEN"}'
```

Log out → `204`:
```bash
curl -X POST http://localhost:8000/api/auth/logout \
  -H 'Content-Type: application/json' \
  -d '{"refresh_token":"YOUR_REFRESH_TOKEN"}'
```

Password reset (requires `EMAIL_BACKEND=console` or `smtp`; with `console` the code is printed in the server log):
```bash
curl -X POST http://localhost:8000/api/auth/password/forgot \
  -H 'Content-Type: application/json' \
  -d '{"email":"hello@example.com"}'
# 202 {"message":"If an account exists for this email, password reset instructions have been sent."}

curl -X POST http://localhost:8000/api/auth/password/reset \
  -H 'Content-Type: application/json' \
  -d '{"token":"CODE_FROM_EMAIL","new_password":"NewPassw0rd"}'
```

Create a study session:
```bash
curl -X POST http://localhost:8000/api/study/sessions \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  -d '{"mode":"focus","duration_seconds":1500,"completed":true}'
```
