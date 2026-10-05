import { describe, expect, it } from "vitest";
import {
  formatFullName,
  getPasswordRequirements,
  isEmail,
  isEmailOrPhone,
  isPasswordValid,
  isPhone,
  validateConfirmPassword,
  validateEmail,
  validateEmailOrPhone,
  validateFullName,
  validateOtp,
  validatePassword,
  validatePhone,
  validateRequired,
} from "../../src/utils/validators.js";

describe("email and phone validators", () => {
  it("accepts valid email and phone values with surrounding whitespace", () => {
    expect(isEmail("  alice@example.com  ")).toBe(true);
    expect(isPhone("  0912345678  ")).toBe(true);
    expect(isEmailOrPhone(" alice@example.com ")).toBe(true);
    expect(isEmailOrPhone(" 0912345678 ")).toBe(true);
  });

  it.each(["alice", "alice@", "alice@example", "alice @example.com"])(
    "rejects invalid email %s",
    (value) => {
      expect(isEmail(value)).toBe(false);
      expect(validateEmail(value)).not.toBe("");
    },
  );

  it.each(["9123456789", "091234567", "09123456789", "09123abc78"])(
    "rejects invalid phone %s",
    (value) => {
      expect(isPhone(value)).toBe(false);
      expect(validatePhone(value)).toBe("Số điện thoại không hợp lệ");
    },
  );

  it("returns required errors for missing identifiers and email", () => {
    expect(validateEmailOrPhone("  ")).toBe(
      "Vui lòng nhập email hoặc số điện thoại",
    );
    expect(validateEmail("")).toBe("Vui lòng nhập email");
    expect(validatePhone("")).toBe("Vui lòng nhập số điện thoại");
  });
});

describe("name validators", () => {
  it("normalizes names and removes unsupported characters", () => {
    expect(formatFullName("nGUYỄN   vĂn  A1!")).toBe("Nguyễn Văn A");
  });

  it("accepts a valid Vietnamese name and rejects invalid names", () => {
    expect(validateFullName(" Nguyễn Văn An ")).toBe("");
    expect(validateFullName("")).toBe("Vui lòng nhập họ và tên");
    expect(validateFullName("An")).toBe(
      "Họ và tên phải có từ 3 đến 50 ký tự.",
    );
    expect(validateFullName("Nguyễn An 2")).toBe(
      "Họ và tên chỉ được chứa chữ cái và khoảng trắng",
    );
  });
});

describe("password validators", () => {
  it("requires every password rule and enforces the length boundaries", () => {
    expect(isPasswordValid("Aa1!aaaa")).toBe(true);
    expect(isPasswordValid("Aa1!aaaaaaaaaaaa")).toBe(true);
    expect(isPasswordValid("Aa1!aaaaaaaaaaaaa")).toBe(false);
    expect(getPasswordRequirements("Aa1!aaa")).toEqual({
      length: false,
      uppercase: true,
      lowercase: true,
      number: true,
      special: true,
    });
    expect(validatePassword("Aa1!aaaa")).toBe("");
    expect(validatePassword("")).toBe("Vui lòng nhập mật khẩu");
    expect(validatePassword("Aa1aaaaa")).toBe(
      "Có ít nhất 1 ký tự đặc biệt",
    );
  });

  it("requires an exact confirmation match", () => {
    expect(validateConfirmPassword("", "Aa1!aaaa")).toBe(
      "Vui lòng xác nhận mật khẩu",
    );
    expect(validateConfirmPassword("Aa1!aaaA", "Aa1!aaaa")).toBe(
      "Mật khẩu xác nhận không khớp",
    );
    expect(validateConfirmPassword("Aa1!aaaa", "Aa1!aaaa")).toBe("");
  });
});

describe("OTP and required validators", () => {
  it("accepts only six numeric OTP digits", () => {
    expect(validateOtp("123456")).toBe("");
    expect(validateOtp("")).toBe("Vui lòng nhập mã OTP");
    expect(validateOtp("12345")).toBe("Mã OTP phải gồm 6 chữ số");
    expect(validateOtp("12a456")).toBe("Mã OTP phải gồm 6 chữ số");
  });

  it("treats empty and whitespace-only strings as missing", () => {
    expect(validateRequired(" \t")).toBe("Trường này là bắt buộc");
    expect(validateRequired("value")).toBe("");
    expect(validateRequired("", "Custom message")).toBe("Custom message");
  });
});
