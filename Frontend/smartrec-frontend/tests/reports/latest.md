# Frontend Automation Test Report

- **Status:** FAILED
- **Run time:** 14:00:19 3 thg 10, 2026 (Asia/Ho_Chi_Minh)
- **Duration:** 11.20s
- **Command:** `npm test`

## Summary

| Total | Passed | Failed | Skipped | Todo |
|---:|---:|---:|---:|---:|
| 26 | 25 | 1 | 0 | 0 |

## Results by test file

| Test file | Status | Passed | Failed | Skipped |
|---|---|---:|---:|---:|
| `tests/components/AuthForms.test.jsx` | FAILED | 6 | 1 | 0 |
| `tests/features/RequireAuth.test.jsx` | PASSED | 3 | 0 | 0 |
| `tests/unit/validators.test.js` | PASSED | 16 | 0 | 0 |

## Failed tests

###  LoginForm shows validation errors and does not submit invalid credentials

File: `tests/components/AuthForms.test.jsx`

```text
Unable to find an element with the text: Vui lòng nhập email hoặc số điện thoại1. This could be because the text is broken up by multiple elements. In this case, you can provide a function for your text matcher to make your matcher more flexible.

Ignored nodes: comments, script, style
[36m<body>[39m
  [36m<div>[39m
    [36m<form[39m
      [33mclass[39m=[32m"auth-form login-form"[39m
      [33mnovalidate[39m=[32m""[39m
    [36m>[39m
      [36m<button[39m
        [33mclass[39m=[32m"sr-button sr-button-secondary google-button"[39m
        [33mtype[39m=[32m"button"[39m
      [36m>[39m
        [36m<svg[39m
          [33maria-hidden[39m=[32m"true"[39m
          [33mclass[39m=[32m"google-icon"[39m
          [33mfocusable[39m=[32m"false"[39m
          [33mviewBox[39m=[32m"0 0 24 24"[39m
        [36m>[39m
          [36m<path[39m
            [33md[39m=[32m"M23.49 12.27c0-.79-.07-1.54-.2-2.27H12v4.29h6.47c-.28 1.5-1.13 2.77-2.4 3.62v3.01h3.89c2.27-2.09 3.53-5.17 3.53-8.65z"[39m
            [33mfill[39m=[32m"#4285F4"[39m
          [36m/>[39m
          [36m<path[39m
            [33md[39m=[32m"M12 24c3.24 0 5.96-1.07 7.95-2.91l-3.89-3.01c-1.08.72-2.46 1.15-4.06 1.15-3.13 0-5.78-2.11-6.73-4.95H1.25v3.1C3.23 21.31 7.3 24 12 24z"[39m
            [33mfill[39m=[32m"#34A853"[39m
          [36m/>[39m
          [36m<path[39m
            [33md[39m=[32m"M5.27 14.28A7.2 7.2 0 0 1 4.89 12c0-.79.14-1.56.38-2.28v-3.1H1.25A11.96 11.96 0 0 0 0 12c0 1.93.46 3.75 1.25 5.38l4.02-3.1z"[39m
            [33mfill[39m=[32m"#FBBC05"[39m
          [36m/>[39m
          [36m<path[39m
            [33md[39m=[32m"M12 4.77c1.76 0 3.34.61 4.58 1.8l3.45-3.45C17.95 1.18 15.23 0 12 0 7.3 0 3.23 2.69 1.25 6.62l4.02 3.1C6.22 6.88 8.87 4.77 12 4.77z"[39m
            [33mfill[39m=[32m"#EA4335"[39m
          [36m/>[39m
        [36m</svg>[39m
        [36m<span>[39m
          [0mContinue with Google[0m
        [36m</span>[39m
      [36m</button>[39m
      [36m<div[39m
        [33mclass[39m=[32m"auth-divider"[39m
      [36m>[39m
        [36m<span>[39m
          [0mOR[0m
        [36m</span>[39m
      [36m</div>[39m
      [36m<div[39m
        [33mclass[39m=[32m"sr-field "[39m
      [36m>[39m
        [36m<div[39m
          [33mclass[39m=[32m"sr-input-wrap is-error"[39m
        [36m>[39m
          [36m<input[39m
            [33maria-invalid[39m=[32m"true"[39m
            [33mautocomplete[39m=[32m"username"[39m
            [33mid[39m=[32m"login-email"[39m
            [33mname[39m=[32m"emailOrPhone"[39m
            [33mplaceholder[39m=[32m"Email hoặc số điện thoại"[39m
            [33mtype[39m=[32m"text"[39m
            [33mvalue[39m=[32m""[39m
          [36m/>[39m
        [36m</div>[39m
        [36m<p[39m
          [33mclass[39m=[32m"auth-error-message"[39m
        [36m>[39m
          [0mVui lòng nhập email hoặc số điện thoại[0m
        [36m</p>[39m
      [36m</div>[39m
      [36m<div[39m
        [33mclass[39m=[32m"sr-field "[39m
      [36m>[39m
        [36m<div[39m
          [33mclass[39m=[32m"sr-input-wrap is-error"[39m
        [36m>[39m
          [36m<input[39m
            [33maria-invalid[39m=[32m"true"[39m
            [33mautocomplete[39m=[32m"current-password"[39m
            [33mid[39m=[32m"login-password"[39m
            [33mname[39m=[32m"password"[39m
            [33mplaceholder[39m=[32m"Mật khẩu"[39m
            [33mtype[39m=[32m"password"[39m
            [33mvalue[39m=[32m""[39m
          [36m/>[39m
          [36m<div[39m
            [33mclass[39m=[32m"sr-input-action"[39m
          [36m>[39m
            [36m<button[39m
              [33maria-label[39m=[32m"Hiện mật khẩu"[39m
              [33mclass[39m=[32m"ghost-icon-button"[39m
              [33mtype[39m=[32m"button"[39m
            [36m>[39m
              [0mHiện[0m
            [36m</button>[39m
          [36m</div>[39m
        [36m</div>[39m
        [36m<p[39m
          [33mclass[39m=[32m"auth-error-message"[39m
        [36m>[39m
          [0mVui lòng nhập mật khẩu[0m
        [36m</p>[39m
      [36m</div>[39m
      [36m<div[39m
        [33mclass[39m=[32m"login-options"[39m
      [36m>[39m
        [36m<label[39m
          [33mclass[39m=[32m"remember-control"[39m
        [36m>[39m
          [36m<input[39m
            [33mchecked[39m=[32m""[39m
            [33mname[39m=[32m"remember"[39m
            [33mtype[39m=[32m"checkbox"[39m
          [36m/>[39m
          [36m<span>[39m
            [0mGhi nhớ thiết bị này[0m
          [36m</span>[39m
        [36m</label>[39m
        [36m<a[39m
          [33mhref[39m=[32m"/forgot-password"[39m
        [36m>[39m
          [0mQuên mật khẩu?[0m
        [36m</a>[39m
      [36m</div>[39m
      [36m<button[39m
        [33mclass[39m=[32m"sr-button sr-button-primary "[39m
        [33mtype[39m=[32m"submit"[39m
      [36m>[39m
        [0mĐăng nhập vào Workspace[0m
      [36m</button>[39m
    [36m</form>[39m
  [36m</div>[39m
[36m</body>[39m
```


---

This report is regenerated automatically whenever `npm test` runs.
